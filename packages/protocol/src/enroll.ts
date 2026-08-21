import { z } from "zod";
import { Capabilities } from "./capabilities.js";
import { DeviceId, IsoDateTime, Orientation, ScreenCode, ScreenId } from "./common.js";

/**
 * Enrôlement d'un écran.
 *
 * La procédure est identique sur toutes les plateformes et se fait sans
 * clavier : l'appareil affiche un code, on le saisit depuis un téléphone.
 *
 *   1. l'appareil génère une paire de clés et se déclare      → EnrollStart
 *   2. il affiche le code d'appairage et attend               → EnrollStatus
 *   3. quelqu'un le rattache à un écran depuis la console     → EnrollClaim
 *   4. l'appareil récupère son identité définitive            → EnrollStatus
 */

/** Six caractères sans ambiguïté visuelle : ni O/0, ni I/1. */
export const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_CODE_TTL_SEC = 24 * 60 * 60;

export const PairingCode = z
  .string()
  .length(PAIRING_CODE_LENGTH)
  .regex(new RegExp(`^[${PAIRING_ALPHABET}]+$`), "code d'appairage invalide");
export type PairingCode = z.infer<typeof PairingCode>;

export const EnrollStartRequest = z.object({
  /** Clé publique Ed25519, en base64url. Sert ensuite à signer les requêtes. */
  publicKey: z.string().min(32),
  capabilities: Capabilities,
  /** Numéro de série ou identifiant matériel, s'il est lisible. */
  hardwareId: z.string().optional(),
});
export type EnrollStartRequest = z.infer<typeof EnrollStartRequest>;

export const EnrollStartResponse = z.object({
  deviceId: DeviceId,
  pairingCode: PairingCode,
  expiresAt: IsoDateTime,
  /** Intervalle d'interrogation pendant l'attente d'appairage. */
  pollIntervalSec: z.number().int().positive(),
});
export type EnrollStartResponse = z.infer<typeof EnrollStartResponse>;

/** Rattachement, déclenché depuis la console. */
export const EnrollClaimRequest = z.object({
  pairingCode: PairingCode,
  /**
   * Écran existant à réactiver — c'est le chemin du remplacement de boîtier :
   * le nouvel appareil hérite des playlists et de l'historique, y compris
   * s'il est d'une autre plateforme.
   */
  existingScreenId: ScreenId.optional(),
  /** Ou création d'un nouvel écran, avec sa position physique. */
  newScreen: z
    .object({
      code: ScreenCode,
      label: z.string().min(1),
      building: z.string().min(1),
      floor: z.number().int(),
      area: z.string().min(1),
      orientation: Orientation,
      groupIds: z.array(z.string()).default([]),
    })
    .optional(),
});
export type EnrollClaimRequest = z.infer<typeof EnrollClaimRequest>;

export const EnrollState = z.enum(["pending", "claimed", "expired", "revoked"]);
export type EnrollState = z.infer<typeof EnrollState>;

export const EnrollStatusResponse = z.object({
  state: EnrollState,
  screenId: ScreenId.optional(),
  screenCode: ScreenCode.optional(),
  /** Délivré une seule fois, au passage en `claimed`. */
  deviceToken: z.string().optional(),
});
export type EnrollStatusResponse = z.infer<typeof EnrollStatusResponse>;

/**
 * Tire un code d'appairage.
 *
 * `randomBytes` est injecté plutôt qu'importé : le protocole doit rester
 * utilisable dans un navigateur et sur Android, où `node:crypto` n'existe pas.
 */
export function generatePairingCode(randomBytes: (n: number) => Uint8Array): PairingCode {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_ALPHABET[bytes[i]! % PAIRING_ALPHABET.length];
  }
  return code;
}
