import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FEATURE_PROFILES,
  HEADERS,
  ROUTES,
  SIGNATURE_MAX_SKEW_MS,
  type Capabilities,
  demoManifest,
  signingPayload,
} from "@couloir/protocol";
import { buildApp } from "./app.js";
import { ReplayGuard, verifySignature } from "./auth.js";
import { MemoryStore } from "./store.js";

/**
 * L'authentification des appareils.
 *
 * Sans elle, l'en-tête `x-couloir-device` suffisait à lire le manifeste de
 * n'importe quel écran et — bien pire — à injecter de fausses preuves de
 * diffusion dans le rapport d'une campagne.
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

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return {
    publicKey: Buffer.from(spki.subarray(spki.length - 32)).toString("base64url"),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

function signed(
  privateKeyPem: string,
  deviceId: string,
  method: string,
  path: string,
  body?: string,
  timestampMs = Date.now(),
): Record<string, string> {
  const bodyDigestHex = createHash("sha256")
    .update(body ?? "")
    .digest("hex");
  const payload = signingPayload({ method, path, timestampMs, bodyDigestHex });
  const signature = sign(null, Buffer.from(payload, "utf8"), createPrivateKey(privateKeyPem));
  return {
    [HEADERS.deviceId]: deviceId,
    [HEADERS.timestamp]: String(timestampMs),
    [HEADERS.signature]: signature.toString("base64url"),
  };
}

/** Monte un serveur avec un écran enrôlé, prêt à recevoir des requêtes signées. */
async function ready() {
  const store = new MemoryStore();
  const app = buildApp({ store });
  const pair = keys();

  const start = await app.inject({
    method: "POST",
    url: ROUTES.enrollStart,
    payload: { publicKey: pair.publicKey, capabilities: CAPS },
  });
  const { deviceId, pairingCode } = start.json();

  const claim = await app.inject({
    method: "POST",
    url: ROUTES.enrollClaim,
    payload: {
      pairingCode,
      newScreen: {
        code: "A·1·12",
        label: "Hall",
        building: "A",
        floor: 1,
        area: "hall",
        orientation: "landscape",
        groupIds: [],
      },
    },
  });
  const screenId = claim.json().screenId as string;
  await store.putManifest(demoManifest(screenId, 1));

  return { app, store, deviceId, screenId, ...pair };
}

describe("accès au manifeste", () => {
  it("accepte une requête correctement signée", async () => {
    const { app, deviceId, privateKeyPem } = await ready();
    const response = await app.inject({
      method: "GET",
      url: ROUTES.manifest,
      headers: signed(privateKeyPem, deviceId, "GET", ROUTES.manifest),
    });

    expect(response.statusCode).toBe(200);
  });

  it("refuse une requête non signée", async () => {
    // C'était exactement le trou : cet en-tête seul suffisait.
    const { app, deviceId } = await ready();
    const response = await app.inject({
      method: "GET",
      url: ROUTES.manifest,
      headers: { [HEADERS.deviceId]: deviceId },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("missing-headers");
  });

  it("refuse une signature produite par une autre clé", async () => {
    const { app, deviceId } = await ready();
    const attacker = keys();

    const response = await app.inject({
      method: "GET",
      url: ROUTES.manifest,
      headers: signed(attacker.privateKeyPem, deviceId, "GET", ROUTES.manifest),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("bad-signature");
  });

  it("refuse une signature valide rejouée sur une autre route", async () => {
    // La méthode et le chemin font partie de ce qui est signé.
    const { app, deviceId, privateKeyPem } = await ready();
    const headers = signed(privateKeyPem, deviceId, "GET", ROUTES.manifest);

    const response = await app.inject({ method: "POST", url: ROUTES.telemetry, headers, payload: {} });
    expect(response.statusCode).toBe(401);
  });

  it("refuse une horloge trop décalée, mais invite à réessayer", async () => {
    const { app, deviceId, privateKeyPem } = await ready();
    const stale = Date.now() - SIGNATURE_MAX_SKEW_MS - 10_000;

    const response = await app.inject({
      method: "GET",
      url: ROUTES.manifest,
      headers: signed(privateKeyPem, deviceId, "GET", ROUTES.manifest, undefined, stale),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("clock-skew");
    // Un Pi qui vient de resynchroniser son heure doit pouvoir repartir.
    expect(response.json().retryable).toBe(true);
    expect(response.json().message).toMatch(/Resynchronisez l'heure/);
  });

  it("tolère une petite dérive d'horloge", async () => {
    const { app, deviceId, privateKeyPem } = await ready();
    const slightlyOff = Date.now() - 60_000;

    const response = await app.inject({
      method: "GET",
      url: ROUTES.manifest,
      headers: signed(privateKeyPem, deviceId, "GET", ROUTES.manifest, undefined, slightlyOff),
    });

    expect(response.statusCode).toBe(200);
  });

  it("refuse un boîtier détaché de son écran", async () => {
    // C'est le chemin de la révocation : un boîtier volé cesse d'être servi.
    const { app, store, deviceId, privateKeyPem, screenId } = await ready();

    const replacement = keys();
    const start = await app.inject({
      method: "POST",
      url: ROUTES.enrollStart,
      payload: { publicKey: replacement.publicKey, capabilities: CAPS },
    });
    await app.inject({
      method: "POST",
      url: ROUTES.enrollClaim,
      payload: { pairingCode: start.json().pairingCode, existingScreenId: screenId },
    });
    expect((await store.getDevice(deviceId))?.screenId).toBeNull();

    const response = await app.inject({
      method: "GET",
      url: ROUTES.manifest,
      headers: signed(privateKeyPem, deviceId, "GET", ROUTES.manifest),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("unknown-device");
  });
});

describe("télémétrie signée", () => {
  const batch = {
    heartbeats: [
      {
        eventId: "6f1c3a2b-0d4e-4f8a-9b1c-2d3e4f5a6b7c",
        at: "2026-08-01T10:00:00Z",
        state: "active",
        manifestVersion: 1,
        wasOffline: false,
        metrics: {
          uptimeSec: 60,
          freeDiskBytes: 1,
          freeMemoryBytes: 1,
          cacheBytes: 1,
          displayOn: true,
        },
      },
    ],
    playEvents: [],
    logs: [],
  };

  it("accepte un lot correctement signé", async () => {
    const { app, deviceId, privateKeyPem } = await ready();
    const body = JSON.stringify(batch);

    const response = await app.inject({
      method: "POST",
      url: ROUTES.telemetry,
      headers: {
        ...signed(privateKeyPem, deviceId, "POST", ROUTES.telemetry, body),
        "content-type": "application/json",
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
  });

  it("refuse un corps modifié après signature", async () => {
    // L'empreinte du corps fait partie de ce qui est signé : on ne peut pas
    // glisser de fausses preuves de diffusion dans un lot authentique.
    const { app, deviceId, privateKeyPem } = await ready();
    const headers = signed(privateKeyPem, deviceId, "POST", ROUTES.telemetry, JSON.stringify(batch));

    const tampered = JSON.stringify({
      ...batch,
      playEvents: [
        {
          eventId: "aaaaaaaa-0d4e-4f8a-9b1c-2d3e4f5a6b7c",
          slideId: "pub-partenaire",
          zoneId: "principal",
          manifestVersion: 1,
          startedAt: "2026-08-01T10:00:00Z",
          endedAt: "2026-08-01T10:00:09Z",
          reason: "completed",
          offline: false,
          campaignId: "campagne-truquee",
        },
      ],
    });

    const response = await app.inject({
      method: "POST",
      url: ROUTES.telemetry,
      headers: { ...headers, "content-type": "application/json" },
      payload: tampered,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("bad-signature");
  });

  it("refuse le rejeu d'un lot authentique", async () => {
    // Sans ça, rejouer dix fois le même envoi gonflerait le rapport d'une
    // campagne avec des signatures parfaitement valides.
    const { app, deviceId, privateKeyPem } = await ready();
    const body = JSON.stringify(batch);
    const headers = {
      ...signed(privateKeyPem, deviceId, "POST", ROUTES.telemetry, body),
      "content-type": "application/json",
    };

    const first = await app.inject({ method: "POST", url: ROUTES.telemetry, headers, payload: body });
    const replay = await app.inject({ method: "POST", url: ROUTES.telemetry, headers, payload: body });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe("replayed");
  });
});

describe("enrôlement", () => {
  it("reste accessible sans signature", async () => {
    // L'appareil n'a pas encore d'identité reconnue : c'est le rôle du code
    // d'appairage, saisi par un humain, de faire ce premier pont.
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: ROUTES.enrollStart,
      payload: { publicKey: keys().publicKey, capabilities: CAPS },
    });

    expect(response.statusCode).toBe(201);
  });
});

describe("fenêtre anti-rejeu", () => {
  it("oublie les signatures sorties de la fenêtre de tolérance", async () => {
    // Au-delà, l'horodatage les fait refuser de toute façon : les garder en
    // mémoire ferait grossir la table indéfiniment.
    let now = 1_000_000;
    const guard = new ReplayGuard(60_000, () => now);

    expect(guard.accept("signature-a")).toBe(true);
    expect(guard.accept("signature-a")).toBe(false);

    now += 61_000;
    expect(guard.accept("signature-b")).toBe(true);
    expect(guard.size).toBe(1);
  });
});

describe("format de clé", () => {
  it("accepte une clé publique brute en base64url", async () => {
    // Le format que produisent naturellement WebCrypto et les bibliothèques
    // Android : les futures coques n'auront rien à convertir.
    const pair = keys();
    const payload = "peu importe";
    const signature = sign(
      null,
      Buffer.from(payload, "utf8"),
      createPrivateKey(pair.privateKeyPem),
    ).toString("base64url");

    expect(verifySignature(pair.publicKey, payload, signature)).toBe(true);
    expect(verifySignature(pair.publicKey, "autre chose", signature)).toBe(false);
  });

  it("refuse proprement une clé illisible", () => {
    expect(verifySignature("pas-une-clé", "message", "c2ln")).toBe(false);
  });
});
