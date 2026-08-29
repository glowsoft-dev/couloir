import { z } from "zod";
import { IsoDateTime } from "./common.js";

/**
 * Ce que l'écran renvoie au serveur.
 *
 * Tout est conçu pour le rattrapage après coupure : les événements sont
 * journalisés en local avec leur heure réelle, envoyés par lots au retour
 * du réseau, et purgés seulement après acquittement. Chaque événement porte
 * son propre identifiant, ce qui rend le renvoi idempotent — un lot rejoué
 * deux fois ne crée pas de doublon.
 */

export const AgentState = z.enum([
  /** Démarrage, avant toute décision. */
  "boot",
  /** Horloge jugée peu fiable : on joue le repli plutôt qu'un programme faux. */
  "clock-unreliable",
  /** Récupération du manifeste en cours. */
  "syncing",
  /** Téléchargement des médias manquants, sans interrompre l'affichage. */
  "staging",
  /** Régime normal. */
  "active",
  /** Réseau perdu — l'affichage ne change pas, on réessaie en arrière-plan. */
  "degraded",
  /** Coupure trop longue : playlist de repli embarquée. */
  "fallback",
]);
export type AgentState = z.infer<typeof AgentState>;

export const Heartbeat = z.object({
  /** Généré en local : rend le renvoi après coupure idempotent. */
  eventId: z.string().uuid(),
  at: IsoDateTime,
  state: AgentState,
  manifestVersion: z.number().int().nonnegative(),
  /** Vrai tant que l'écran n'a pas retrouvé le serveur. */
  wasOffline: z.boolean(),
  metrics: z.object({
    uptimeSec: z.number().int().nonnegative(),
    cpuTempC: z.number().optional(),
    freeDiskBytes: z.number().int().nonnegative(),
    freeMemoryBytes: z.number().int().nonnegative(),
    cacheBytes: z.number().int().nonnegative(),
    /** Faux si la dalle est éteinte ou le câble débranché. */
    displayOn: z.boolean(),
  }),
});
export type Heartbeat = z.infer<typeof Heartbeat>;

/** Pourquoi une diapositive s'est arrêtée. */
export const PlayEndReason = z.enum([
  "completed",
  "playlist-changed",
  "emergency",
  "error",
  "shutdown",
]);
export type PlayEndReason = z.infer<typeof PlayEndReason>;

/**
 * Preuve de diffusion : une ligne par passage.
 * C'est ce qui permet de dire à un partenaire combien de fois sa campagne
 * est réellement passée, y compris pendant une coupure réseau.
 */
export const PlayEvent = z.object({
  eventId: z.string().uuid(),
  slideId: z.string(),
  zoneId: z.string(),
  manifestVersion: z.number().int().nonnegative(),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime,
  reason: PlayEndReason,
  /** Vrai si l'événement a été journalisé pendant une coupure. */
  offline: z.boolean(),
  /** Renseigné quand la diapositive appartient à une campagne partenaire. */
  campaignId: z.string().optional(),
});
export type PlayEvent = z.infer<typeof PlayEvent>;

export const AgentLogLevel = z.enum(["info", "warn", "error"]);
export type AgentLogLevel = z.infer<typeof AgentLogLevel>;

/**
 * Ce que la dalle mesure, tel que la page de rendu le voit.
 *
 * Décrit ici parce que la valeur traverse une frontière : elle est produite
 * dans le navigateur, postée à l'agent, puis remontée au serveur. Une forme
 * commune évite que chacun des trois en devine une.
 */
export const ResolutionEcran = z.object({
  largeurPx: z.number().int().nonnegative(),
  hauteurPx: z.number().int().nonnegative(),
  largeurDallePx: z.number().int().nonnegative(),
  hauteurDallePx: z.number().int().nonnegative(),
  densite: z.number().positive(),
  pleinEcran: z.boolean(),
});
export type ResolutionEcran = z.infer<typeof ResolutionEcran>;

export const AgentLog = z.object({
  eventId: z.string().uuid(),
  at: IsoDateTime,
  level: AgentLogLevel,
  code: z.string(),
  message: z.string(),
  context: z.record(z.unknown()).optional(),
});
export type AgentLog = z.infer<typeof AgentLog>;

/** Un lot remonté au serveur. Les trois types voyagent ensemble. */
export const TelemetryBatch = z.object({
  heartbeats: z.array(Heartbeat).default([]),
  playEvents: z.array(PlayEvent).default([]),
  logs: z.array(AgentLog).default([]),
});
export type TelemetryBatch = z.infer<typeof TelemetryBatch>;

/**
 * Réponse du serveur à un lot.
 *
 * `acceptedEventIds` est la seule chose qui autorise l'agent à purger sa
 * file locale. Tant qu'un identifiant n'y figure pas, l'événement reste
 * sur disque et sera renvoyé — c'est ce qui garantit qu'une coupure ne
 * fait perdre aucune preuve de diffusion.
 */
export const TelemetryAck = z.object({
  acceptedEventIds: z.array(z.string()),
  /** Le serveur peut demander à l'agent de ralentir ses envois. */
  nextBatchAfterSec: z.number().int().nonnegative().optional(),
});
export type TelemetryAck = z.infer<typeof TelemetryAck>;
