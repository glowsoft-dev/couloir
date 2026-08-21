/**
 * Signature des requêtes d'un écran.
 *
 * Jusqu'ici, l'en-tête `x-couloir-device` suffisait à se faire passer pour
 * n'importe quel écran du parc. Chaque appareil signe désormais ses requêtes
 * avec une clé privée générée à son premier démarrage et qui ne quitte jamais
 * le boîtier — le serveur n'en connaît que la partie publique.
 *
 * Ce fichier ne contient QUE le format : ce qui est signé, dans quel ordre.
 * Aucune primitive cryptographique, aucune dépendance. Chaque plateforme
 * signe avec ce qu'elle a — `node:crypto` sur Linux, WebCrypto ailleurs — et
 * elles restent d'accord parce qu'elles calculent la même chaîne.
 */

/** Changer le format de signature impose de changer cette version. */
export const SIGNATURE_VERSION = "couloir-ed25519-v1";

/**
 * Tolérance d'horloge entre l'écran et le serveur.
 *
 * Cinq minutes : assez large pour un Raspberry Pi qui vient de se
 * resynchroniser après une coupure, assez étroit pour que la fenêtre de
 * rejeu reste courte.
 */
export const SIGNATURE_MAX_SKEW_MS = 5 * 60_000;

/** Empreinte SHA-256 d'un corps vide, pour les requêtes sans charge utile. */
export const EMPTY_BODY_DIGEST = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface SigningInput {
  method: string;
  /** Chemin seul, sans le domaine — la chaîne de requête comprise. */
  path: string;
  timestampMs: number;
  /** SHA-256 du corps, en hexadécimal minuscule. */
  bodyDigestHex: string;
}

/**
 * La chaîne exacte que les deux côtés signent puis vérifient.
 *
 * La méthode et le chemin y figurent pour qu'une signature valide ne puisse
 * pas être rejouée sur une autre route ; l'empreinte du corps, pour qu'on ne
 * puisse pas en changer le contenu ; l'horodatage, pour borner la durée de
 * validité.
 */
export function signingPayload(input: SigningInput): string {
  return [
    SIGNATURE_VERSION,
    input.method.toUpperCase(),
    input.path,
    String(input.timestampMs),
    input.bodyDigestHex.toLowerCase(),
  ].join("\n");
}

export type SignatureRejection =
  | "missing-headers"
  | "malformed-timestamp"
  | "clock-skew"
  | "unknown-device"
  | "bad-signature"
  | "replayed";

/** Message rendu au player. Il est journalisé, donc il doit être explicite. */
export function explainRejection(reason: SignatureRejection): string {
  switch (reason) {
    case "missing-headers":
      return "Requête non signée.";
    case "malformed-timestamp":
      return "Horodatage de signature illisible.";
    case "clock-skew":
      return "Horloge de l'appareil trop décalée. Resynchronisez l'heure avant de réessayer.";
    case "unknown-device":
      return "Appareil inconnu ou révoqué.";
    case "bad-signature":
      return "Signature invalide.";
    case "replayed":
      return "Requête déjà présentée.";
  }
}

/** Une signature rejouée est refusée, même dans la fenêtre de tolérance. */
export function isWithinSkew(timestampMs: number, nowMs: number): boolean {
  return Math.abs(nowMs - timestampMs) <= SIGNATURE_MAX_SKEW_MS;
}
