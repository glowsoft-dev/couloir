import { describe, expect, it } from "vitest";
import { FEATURE_PROFILES, HEADERS, ROUTES, type Capabilities } from "@couloir/protocol";
import { buildApp } from "./app.js";
import { MemoryStore } from "./store.js";
import { seedDemoScreen } from "./seed.js";

const CAPS: Capabilities = {
  platform: "linux",
  shellVersion: "0.1.0",
  rendererVersion: "0.1.0",
  agentVersion: "0.1.0",
  display: { widthPx: 1920, heightPx: 1080, orientation: "landscape" },
  codecs: ["h264"],
  maxVideoHeight: 1080,
  storageBudgetBytes: 8 * 1024 ** 3,
  features: { ...FEATURE_PROFILES.linux },
};

/** Enrôle un appareil et renvoie de quoi l'authentifier ensuite. */
async function enroll(app: ReturnType<typeof buildApp>, screenCode = "A·1·12") {
  const start = await app.inject({
    method: "POST",
    url: ROUTES.enrollStart,
    payload: { publicKey: "x".repeat(44), capabilities: CAPS },
  });
  const { deviceId, pairingCode } = start.json();

  const claim = await app.inject({
    method: "POST",
    url: ROUTES.enrollClaim,
    payload: {
      pairingCode,
      newScreen: {
        code: screenCode,
        label: "Hall central",
        building: "A",
        floor: 1,
        area: "hall",
        orientation: "landscape",
        groupIds: [],
      },
    },
  });

  return { deviceId, pairingCode, claim, screenId: claim.json().screenId as string };
}

describe("enrôlement", () => {
  it("rend un code d'appairage lisible à l'écran", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: ROUTES.enrollStart,
      payload: { publicKey: "x".repeat(44), capabilities: CAPS },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.pairingCode).toHaveLength(6);
    // Pas de O ni de 0, pas de I ni de 1 : on le saisit depuis un téléphone,
    // debout dans un couloir.
    expect(body.pairingCode).not.toMatch(/[OI01]/);
  });

  it("reste en attente tant que personne ne l'a rattaché", async () => {
    const app = buildApp();
    const start = await app.inject({
      method: "POST",
      url: ROUTES.enrollStart,
      payload: { publicKey: "x".repeat(44), capabilities: CAPS },
    });
    const { deviceId } = start.json();

    const status = await app.inject({ method: "GET", url: `${ROUTES.enrollStatus}?deviceId=${deviceId}` });
    expect(status.json()).toEqual({ state: "pending" });
  });

  it("délivre son identité une fois rattaché", async () => {
    const app = buildApp();
    const { deviceId, claim } = await enroll(app);

    expect(claim.statusCode).toBe(200);
    expect(claim.json().deviceToken).toBeTruthy();

    const status = await app.inject({ method: "GET", url: `${ROUTES.enrollStatus}?deviceId=${deviceId}` });
    expect(status.json()).toMatchObject({ state: "claimed", screenCode: "A·1·12" });
  });

  it("consomme le code : il ne sert qu'une fois", async () => {
    const app = buildApp();
    const { pairingCode } = await enroll(app);

    const replay = await app.inject({
      method: "POST",
      url: ROUTES.enrollClaim,
      payload: {
        pairingCode,
        newScreen: {
          code: "B·0·03",
          label: "CDI",
          building: "B",
          floor: 0,
          area: "cdi",
          orientation: "landscape",
          groupIds: [],
        },
      },
    });

    expect(replay.statusCode).toBe(404);
  });

  it("refuse un code inconnu avec un message utilisable", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: ROUTES.enrollClaim,
      payload: { pairingCode: "ZZZZZZ", existingScreenId: "peu-importe" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toMatch(/Vérifiez ce qui est affiché/);
  });

  it("transfère un écran à un boîtier d'une autre plateforme", async () => {
    // Le scénario de recette : on remplace un Raspberry Pi par un boîtier
    // Android sans retoucher un seul contenu.
    const app = buildApp();
    const first = await enroll(app);

    const second = await app.inject({
      method: "POST",
      url: ROUTES.enrollStart,
      payload: {
        publicKey: "y".repeat(44),
        capabilities: { ...CAPS, platform: "android", features: { ...FEATURE_PROFILES.android } },
      },
    });
    const { deviceId: newDeviceId, pairingCode: newCode } = second.json();

    const claim = await app.inject({
      method: "POST",
      url: ROUTES.enrollClaim,
      payload: { pairingCode: newCode, existingScreenId: first.screenId },
    });

    expect(claim.statusCode).toBe(200);
    expect(claim.json().screenId).toBe(first.screenId);

    // L'ancien boîtier perd son rattachement, le nouveau l'a.
    const oldStatus = await app.inject({
      method: "GET",
      url: `${ROUTES.enrollStatus}?deviceId=${first.deviceId}`,
    });
    expect(oldStatus.json().state).toBe("pending");

    const newStatus = await app.inject({
      method: "GET",
      url: `${ROUTES.enrollStatus}?deviceId=${newDeviceId}`,
    });
    expect(newStatus.json()).toMatchObject({ state: "claimed", screenId: first.screenId });
  });
});

// Ces cas portent sur le routage et les en-têtes, pas sur la signature :
// celle-ci a ses propres tests dans `auth.test.ts`.
describe("manifeste", () => {
  it("refuse de servir un appareil non rattaché", async () => {
    const app = buildApp({ trustUnsignedDevices: true });
    const start = await app.inject({
      method: "POST",
      url: ROUTES.enrollStart,
      payload: { publicKey: "x".repeat(44), capabilities: CAPS },
    });

    const response = await app.inject({
      method: "GET",
      url: ROUTES.manifest,
      headers: { [HEADERS.deviceId]: start.json().deviceId },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().retryable).toBe(true);
  });

  it("répond 304 quand rien n'a changé", async () => {
    // C'est ce qui garde la consommation réseau sous le seuil annoncé :
    // un écran à jour coûte quelques centaines d'octets par cycle.
    const store = new MemoryStore();
    const app = buildApp({ store, trustUnsignedDevices: true });
    const { deviceId, screenId } = await enroll(app);

    const seeded = await seedDemoScreen(store);
    await store.putManifest({ ...seeded.manifest, screenId });

    const first = await app.inject({
      method: "GET",
      url: ROUTES.manifest,
      headers: { [HEADERS.deviceId]: deviceId },
    });
    expect(first.statusCode).toBe(200);

    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: ROUTES.manifest,
      headers: { [HEADERS.deviceId]: deviceId, "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
  });
});

describe("cohérence du manifeste de démonstration", () => {
  it("ne référence rien dans le vide", async () => {
    // `putManifest` refuse tout manifeste dont une playlist pointerait vers
    // une diapositive supprimée — la panne la plus pénible à diagnostiquer
    // sur un écran posé en hauteur.
    const store = new MemoryStore();
    await expect(seedDemoScreen(store)).resolves.toBeDefined();
  });

  it("rejette un manifeste dont la playlist de repli n'existe pas", async () => {
    const store = new MemoryStore();
    const { manifest } = await seedDemoScreen(store);

    await expect(
      store.putManifest({ ...manifest, version: 2, fallbackPlaylistId: "inexistante" }),
    ).rejects.toThrow(/playlist de repli/);
  });
});

describe("télémétrie", () => {
  it("n'acquitte que les événements reçus", async () => {
    // L'agent ne purge sa file locale que sur cette liste : c'est ce qui
    // garantit qu'une coupure ne fait perdre aucune preuve de diffusion.
    const app = buildApp({ trustUnsignedDevices: true });
    const { deviceId } = await enroll(app);

    const eventId = "3f6b1a2c-0d4e-4f8a-9b1c-2d3e4f5a6b7c";
    const response = await app.inject({
      method: "POST",
      url: ROUTES.telemetry,
      headers: { [HEADERS.deviceId]: deviceId },
      payload: {
        heartbeats: [
          {
            eventId,
            at: "2026-08-21T09:00:00Z",
            state: "active",
            manifestVersion: 1,
            wasOffline: true,
            metrics: {
              uptimeSec: 3600,
              freeDiskBytes: 10_000_000_000,
              freeMemoryBytes: 2_000_000_000,
              cacheBytes: 500_000_000,
              displayOn: true,
            },
          },
        ],
        playEvents: [],
        logs: [],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().acceptedEventIds).toEqual([eventId]);
  });
});

describe("version du lecteur", () => {
  it("annonce ce qui est réellement servi, empreintes comprises", async () => {
    /*
     * L'empreinte est calculée sur le contenu, pas déduite d'un numéro écrit
     * à la main : un fichier remplacé sans que le numéro bouge laisserait les
     * écrans sur l'ancien lecteur en croyant être à jour.
     */
    const app = buildApp();
    const reponse = await app.inject({ method: "GET", url: "/telechargements/version.json" });

    // 503 quand le lecteur n'a pas été construit : c'est un cas normal en
    // développement, et le dire vaut mieux qu'un objet vide.
    if (reponse.statusCode === 503) {
      expect(reponse.json().code).toBe("artefact-absent");
      return;
    }

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json() as {
      version: string;
      fichiers: { nom: string; sha256: string; octets: number }[];
    };
    expect(corps.version).toMatch(/^[0-9a-f]{12}$/);
    expect(corps.fichiers.length).toBeGreaterThan(0);
    for (const fichier of corps.fichiers) {
      expect(fichier.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(fichier.octets).toBeGreaterThan(0);
    }
  });

  it("ne se laisse pas mettre en cache", async () => {
    // Un intermédiaire qui garderait cette réponse figerait le parc sur une
    // version périmée, sans que rien ne le signale.
    const app = buildApp();
    const reponse = await app.inject({ method: "GET", url: "/telechargements/version.json" });
    expect(reponse.headers["cache-control"]).toBe("no-store");
  });
});
