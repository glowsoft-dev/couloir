import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import {
  EMPTY_BODY_DIGEST,
  HEADERS,
  type SigningInput,
  signingPayload,
} from "@couloir/protocol";

/**
 * La clé de l'appareil.
 *
 * Générée au premier démarrage, elle ne quitte jamais le boîtier : le
 * serveur n'en reçoit que la partie publique. Une base serveur compromise ne
 * permet donc pas d'usurper un écran, et révoquer un boîtier volé revient à
 * effacer sa clé publique côté serveur.
 */

export interface DeviceKeyPair {
  /** Clé privée au format PKCS#8 PEM, conservée sur le disque de l'appareil. */
  privateKeyPem: string;
  /** 32 octets bruts en base64url — le format que produisent aussi WebCrypto
   *  et les bibliothèques Android, pour que les futures coques n'aient rien
   *  à convertir. */
  publicKey: string;
}

export function generateDeviceKeys(): DeviceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    // Les 32 derniers octets du SPKI sont la clé brute.
    publicKey: Buffer.from(spki.subarray(spki.length - 32)).toString("base64url"),
  };
}

export function digestBody(body: string | Buffer | undefined): string {
  if (body === undefined || body.length === 0) return EMPTY_BODY_DIGEST;
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Signe une requête et renvoie les en-têtes à y joindre.
 *
 * L'horodatage est celui de l'appareil : si son horloge dérive de plus de
 * cinq minutes, le serveur refuse et le dit explicitement, plutôt que de
 * laisser un écran échouer sans qu'on comprenne pourquoi.
 */
export function signRequest(
  privateKeyPem: string,
  deviceId: string,
  agentVersion: string,
  input: Omit<SigningInput, "timestampMs" | "bodyDigestHex"> & {
    body?: string | Buffer;
    timestampMs?: number;
  },
): Record<string, string> {
  const timestampMs = input.timestampMs ?? Date.now();
  const payload = signingPayload({
    method: input.method,
    path: input.path,
    timestampMs,
    bodyDigestHex: digestBody(input.body),
  });

  const signature = sign(null, Buffer.from(payload, "utf8"), createPrivateKey(privateKeyPem));

  return {
    [HEADERS.deviceId]: deviceId,
    [HEADERS.agentVersion]: agentVersion,
    [HEADERS.timestamp]: String(timestampMs),
    [HEADERS.signature]: signature.toString("base64url"),
  };
}
