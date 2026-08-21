import { z } from "zod";

/**
 * Types de base partagés par tout le protocole.
 *
 * Règle du paquet : on n'utilise que des primitives sérialisables en JSON.
 * Les dates circulent en ISO 8601 UTC, jamais en objet Date — un player
 * Android, un Electron et un navigateur doivent tous lire la même chose.
 */

export const IsoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/,
    "date ISO 8601 UTC attendue (ex. 2026-08-21T09:30:00Z)",
  );
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Identifiant du matériel. Change quand on remplace le boîtier. */
export const DeviceId = z.string().min(8).max(64);
export type DeviceId = z.infer<typeof DeviceId>;

/**
 * Identifiant logique de l'écran — l'emplacement, pas la machine.
 * C'est lui qui porte les playlists et l'historique : remplacer un
 * Raspberry Pi par un boîtier Android ne change pas le ScreenId.
 */
export const ScreenId = z.string().min(1).max(64);
export type ScreenId = z.infer<typeof ScreenId>;

/**
 * Code de repérage physique, tel qu'il est imprimé sur l'étiquette :
 * bâtiment · étage · numéro. Lisible de loin, saisissable sans se tromper.
 */
export const ScreenCode = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9]{0,3}·-?\d{1,2}·\d{1,3}$/,
    "code attendu de la forme A·1·12 (bâtiment · étage · numéro)",
  );
export type ScreenCode = z.infer<typeof ScreenCode>;

export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/, "empreinte sha256 en minuscules attendue");
export type Sha256 = z.infer<typeof Sha256>;

export const Orientation = z.enum(["landscape", "portrait"]);
export type Orientation = z.infer<typeof Orientation>;

export const SCHEMA_VERSION = 1 as const;

/**
 * Enveloppe d'erreur unique pour toute l'API.
 * `retryable` dit à l'agent s'il doit réessayer ou abandonner : sans ça,
 * un player hors ligne boucle sur une erreur définitive.
 */
export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;
