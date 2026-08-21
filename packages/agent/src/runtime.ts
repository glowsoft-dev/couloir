import type { AgentState, Manifest, TelemetryBatch } from "@couloir/protocol";
import type { PlatformPorts } from "./ports.js";
import { UnsupportedOperation } from "./ports.js";
import { type AgentContext, type AgentEffect, type AgentSettings, initialContext, reduce } from "./state.js";

/**
 * La boucle de l'agent.
 *
 * La machine à états décide, le runtime exécute. Cette séparation est ce qui
 * permet de tester toute la résilience sans matériel : le runtime ne contient
 * aucune règle métier, seulement de la plomberie autour des portes.
 *
 * Il est aussi le seul endroit qui a le droit d'être asynchrone et de rater.
 * Un échec de porte se traduit en événement (`sync-failed`, `staging-failed`)
 * et repart dans la machine à états, qui décide de la suite.
 */

/**
 * Conservation du manifeste appliqué, sur le support de la plateforme.
 *
 * Sans elle, un écran qui redémarre pendant une coupure repart de zéro : il a
 * pourtant tous ses médias sur le disque, mais plus la liste qui dit quoi en
 * faire. L'autonomie de sept jours ne survivrait pas à une coupure de courant.
 */
export interface PersistedState {
  manifest: Manifest;
  etag: string | null;
  /**
   * Dernier contact réussi avec le serveur.
   *
   * Conservé avec le manifeste, et c'est essentiel : sans lui, un écran qui
   * redémarre repart avec « jamais contacté », conclut que sa coupure dure
   * depuis toujours, et bascule immédiatement sur sa page de repli — alors
   * qu'il vient de retrouver un contenu parfaitement valide.
   */
  lastContactMs: number | null;
}

export interface ManifestPersistence {
  load(): Promise<PersistedState | null>;
  save(state: PersistedState): Promise<void>;
}

/** En dessous, réécrire le fichier à chaque contact ne vaut pas l'usure disque. */
const CONTACT_PERSIST_INTERVAL_MS = 10 * 60_000;

export interface RuntimeOptions {
  settings: AgentSettings;
  persistence?: ManifestPersistence;
  /** Appelé quand un nouveau manifeste devient celui à l'écran. */
  onManifestApplied?: (manifest: Manifest) => void;
  /** Appelé quand on bascule sur la playlist de repli embarquée. */
  onFallback?: (reason: "clock-unreliable" | "offline-too-long") => void;
  onStateChange?: (state: AgentState, context: AgentContext) => void;
  log?: (level: "info" | "warn" | "error", message: string, context?: Record<string, unknown>) => void;
}

export class AgentRuntime {
  private context: AgentContext = initialContext();
  private etag: string | null = null;
  /** Le manifeste à l'écran. */
  private active: Manifest | null = null;
  /** Celui qu'on prépare : ses médias ne sont pas tous arrivés. */
  private staging: Manifest | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private unsubscribe: (() => void) | null = null;
  /** Dernier contact déjà écrit sur disque, pour ne pas réécrire à chaque cycle. */
  private persistedContactMs: number | null = null;
  /** Écriture en cours, suivie pour que `stop()` ne la coupe pas au milieu. */
  private pendingPersist: Promise<void> = Promise.resolve();

  constructor(
    private readonly ports: PlatformPorts,
    private readonly options: RuntimeOptions,
  ) {}

  getContext(): AgentContext {
    return this.context;
  }

  getManifest(): Manifest | null {
    return this.active;
  }

  async start(): Promise<void> {
    this.stopped = false;

    // On repart de ce qui était à l'écran avant le redémarrage, avant même
    // de tenter le réseau : un écran rallumé sans connexion doit retrouver
    // son contenu, pas la page de repli.
    await this.restore();

    // Le canal temps réel est un accélérateur, pas une dépendance : s'il ne
    // s'établit pas, le poll périodique suffit à tout faire fonctionner.
    try {
      this.unsubscribe = await this.ports.net.subscribeCommands((command) => {
        if (command.type === "sync-now") void this.dispatch({ type: "tick" });
      });
    } catch (error) {
      this.log("warn", "canal temps réel indisponible, on se rabat sur le poll", { error: String(error) });
    }

    await this.dispatch({ type: "boot", clockReliable: this.ports.clock.isReliable() });
  }

  /** Recharge le dernier manifeste appliqué, s'il en existe un. */
  private async restore(): Promise<void> {
    if (!this.options.persistence) return;
    try {
      const saved = await this.options.persistence.load();
      if (!saved) return;

      // Les médias sont vérifiés à la volée : si le cache a été vidé entre
      // deux démarrages, la prochaine synchronisation les retéléchargera.
      this.active = saved.manifest;
      this.etag = saved.etag;
      this.persistedContactMs = saved.lastContactMs;
      this.context = {
        ...this.context,
        activeVersion: saved.manifest.version,
        lastContactMs: saved.lastContactMs,
      };
      this.options.onManifestApplied?.(saved.manifest);
      this.log("info", `manifeste v${saved.manifest.version} restauré depuis le disque`);
    } catch (error) {
      this.log("warn", "manifeste conservé illisible, on repart à zéro", { error: String(error) });
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    // Une extinction ne doit pas couper une écriture d'état en cours : c'est
    // ce fichier qui permettra au prochain démarrage de retrouver l'écran.
    await this.pendingPersist;
  }

  /** Force un cycle immédiat — utilisé par la commande « synchroniser ». */
  async syncNow(): Promise<void> {
    await this.dispatch({ type: "tick" });
  }

  private log(
    level: "info" | "warn" | "error",
    message: string,
    context?: Record<string, unknown>,
  ): void {
    this.options.log?.(level, message, context);
  }

  private async dispatch(event: Parameters<typeof reduce>[1]): Promise<void> {
    if (this.stopped) return;

    const previousState = this.context.state;
    const { context, effects } = reduce(
      this.context,
      event,
      this.options.settings,
      this.ports.clock.nowMs(),
    );
    this.context = context;

    if (context.state !== previousState) {
      this.log("info", `état ${previousState} → ${context.state}`);
      this.options.onStateChange?.(context.state, context);
    }

    for (const effect of effects) {
      await this.execute(effect);
      if (this.stopped) return;
    }
  }

  private async execute(effect: AgentEffect): Promise<void> {
    switch (effect.type) {
      case "sync-clock":
        await this.syncClock();
        return;
      case "fetch-manifest":
        await this.fetchManifest();
        return;
      case "download-assets":
        await this.downloadAssets();
        return;
      case "apply-manifest":
        this.applyManifest();
        return;
      case "play-fallback":
        this.options.onFallback?.(effect.reason);
        return;
      case "flush-telemetry":
        await this.flushTelemetry();
        return;
      case "schedule-retry":
        this.scheduleRetry(effect.delayMs);
        return;
    }
  }

  private scheduleRetry(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.dispatch({ type: "tick" });
    }, delayMs);
    // Ne pas retenir le processus en vie juste pour un prochain cycle.
    this.timer.unref?.();
  }

  private async syncClock(): Promise<void> {
    try {
      if (await this.ports.clock.syncFromNetwork()) {
        await this.dispatch({ type: "clock-synced" });
        return;
      }
    } catch (error) {
      this.log("warn", "synchronisation de l'horloge impossible", { error: String(error) });
    }
    // Toujours pas d'heure fiable : on reste sur le repli et on réessaiera.
    this.scheduleRetry(30_000);
  }

  private async fetchManifest(): Promise<void> {
    try {
      const result = await this.ports.net.fetchManifest(this.etag);
      if (result.status === "unchanged") {
        await this.dispatch({ type: "manifest-unchanged" });
        await this.persistContactIfStale();
        return;
      }

      this.etag = result.etag;
      this.staging = result.manifest;
      const missing = await this.missingAssetCount(result.manifest);
      await this.dispatch({ type: "manifest-received", version: result.manifest.version, missingAssets: missing });
    } catch (error) {
      this.log("warn", "manifeste inaccessible", { error: String(error) });
      await this.dispatch({ type: "sync-failed" });
    }
  }

  private async missingAssetCount(manifest: Manifest): Promise<number> {
    let missing = 0;
    for (const asset of manifest.assets) {
      if (!(await this.ports.store.has(asset.id, asset.sha256))) missing++;
    }
    return missing;
  }

  /**
   * Télécharge ce qui manque, un fichier à la fois.
   *
   * Séquentiel volontairement : sur un Raspberry Pi en Wi-Fi, quatre
   * téléchargements parallèles ne vont pas plus vite et saturent la carte.
   * Chaque fichier reprend à son point d'arrêt et n'est publié qu'après
   * vérification de son empreinte.
   */
  private async downloadAssets(): Promise<void> {
    const manifest = this.staging;
    if (!manifest) return;

    const required = manifest.assets.map((a) => a.id);
    try {
      await this.ports.store.evictTo(manifest.settings.cacheBudgetBytes, required);
    } catch (error) {
      this.log("warn", "éviction du cache impossible", { error: String(error) });
    }

    let remaining = await this.missingAssetCount(manifest);

    for (const asset of manifest.assets) {
      if (this.stopped) return;
      if (await this.ports.store.has(asset.id, asset.sha256)) continue;

      try {
        const offset = await this.ports.store.partialBytes(asset.id);
        if (offset > 0) {
          this.log("info", `reprise du téléchargement de ${asset.id}`, { offset, total: asset.bytes });
        }
        await this.ports.net.downloadAsset(asset.id, asset.url, offset);
        // `commit` vérifie l'empreinte puis publie par renommage atomique :
        // un fichier corrompu n'atteint jamais l'écran.
        await this.ports.store.commit(asset.id, asset.sha256);
        remaining--;
        await this.dispatch({ type: "asset-downloaded", remaining });
      } catch (error) {
        this.log("error", `téléchargement de ${asset.id} échoué`, { error: String(error) });
        await this.dispatch({ type: "staging-failed" });
        return;
      }
    }
  }

  private applyManifest(): void {
    if (!this.staging) return;
    this.active = this.staging;
    this.staging = null;
    this.log("info", `manifeste v${this.active.version} appliqué`);
    this.options.onManifestApplied?.(this.active);
    // Écrit après coup : un échec d'écriture ne doit pas empêcher l'écran
    // d'afficher ce qu'il vient de valider.
    this.pendingPersist = this.persist();
  }

  /**
   * Écrit l'état sur disque.
   *
   * Appelé après chaque application de manifeste, et de loin en loin quand
   * seul l'horodatage du dernier contact a bougé — pour qu'un écran rallumé
   * sache depuis combien de temps il est vraiment isolé, sans user la carte.
   */
  private async persist(): Promise<void> {
    const persistence = this.options.persistence;
    if (!persistence || !this.active) return;
    try {
      await persistence.save({
        manifest: this.active,
        etag: this.etag,
        lastContactMs: this.context.lastContactMs,
      });
      this.persistedContactMs = this.context.lastContactMs;
    } catch (error) {
      this.log("warn", "état non conservé", { error: String(error) });
    }
  }

  /** À appeler après un contact réussi : n'écrit que si l'écart le justifie. */
  private async persistContactIfStale(): Promise<void> {
    const current = this.context.lastContactMs;
    if (current === null || !this.active) return;
    if (
      this.persistedContactMs !== null &&
      current - this.persistedContactMs < CONTACT_PERSIST_INTERVAL_MS
    ) {
      return;
    }
    await this.persist();
  }

  /**
   * Vide la file de télémétrie.
   *
   * On ne purge qu'après acquittement explicite du serveur : c'est ce qui
   * garantit qu'une coupure de plusieurs jours ne fait perdre aucune preuve
   * de diffusion.
   */
  private async flushTelemetry(): Promise<void> {
    try {
      const batch = await this.ports.queue.peek(200);
      if (isEmptyBatch(batch)) return;

      const ack = await this.ports.net.sendTelemetry(batch);
      await this.ports.queue.acknowledge(ack.acceptedEventIds);
    } catch (error) {
      // Un échec est sans conséquence : rien n'a été purgé, on réessaiera.
      this.log("warn", "remontée de télémétrie différée", { error: String(error) });
    }
  }

  /** Ajoute des événements à la file locale. Ne part sur le réseau que plus tard. */
  async record(batch: TelemetryBatch): Promise<void> {
    await this.ports.queue.append(batch);
  }

  /** Capture d'écran à la demande de la console, si la plateforme sait faire. */
  async screenshot(): Promise<Uint8Array> {
    try {
      return await this.ports.display.screenshot();
    } catch (error) {
      if (error instanceof UnsupportedOperation) throw error;
      throw new Error(`capture impossible : ${String(error)}`);
    }
  }
}

function isEmptyBatch(batch: TelemetryBatch): boolean {
  return batch.heartbeats.length === 0 && batch.playEvents.length === 0 && batch.logs.length === 0;
}
