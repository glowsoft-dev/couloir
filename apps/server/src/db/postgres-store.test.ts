import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FEATURE_PROFILES, type Capabilities, demoManifest } from "@couloir/protocol";
import { connect } from "./connect.js";
import { migrate, truncateAll } from "./migrate.js";
import { PostgresStore } from "./postgres-store.js";

/**
 * Tests contre une vraie base.
 *
 * Un entrepôt en mémoire ne prouve rien sur les contraintes d'intégrité, les
 * transactions ou l'idempotence : ce sont précisément les endroits où
 * PostgreSQL se comporte différemment. Ces tests montent donc le schéma réel.
 *
 * Ils se sautent proprement quand la base n'est pas joignable — un
 * développeur sans Docker doit pouvoir lancer `pnpm test` sans échec rouge —
 * mais l'intégration continue, elle, doit les exécuter.
 */

let sql: Sql | null = null;
let store: PostgresStore;

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

const NEW_SCREEN = {
  code: "A·1·12",
  label: "Hall central",
  building: "A",
  floor: 1,
  area: "hall",
  orientation: "landscape",
};

beforeAll(async () => {
  const candidate = connect({ max: 4 });
  try {
    await candidate.unsafe("SELECT 1");
    await migrate(candidate);
    sql = candidate;
    store = new PostgresStore(candidate);
  } catch {
    await candidate.end({ timeout: 1 }).catch(() => {});
    sql = null;
  }
}, 30_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

beforeEach(async () => {
  if (sql) await truncateAll(sql);
});

/** Saute le cas quand la base n'est pas là, sans faire échouer la suite. */
const dbIt: typeof it = ((name: string, fn: never, timeout?: number) =>
  it(name, async (context) => {
    if (!sql) return context.skip();
    return (fn as unknown as (c: unknown) => Promise<void>)(context);
  }, timeout)) as never;

async function enroll() {
  const device = await store.startEnrollment("x".repeat(44), CAPS);
  const claim = await store.claimNew(device.deviceId, NEW_SCREEN);
  return { device, claim };
}

describe("enrôlement", () => {
  dbIt("conserve l'appareil et son écran d'un appel à l'autre", async () => {
    const { device, claim } = await enroll();

    const reloaded = await store.getDevice(device.deviceId);
    expect(reloaded?.screenId).toBe(claim.screen.id);
    // Le code est consommé au rattachement.
    expect(reloaded?.pairingCode).toBeNull();
  });

  dbIt("interdit deux codes d'appairage identiques en circulation", async () => {
    const first = await store.startEnrollment("x".repeat(44), CAPS);
    const second = await store.startEnrollment("y".repeat(44), CAPS);
    expect(first.pairingCode).not.toBe(second.pairingCode);
  });

  dbIt("refuse deux écrans portant le même code d'étiquette", async () => {
    // Deux `A·1·12` dans le bâtiment rendraient le repérage impossible.
    const a = await store.startEnrollment("x".repeat(44), CAPS);
    await store.claimNew(a.deviceId, NEW_SCREEN);

    const b = await store.startEnrollment("y".repeat(44), CAPS);
    await expect(store.claimNew(b.deviceId, NEW_SCREEN)).rejects.toThrow();
  });

  dbIt("transfère l'écran au nouveau boîtier, et détache l'ancien", async () => {
    // Le scénario R-10 : remplacer un Raspberry Pi par un boîtier Android
    // sans retoucher un seul contenu.
    const { device: first, claim } = await enroll();

    const second = await store.startEnrollment("y".repeat(44), {
      ...CAPS,
      platform: "android",
      features: { ...FEATURE_PROFILES.android },
    });
    const transferred = await store.claimExisting(second.deviceId, claim.screen.id);

    expect(transferred?.screen.id).toBe(claim.screen.id);
    expect((await store.getDevice(first.deviceId))?.screenId).toBeNull();
    expect((await store.getDevice(second.deviceId))?.screenId).toBe(claim.screen.id);
  });

  dbIt("ne rattache rien quand l'écran visé n'existe pas", async () => {
    const device = await store.startEnrollment("x".repeat(44), CAPS);
    expect(await store.claimExisting(device.deviceId, randomUUID())).toBeNull();
  });
});

describe("manifestes", () => {
  dbIt("sert toujours la dernière version publiée", async () => {
    const { claim } = await enroll();

    await store.putManifest(demoManifest(claim.screen.id, 1));
    await store.putManifest(demoManifest(claim.screen.id, 2));

    expect((await store.getManifest(claim.screen.id))?.version).toBe(2);
    expect((await store.getScreen(claim.screen.id))?.manifestVersion).toBe(2);
  });

  dbIt("garde l'historique, pour le retour en arrière", async () => {
    const { claim } = await enroll();
    await store.putManifest(demoManifest(claim.screen.id, 1));
    await store.putManifest(demoManifest(claim.screen.id, 2));

    const versions = await sql!<{ version: number }[]>`
      SELECT version FROM manifests WHERE screen_id = ${claim.screen.id} ORDER BY version
    `;
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
  });

  dbIt("refuse un manifeste qui référencerait du vide", async () => {
    const { claim } = await enroll();
    const manifest = demoManifest(claim.screen.id, 1);

    await expect(
      store.putManifest({ ...manifest, fallbackPlaylistId: "inexistante" }),
    ).rejects.toThrow(/playlist de repli/);
  });

  dbIt("survit à un aller-retour complet en base", async () => {
    // Le manifeste repart du JSONB : il doit repasser la validation du
    // protocole sans perte, sinon l'écran recevrait du contenu abîmé.
    const { claim } = await enroll();
    const original = demoManifest(claim.screen.id, 1);
    await store.putManifest(original);

    expect(await store.getManifest(claim.screen.id)).toEqual(original);
  });
});

describe("télémétrie", () => {
  const playEvent = (eventId: string) => ({
    eventId,
    slideId: "affiche-portes-ouvertes",
    zoneId: "principal",
    manifestVersion: 1,
    startedAt: "2026-08-01T10:00:00.000Z",
    endedAt: "2026-08-01T10:00:09.000Z",
    reason: "completed" as const,
    offline: true,
  });

  dbIt("ne crée aucun doublon quand un lot est rejoué", async () => {
    // C'est la garantie de fond : un player qui renvoie sa file après une
    // coupure de 48 h ne doit pas gonfler le rapport d'une campagne.
    const { claim } = await enroll();
    const eventId = randomUUID();
    const batch = { heartbeats: [], playEvents: [playEvent(eventId)], logs: [] };

    const first = await store.recordTelemetry(claim.screen.id, batch);
    const second = await store.recordTelemetry(claim.screen.id, batch);

    expect(first).toEqual([eventId]);
    // Rejoué : toujours acquitté, sinon l'agent le garderait pour toujours.
    expect(second).toEqual([eventId]);

    const rows = await sql!`SELECT count(*)::int AS n FROM play_events WHERE event_id = ${eventId}`;
    expect(rows[0]!["n"]).toBe(1);
  });

  dbIt("conserve l'heure réelle du passage, pas celle de la remontée", async () => {
    // Sans ça, une coupure de deux jours écraserait tout l'historique sur
    // l'instant de la reconnexion.
    const { claim } = await enroll();
    const eventId = randomUUID();
    await store.recordTelemetry(claim.screen.id, {
      heartbeats: [],
      playEvents: [playEvent(eventId)],
      logs: [],
    });

    const rows = await sql!<{ started_at: Date; received_at: Date }[]>`
      SELECT started_at, received_at FROM play_events WHERE event_id = ${eventId}
    `;
    // L'heure du passage est celle notée par l'écran, pas celle de l'envoi.
    expect(rows[0]!.started_at.toISOString()).toBe("2026-08-01T10:00:00.000Z");
    expect(rows[0]!.received_at.getTime()).toBeGreaterThan(rows[0]!.started_at.getTime());
  });

  dbIt("enregistre battements de cœur et journaux dans le même lot", async () => {
    const { claim } = await enroll();
    const ids = [randomUUID(), randomUUID(), randomUUID()];

    const accepted = await store.recordTelemetry(claim.screen.id, {
      heartbeats: [
        {
          eventId: ids[0]!,
          at: "2026-09-15T10:00:00.000Z",
          state: "degraded",
          manifestVersion: 1,
          wasOffline: true,
          metrics: {
            uptimeSec: 3600,
            freeDiskBytes: 1,
            freeMemoryBytes: 1,
            cacheBytes: 1,
            displayOn: true,
          },
        },
      ],
      playEvents: [playEvent(ids[1]!)],
      logs: [
        {
          eventId: ids[2]!,
          at: "2026-09-15T10:00:00.000Z",
          level: "warn",
          code: "offline",
          message: "réseau perdu",
        },
      ],
    });

    expect(accepted.sort()).toEqual([...ids].sort());
  });
});

describe("migrations", () => {
  dbIt("sont idempotentes", async () => {
    // Rejouées à chaque démarrage : elles ne doivent rien casser.
    expect(await migrate(sql!)).toEqual([]);
  });
});
