import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FEATURE_PROFILES, type Capabilities } from "@couloir/protocol";
import { MemoryStore, OFFLINE_AFTER_MS } from "./store.js";

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

const JOUR_MS = 24 * 60 * 60_000;

function battement(atMs: number) {
  return {
    eventId: randomUUID(),
    at: new Date(atMs).toISOString(),
    state: "degraded" as const,
    manifestVersion: 8,
    wasOffline: true,
    metrics: { uptimeSec: 1, freeDiskBytes: 1, freeMemoryBytes: 1, cacheBytes: 1, displayOn: true },
  };
}

async function ecran(store: MemoryStore) {
  const device = await store.startEnrollment("x".repeat(44), CAPS);
  const { screen } = await store.claimNew(device.deviceId, {
    code: "A·1·1", label: "Hall", building: "A", floor: 1, area: "hall", orientation: "landscape",
  });
  return screen;
}

describe("statut en ligne", () => {
  it("reste en ligne pendant qu'il rattrape une longue coupure", async () => {
    // Le cas réel : huit jours de battements renvoyés du plus ancien au plus
    // récent. Le premier lot reçu date d'une semaine, et l'écran répond
    // pourtant à l'instant même.
    const maintenant = Date.parse("2026-09-15T17:20:00Z");
    const store = new MemoryStore(() => maintenant);
    const screen = await ecran(store);

    await store.recordTelemetry(screen.id, {
      heartbeats: [battement(maintenant - 7 * JOUR_MS)],
      playEvents: [],
      logs: [],
    });

    const [statut] = await store.listScreenStatuses(maintenant);
    expect(statut!.online).toBe(true);
    expect(statut!.lastContactAtMs).toBe(maintenant);
    // L'historique, lui, garde l'heure réelle du battement.
    expect(statut!.lastHeartbeatAtMs).toBe(maintenant - 7 * JOUR_MS);
  });

  it("passe hors ligne quand plus rien n'arrive", async () => {
    let maintenant = Date.parse("2026-09-15T17:20:00Z");
    const store = new MemoryStore(() => maintenant);
    const screen = await ecran(store);
    await store.recordTelemetry(screen.id, { heartbeats: [battement(maintenant)], playEvents: [], logs: [] });

    maintenant += OFFLINE_AFTER_MS + 1;
    const [statut] = await store.listScreenStatuses(maintenant);
    expect(statut!.online).toBe(false);
  });

  it("ne dit pas en ligne un écran qui ne s'est jamais annoncé", async () => {
    const store = new MemoryStore();
    await ecran(store);
    const [statut] = await store.listScreenStatuses();
    expect(statut!.online).toBe(false);
    expect(statut!.lastContactAtMs).toBeNull();
  });
});
