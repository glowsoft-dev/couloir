import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { networkInterfaces } from "node:os";
import { AgentRuntime, SourcePoller } from "@couloir/agent";
import type { Heartbeat } from "@couloir/protocol";
import { type Identity, IdentityFile, type Pairing, enroll } from "./identity.js";
import { createLocalServer } from "./local-server.js";
import { ManifestFile } from "./ports/manifest-file.js";
import { HttpNet } from "./ports/net.js";
import { FileQueue } from "./ports/queue.js";
import { FileStore } from "./ports/store.js";
import { LinuxClock, LinuxDisplay, LinuxSystem, hasHardwareClock } from "./ports/system.js";

/**
 * Le player Linux, assemblé.
 *
 * Cette classe ne contient aucune règle : elle branche les portes sur
 * l'agent, expose l'état au navigateur, et rythme les battements de cœur.
 * Toute décision appartient à la machine à états et au chef d'orchestre.
 */

export interface PlayerOptions {
  serverUrl: string;
  dataDirectory: string;
  localPort: number;
  screenLabel?: string;
  allowReboot?: boolean;
  heartbeatIntervalMs?: number;
  log?: (level: "info" | "warn" | "error", message: string, context?: Record<string, unknown>) => void;
}

export const VERSIONS = {
  shell: "0.1.0",
  renderer: "0.1.0",
  agent: "0.1.0",
} as const;

export class Player {
  private readonly log: NonNullable<PlayerOptions["log"]>;
  private identity: Identity | null = null;
  private pairing: Pairing | null = null;
  private identify: { screenCode: string; label: string; ipAddress: string } | null = null;
  private identifyTimer: ReturnType<typeof setTimeout> | null = null;
  private runtime: AgentRuntime | null = null;
  private poller: SourcePoller | null = null;
  private store: FileStore | null = null;
  private queue: FileQueue | null = null;
  private server: Server | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly abort = new AbortController();
  private startedAtMs = Date.now();

  constructor(private readonly options: PlayerOptions) {
    this.log = options.log ?? (() => {});
  }

  async start(): Promise<void> {
    const clockReliable = await hasHardwareClock();
    if (!clockReliable) {
      // Signalé fort : sans module RTC, la programmation horaire n'est pas
      // fiable au redémarrage après une coupure de courant.
      this.log("warn", "aucune horloge sauvegardée détectée — module RTC recommandé");
    }

    const store = new FileStore(`${this.options.dataDirectory}/cache`);
    const queue = new FileQueue(`${this.options.dataDirectory}/telemetry.jsonl`);
    await store.open();
    await queue.open();
    this.store = store;
    this.queue = queue;

    const system = new LinuxSystem({
      screenCode: "",
      dataDirectory: this.options.dataDirectory,
      shellVersion: VERSIONS.shell,
      rendererVersion: VERSIONS.renderer,
      agentVersion: VERSIONS.agent,
      cacheBudgetBytes: 8 * 1024 ** 3,
      ...(this.options.allowReboot !== undefined ? { allowReboot: this.options.allowReboot } : {}),
    });
    const capabilities = await system.capabilities();

    // Le serveur local démarre AVANT l'enrôlement : c'est lui qui affiche le
    // code d'appairage à l'écran, sans quoi on ne saurait pas quoi saisir.
    this.server = createLocalServer({
      port: this.options.localPort,
      runtime: () => this.runtime,
      store,
      screenCode: () => this.identity?.screenCode ?? null,
      pairing: () => this.pairing,
      sources: () => this.poller?.snapshotsBySourceId() ?? {},
      identify: () => this.identify,
      forceFallback: () => this.runtime?.getContext().state === "fallback",
    });
    await new Promise<void>((resolve) => this.server!.listen(this.options.localPort, "127.0.0.1", resolve));
    this.log("info", `rendu servi sur http://127.0.0.1:${this.options.localPort}`);

    const file = new IdentityFile(this.options.dataDirectory);
    this.identity = await enroll(
      this.options.serverUrl,
      capabilities,
      file,
      {
        onPairingCode: (pairing) => {
          this.pairing = pairing;
        },
        onClaimed: () => {
          this.pairing = null;
        },
        log: (message, context) => this.log("info", message, context),
      },
      this.abort.signal,
    );

    const net = new HttpNet(
      { baseUrl: this.options.serverUrl, deviceId: this.identity.deviceId, agentVersion: VERSIONS.agent },
      store,
    );
    const clock = new LinuxClock(clockReliable);
    const display = new LinuxDisplay(capabilities.features.displayPower);

    this.poller = new SourcePoller(net, clock, (level: "info" | "warn", message: string, context?: Record<string, unknown>) =>
      this.log(level, message, context),
    );

    this.runtime = new AgentRuntime(
      { net, store, queue, display, system, clock },
      {
        settings: { offlineGraceDays: 7, pollIntervalSec: 60 },
        persistence: new ManifestFile(`${this.options.dataDirectory}/manifest.json`),
        onManifestApplied: (manifest) => {
          this.poller?.setManifest(manifest);
          this.log("info", `manifeste v${manifest.version} à l'écran`);
        },
        onFallback: (reason) => this.log("warn", `bascule sur la playlist de repli (${reason})`),
        log: (level, message, context) => this.log(level, message, context),
      },
    );

    this.poller.start();
    await this.runtime.start();
    this.startHeartbeat();
  }

  /**
   * Le battement de cœur.
   *
   * Il est journalisé en local d'abord, envoyé ensuite. Pendant une coupure
   * il s'accumule sur le disque avec son heure réelle, et le serveur pourra
   * reconstituer l'historique exact au retour.
   */
  private startHeartbeat(): void {
    const intervalMs = this.options.heartbeatIntervalMs ?? 60_000;
    const beat = async () => {
      const runtime = this.runtime;
      if (!runtime) return;

      const context = runtime.getContext();
      const metrics = await new LinuxSystem({
        screenCode: this.identity?.screenCode ?? "",
        dataDirectory: this.options.dataDirectory,
        shellVersion: VERSIONS.shell,
        rendererVersion: VERSIONS.renderer,
        agentVersion: VERSIONS.agent,
        cacheBudgetBytes: 8 * 1024 ** 3,
      }).metrics();

      const heartbeat: Heartbeat = {
        eventId: randomUUID(),
        at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        state: context.state,
        manifestVersion: context.activeVersion,
        wasOffline: context.state === "degraded" || context.state === "fallback",
        metrics: {
          uptimeSec: Math.round((Date.now() - this.startedAtMs) / 1000),
          ...(metrics.cpuTempC !== undefined ? { cpuTempC: metrics.cpuTempC } : {}),
          freeDiskBytes: metrics.freeDiskBytes,
          freeMemoryBytes: metrics.freeMemoryBytes,
          cacheBytes: await (this.store?.usedBytes() ?? Promise.resolve(0)),
          displayOn: true,
        },
      };
      await runtime.record({ heartbeats: [heartbeat], playEvents: [], logs: [] });
    };

    void beat();
    this.heartbeatTimer = setInterval(() => void beat(), intervalMs);
    this.heartbeatTimer.unref?.();
  }

  /** Fait clignoter l'écran avec son code, pour le retrouver dans le couloir. */
  showIdentity(durationSec = 30): void {
    this.identify = {
      screenCode: this.identity?.screenCode ?? "?",
      label: this.options.screenLabel ?? "",
      ipAddress: localAddress(),
    };
    if (this.identifyTimer) clearTimeout(this.identifyTimer);
    this.identifyTimer = setTimeout(() => {
      this.identify = null;
    }, durationSec * 1000);
  }

  async stop(): Promise<void> {
    this.abort.abort();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.identifyTimer) clearTimeout(this.identifyTimer);
    this.poller?.stop();
    await this.runtime?.stop();
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }
}

/** Aide au dépannage : l'adresse à afficher quand on cherche l'écran. */
function localAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return "adresse inconnue";
}
