import { createHash, createPublicKey, verify } from "node:crypto";
import {
  EMPTY_BODY_DIGEST,
  HEADERS,
  type SignatureRejection,
  isWithinSkew,
  signingPayload,
} from "@couloir/protocol";
import type { Store } from "./store.js";

/**
 * Vérification des signatures d'appareil.
 *
 * Sans elle, l'en-tête `x-couloir-device` suffisait à se faire passer pour
 * n'importe quel écran : lire son manifeste, et surtout injecter de fausses
 * preuves de diffusion dans le rapport d'une campagne.
 *
 * Le serveur ne détient que des clés publiques. Une base compromise ne
 * permet donc pas d'usurper un écran.
 */

export interface VerificationSuccess {
  ok: true;
  deviceId: string;
  screenId: string;
}

export interface VerificationFailure {
  ok: false;
  reason: SignatureRejection;
}

export type VerificationResult = VerificationSuccess | VerificationFailure;

export function bodyDigest(body: Buffer | string | undefined): string {
  if (body === undefined || body.length === 0) return EMPTY_BODY_DIGEST;
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Fenêtre anti-rejeu.
 *
 * L'horodatage seul laisse une signature valide rejouable pendant toute la
 * tolérance d'horloge. On mémorise donc les signatures déjà vues, le temps
 * que leur horodatage sorte de la fenêtre — après quoi elles sont refusées
 * de toute façon, et la mémoire peut être rendue.
 */
export class ReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Vrai si la signature est nouvelle. Faux si elle a déjà été présentée. */
  accept(signature: string): boolean {
    const now = this.now();
    this.evictExpired(now);
    if (this.seen.has(signature)) return false;
    this.seen.set(signature, now);
    return true;
  }

  private evictExpired(now: number): void {
    for (const [signature, at] of this.seen) {
      if (now - at > this.windowMs) this.seen.delete(signature);
      // La Map itère dans l'ordre d'insertion : dès qu'on tombe sur une
      // entrée assez récente, les suivantes le sont aussi.
      else break;
    }
  }

  get size(): number {
    return this.seen.size;
  }
}

export interface VerifyInput {
  method: string;
  /** Chemin et chaîne de requête, tels que reçus. */
  url: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer | string | undefined;
}

export async function verifyRequest(
  input: VerifyInput,
  store: Store,
  guard: ReplayGuard,
  nowMs: number = Date.now(),
): Promise<VerificationResult> {
  const deviceId = header(input.headers, HEADERS.deviceId);
  const signature = header(input.headers, HEADERS.signature);
  const timestamp = header(input.headers, HEADERS.timestamp);

  if (!deviceId || !signature || !timestamp) return { ok: false, reason: "missing-headers" };

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) return { ok: false, reason: "malformed-timestamp" };
  if (!isWithinSkew(timestampMs, nowMs)) return { ok: false, reason: "clock-skew" };

  const device = await store.getDevice(deviceId);
  // Un boîtier détaché — révoqué, ou remplacé par un autre — ne passe plus.
  if (!device?.screenId) return { ok: false, reason: "unknown-device" };

  const payload = signingPayload({
    method: input.method,
    path: input.url,
    timestampMs,
    bodyDigestHex: bodyDigest(input.rawBody),
  });

  if (!verifySignature(device.publicKey, payload, signature)) {
    return { ok: false, reason: "bad-signature" };
  }

  // Vérifié en dernier : inutile de mémoriser une signature invalide, un
  // attaquant remplirait la table à coups de requêtes bidon.
  if (!guard.accept(signature)) return { ok: false, reason: "replayed" };

  return { ok: true, deviceId, screenId: device.screenId };
}

/** La clé publique circule en base64url brute (32 octets Ed25519). */
export function verifySignature(publicKeyBase64Url: string, payload: string, signatureBase64Url: string): boolean {
  try {
    const key = createPublicKey({
      key: derFromRawEd25519(Buffer.from(publicKeyBase64Url, "base64url")),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(payload, "utf8"), key, Buffer.from(signatureBase64Url, "base64url"));
  } catch {
    // Clé illisible, signature mal formée : c'est un refus, pas une panne.
    return false;
  }
}

/**
 * Enrobe 32 octets de clé brute dans l'enveloppe SPKI attendue par Node.
 *
 * On transporte la clé brute plutôt qu'un PEM : c'est le format que
 * produisent naturellement WebCrypto et les bibliothèques Android, et les
 * futures coques n'auront donc rien à convertir.
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function derFromRawEd25519(raw: Buffer): Buffer {
  if (raw.length !== 32) throw new Error("clé Ed25519 attendue sur 32 octets");
  return Buffer.concat([ED25519_SPKI_PREFIX, raw]);
}

function header(headers: VerifyInput["headers"], name: string): string | null {
  const value = headers[name];
  return typeof value === "string" ? value : null;
}
