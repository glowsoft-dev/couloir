import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "@couloir/agent";
import { FEATURE_PROFILES, ROUTES, type Capabilities, demoManifest } from "@couloir/protocol";
import { MediaStore, MemoryStore, buildApp } from "@couloir/server";
import { HttpNet } from "./ports/net.js";
import { FileQueue } from "./ports/queue.js";
import { ManifestFile } from "./ports/manifest-file.js";
import { FileStore } from "./ports/store.js";

/**
 * Le scénario complet, de bout en bout, avec de vrais fichiers et un vrai
 * serveur HTTP : enrôlement, synchronisation, téléchargement vérifié,
 * coupure réseau, reprise.
 *
 * C'est le test qui vaut le plus cher : la machine à états prouve les règles,
 * celui-ci prouve que la plomberie les respecte pour de bon.
 */

const CAPS: Capabilities = {
  platform: "linux",
  shellVersion: "0.1.0",
  rendererVersion: "0.1.0",
  agentVersion: "0.1.0",
  display: { widthPx: 1920, heightPx: 1080, orientation: "landscape" },
  codecs: ["h264"],
  maxVideoHeight: 1080,
  storageBudgetBytes: 1024 ** 3,
  features: { ...FEATURE_PROFILES.linux },
};

/** Une fausse image, assez grosse pour que les requêtes Range aient un sens. */
const IMAGE = Buffer.alloc(64 * 1024, 7);

interface Harness {
  baseUrl: string;
  store: MemoryStore;
  media: MediaStore;
  dataDir: string;
  stop: () => Promise<void>;
  cut: () => Promise<void>;
  restore: () => Promise<void>;
}

let harness: Harness;

beforeEach(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "couloir-player-"));
  const mediaDir = await mkdtemp(join(tmpdir(), "couloir-media-"));

  // Un seul entrepôt de parc et un seul entrepôt de médias pour toute la
  // durée du test : couper le réseau ne doit pas effacer le serveur, juste
  // le rendre injoignable.
  const store = new MemoryStore();
  const media = new MediaStore(mediaDir);
  await media.load();
  await media.put("affiche-po-2026", IMAGE, "image/jpeg");

  let app = buildApp({ store, media });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  let running = true;

  harness = {
    baseUrl: `http://127.0.0.1:${port}`,
    store,
    media,
    dataDir,
    stop: async () => {
      if (running) await app.close().catch(() => {});
      // maxRetries : un écran peut encore finir d'écrire son état.
      const clean = { recursive: true, force: true, maxRetries: 5, retryDelay: 30 };
      await rm(dataDir, clean);
      await rm(mediaDir, clean);
    },
    // Fermer le serveur, c'est exactement ce que voit un player quand on
    // débranche le câble réseau : la connexion est refusée.
    cut: async () => {
      await app.close();
      running = false;
    },
    restore: async () => {
      app = buildApp({ store, media });
      await app.listen({ port, host: "127.0.0.1" });
      running = true;
    },
  };
});

afterEach(async () => {
  await harness.stop();
});

/** Enrôle un appareil et fabrique l'agent qui va avec, comme le fait `Player`. */
async function bootPlayer() {
  const start = await fetch(`${harness.baseUrl}${ROUTES.enrollStart}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey: "x".repeat(44), capabilities: CAPS }),
  });
  const { deviceId, pairingCode } = (await start.json()) as { deviceId: string; pairingCode: string };

  // Le geste de la console : quelqu'un saisit le code depuis son téléphone.
  const claim = await fetch(`${harness.baseUrl}${ROUTES.enrollClaim}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingCode,
      newScreen: {
        code: "A·1·12",
        label: "Hall central",
        building: "A",
        floor: 1,
        area: "hall",
        orientation: "landscape",
        groupIds: [],
      },
    }),
  });
  const { screenId } = (await claim.json()) as { screenId: string };

  const store = new FileStore(join(harness.dataDir, "cache"));
  const queue = new FileQueue(join(harness.dataDir, "telemetry.jsonl"));
  await store.open();
  await queue.open();

  const net = new HttpNet(
    { baseUrl: harness.baseUrl, deviceId, agentVersion: "0.1.0", timeoutMs: 2_000 },
    store,
  );

  return { deviceId, screenId, store, queue, net };
}

function makeRuntime(
  parts: Awaited<ReturnType<typeof bootPlayer>>,
  onApplied?: (version: number) => void,
) {
  const clock = { nowMs: () => Date.now(), isReliable: () => true, syncFromNetwork: async () => true };
  const noop = async () => {
    throw new Error("non utilisé dans ce test");
  };
  return new AgentRuntime(
    {
      net: parts.net,
      store: parts.store,
      queue: parts.queue,
      display: { setPower: noop, isOn: noop, screenshot: noop },
      system: { reboot: noop, restartApp: noop, metrics: noop, capabilities: async () => CAPS },
      clock,
    },
    {
      settings: { offlineGraceDays: 7, pollIntervalSec: 60 },
      persistence: new ManifestFile(join(harness.dataDir, "manifest.json")),
      ...(onApplied ? { onManifestApplied: (m) => onApplied(m.version) } : {}),
    },
  );
}

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition jamais atteinte");
}

describe("le player, de bout en bout", () => {
  it("s'enrôle, récupère son manifeste et télécharge ses médias", async () => {
    const parts = await bootPlayer();
    const media = publishManifest(parts.screenId);

    const runtime = makeRuntime(parts);
    await runtime.start();

    await eventually(() => runtime.getContext().activeVersion === 1);
    expect(runtime.getManifest()?.screenId).toBe(parts.screenId);

    // Le média est réellement sur le disque, et son empreinte a été vérifiée.
    expect(await parts.store.has("affiche-po-2026", media.sha256)).toBe(true);
    const info = await stat(parts.store.pathFor("affiche-po-2026"));
    expect(info.size).toBe(IMAGE.byteLength);

    await runtime.stop();
  });

  it("n'applique rien quand un média manque, et passe au contenu embarqué", async () => {
    const parts = await bootPlayer();
    // Manifeste publié SANS que le média existe côté serveur : le
    // téléchargement va échouer.
    const manifest = demoManifest(parts.screenId, 1);
    harness.store.putManifest({
      ...manifest,
      assets: manifest.assets.map((a) => ({ ...a, url: `${harness.baseUrl}/v1/assets/inexistant` })),
    });

    const runtime = makeRuntime(parts);
    await runtime.start();

    // Rien n'a été appliqué, et l'écran bascule sur le contenu embarqué
    // plutôt que de rester indéfiniment en préparation.
    await eventually(() => runtime.getContext().state === "fallback");
    expect(runtime.getContext().activeVersion).toBe(0);
    expect(runtime.getManifest()).toBeNull();

    await runtime.stop();
  });

  it("survit à une coupure réseau et se remet à jour au retour", async () => {
    const parts = await bootPlayer();
    publishManifest(parts.screenId);

    const runtime = makeRuntime(parts);
    await runtime.start();
    await eventually(() => runtime.getContext().activeVersion === 1);

    // On débranche.
    await harness.cut();
    await runtime.syncNow();
    await eventually(() => runtime.getContext().state === "degraded");

    // L'invariant du projet : l'écran affiche toujours la même chose.
    expect(runtime.getContext().activeVersion).toBe(1);
    expect(runtime.getManifest()?.version).toBe(1);

    // On rebranche, et une nouvelle version est parue entre-temps.
    await harness.restore();
    publishManifest(parts.screenId, 2);

    await runtime.syncNow();
    await eventually(() => runtime.getContext().activeVersion === 2);
    expect(runtime.getManifest()?.version).toBe(2);

    await runtime.stop();
  });

  it("ne perd aucune preuve de diffusion pendant la coupure", async () => {
    const parts = await bootPlayer();
    publishManifest(parts.screenId);

    const runtime = makeRuntime(parts);
    await runtime.start();
    await eventually(() => runtime.getContext().activeVersion === 1);

    await harness.cut();

    // Trois passages journalisés pendant que le réseau est coupé.
    for (let i = 0; i < 3; i++) {
      await runtime.record({
        heartbeats: [],
        playEvents: [
          {
            eventId: randomUUID(),
            slideId: "affiche-portes-ouvertes",
            zoneId: "principal",
            manifestVersion: 1,
            startedAt: "2026-09-15T10:00:00Z",
            endedAt: "2026-09-15T10:00:09Z",
            reason: "completed",
            offline: true,
          },
        ],
        logs: [],
      });
    }
    expect(await parts.queue.pendingCount()).toBe(3);

    // Une tentative d'envoi qui échoue ne doit RIEN purger.
    await runtime.syncNow();
    expect(await parts.queue.pendingCount()).toBe(3);

    // Au retour, le lot part et n'est purgé qu'après acquittement.
    await harness.restore();
    await runtime.syncNow();
    await eventually(async () => (await parts.queue.pendingCount()) === 0);

    await runtime.stop();
  });

  it("retrouve son contenu après un redémarrage sans réseau", async () => {
    // Le scénario R-04 de la recette : coupure de courant, réseau toujours
    // absent au rallumage. Les médias sont sur le disque, encore faut-il
    // retrouver la liste qui dit quoi en faire.
    const parts = await bootPlayer();
    publishManifest(parts.screenId);

    const first = makeRuntime(parts);
    await first.start();
    await eventually(() => first.getContext().activeVersion === 1);
    await first.stop();

    // On débranche, puis on redémarre le player.
    await harness.cut();

    const store = new FileStore(join(harness.dataDir, "cache"));
    const queue = new FileQueue(join(harness.dataDir, "telemetry.jsonl"));
    await store.open();
    await queue.open();
    const rebooted = makeRuntime({ ...parts, store, queue });
    await rebooted.start();

    expect(rebooted.getManifest()?.version).toBe(1);
    expect(rebooted.getContext().activeVersion).toBe(1);
    // Et surtout : il continue de diffuser son vrai contenu. Sans la
    // conservation du dernier contact, il conclurait « hors ligne depuis
    // toujours » et basculerait aussitôt sur sa page de repli.
    expect(rebooted.getContext().state).not.toBe("fallback");
    // Le média est toujours là : rien à retélécharger.
    expect(await store.has("affiche-po-2026", harness.media.get("affiche-po-2026")!.sha256)).toBe(true);

    await rebooted.stop();
  });

  it("la file de télémétrie survit au redémarrage du player", async () => {
    const parts = await bootPlayer();
    await parts.queue.append({
      heartbeats: [],
      playEvents: [],
      logs: [
        {
          eventId: randomUUID(),
          at: "2026-09-15T10:00:00Z",
          level: "warn",
          code: "test",
          message: "avant redémarrage",
        },
      ],
    });

    // Nouveau processus, même disque.
    const reopened = new FileQueue(join(harness.dataDir, "telemetry.jsonl"));
    await reopened.open();
    expect(await reopened.pendingCount()).toBe(1);
    expect((await reopened.peek(10)).logs[0]?.message).toBe("avant redémarrage");
  });
});

/** Publie le manifeste de référence en pointant vers le vrai média servi. */
function publishManifest(screenId: string, version = 1) {
  const media = harness.media.get("affiche-po-2026")!;
  const manifest = demoManifest(screenId, version);
  harness.store.putManifest({
    ...manifest,
    assets: manifest.assets.map((asset) => ({
      ...asset,
      sha256: media.sha256,
      bytes: media.bytes,
      url: `${harness.baseUrl}/v1/assets/${asset.id}`,
    })),
  });
  return media;
}
