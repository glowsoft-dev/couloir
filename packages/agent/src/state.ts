import type { AgentState } from "@couloir/protocol";
import { offlineDurationDays, reconnectJitterMs, retryDelayMs } from "./backoff.js";

/**
 * La machine à états de l'agent, écrite comme une fonction pure.
 *
 * Aucun accès réseau, aucun accès disque, aucune horloge implicite : on
 * reçoit un état et un événement, on renvoie le nouvel état et la liste des
 * effets à exécuter. Toute la résilience du projet — la partie la plus
 * risquée et la plus pénible à reproduire sur du vrai matériel — se teste
 * donc en mémoire, en quelques millisecondes.
 *
 * Deux invariants tiennent tout le reste :
 *
 *   1. Une perte de réseau ne change RIEN à ce qui est affiché.
 *   2. On ne bascule sur un nouveau manifeste que lorsque tous ses médias
 *      sont présents et vérifiés. Sinon on reste sur le précédent.
 */

export interface AgentContext {
  state: AgentState;
  /** Version actuellement à l'écran. 0 = rien encore appliqué. */
  activeVersion: number;
  /** Version en cours de préparation, si un téléchargement est en cours. */
  stagingVersion: number | null;
  /** Nombre de médias encore à télécharger pour la version en préparation. */
  missingAssets: number;
  /** Dernier contact réussi avec le serveur, en millisecondes epoch. */
  lastContactMs: number | null;
  consecutiveFailures: number;
  clockReliable: boolean;
}

export type AgentEvent =
  | { type: "boot"; clockReliable: boolean }
  | { type: "clock-synced" }
  | { type: "manifest-unchanged" }
  /** Le serveur répond, mais rien n'a encore été publié sur cet écran. */
  | { type: "manifest-absent" }
  | { type: "manifest-received"; version: number; missingAssets: number }
  | { type: "sync-failed" }
  | { type: "asset-downloaded"; remaining: number }
  | { type: "staging-failed" }
  | { type: "tick" };

export type AgentEffect =
  | { type: "fetch-manifest" }
  | { type: "download-assets"; version: number }
  | { type: "apply-manifest"; version: number }
  | { type: "play-fallback"; reason: "clock-unreliable" | "offline-too-long" }
  | { type: "sync-clock" }
  | { type: "schedule-retry"; delayMs: number }
  | { type: "flush-telemetry" };

export interface AgentSettings {
  offlineGraceDays: number;
  pollIntervalSec: number;
}

export interface Transition {
  context: AgentContext;
  effects: AgentEffect[];
}

export function initialContext(): AgentContext {
  return {
    state: "boot",
    activeVersion: 0,
    stagingVersion: null,
    missingAssets: 0,
    lastContactMs: null,
    consecutiveFailures: 0,
    clockReliable: false,
  };
}

/**
 * @param nowMs   heure courante, injectée pour rester testable
 * @param random  injecté pour que la dispersion soit déterministe en test
 */
export function reduce(
  context: AgentContext,
  event: AgentEvent,
  settings: AgentSettings,
  nowMs: number,
  random: () => number = Math.random,
): Transition {
  switch (event.type) {
    case "boot": {
      // Une horloge fausse produit une programmation fausse. Tant qu'on n'est
      // pas sûr de l'heure, on joue le repli plutôt que n'importe quoi.
      if (!event.clockReliable) {
        return {
          context: { ...context, state: "clock-unreliable", clockReliable: false },
          effects: [{ type: "play-fallback", reason: "clock-unreliable" }, { type: "sync-clock" }],
        };
      }
      return {
        context: { ...context, state: "syncing", clockReliable: true },
        effects: [{ type: "fetch-manifest" }],
      };
    }

    case "clock-synced": {
      return {
        context: { ...context, state: "syncing", clockReliable: true },
        effects: [{ type: "fetch-manifest" }],
      };
    }

    case "manifest-unchanged": {
      // Contact réussi : on repart d'un compteur d'échecs propre.
      const next: AgentContext = {
        ...context,
        state: context.activeVersion > 0 ? "active" : context.state,
        lastContactMs: nowMs,
        consecutiveFailures: 0,
      };
      return {
        context: next,
        effects: [
          { type: "flush-telemetry" },
          { type: "schedule-retry", delayMs: settings.pollIntervalSec * 1000 },
        ],
      };
    }

    case "manifest-absent": {
      // Le contact a réussi : on remet le compteur d'échecs à zéro et on
      // remonte la télémétrie, même s'il n'y a rien à afficher. Sans ça, un
      // écran fraîchement rattaché reste muet dans la console et paraît
      // mort alors qu'il va très bien.
      const base: AgentContext = { ...context, lastContactMs: nowMs, consecutiveFailures: 0 };
      const hasContent = context.activeVersion > 0;
      const retry = { type: "schedule-retry", delayMs: settings.pollIntervalSec * 1000 } as const;

      if (hasContent) {
        return {
          context: { ...base, state: "active" },
          effects: [{ type: "flush-telemetry" }, retry],
        };
      }
      return {
        context: { ...base, state: "fallback" },
        effects:
          context.state === "fallback"
            ? [{ type: "flush-telemetry" }, retry]
            : [
                { type: "play-fallback", reason: "offline-too-long" },
                { type: "flush-telemetry" },
                retry,
              ],
      };
    }

    case "manifest-received": {
      const base: AgentContext = { ...context, lastContactMs: nowMs, consecutiveFailures: 0 };

      // Une version antérieure ou identique ne doit jamais faire régresser
      // l'écran — un manifeste rejoué après coupure est ignoré.
      if (event.version <= context.activeVersion) {
        return {
          context: { ...base, state: "active" },
          effects: [
            { type: "flush-telemetry" },
            { type: "schedule-retry", delayMs: settings.pollIntervalSec * 1000 },
          ],
        };
      }

      // Tout est déjà en cache : on applique immédiatement.
      if (event.missingAssets === 0) {
        return {
          context: {
            ...base,
            state: "active",
            activeVersion: event.version,
            stagingVersion: null,
            missingAssets: 0,
          },
          effects: [
            { type: "apply-manifest", version: event.version },
            { type: "flush-telemetry" },
            { type: "schedule-retry", delayMs: settings.pollIntervalSec * 1000 },
          ],
        };
      }

      // Il manque des médias : on télécharge en tâche de fond SANS toucher
      // à l'affichage. L'écran continue sur la version précédente.
      return {
        context: {
          ...base,
          state: "staging",
          stagingVersion: event.version,
          missingAssets: event.missingAssets,
        },
        effects: [{ type: "download-assets", version: event.version }, { type: "flush-telemetry" }],
      };
    }

    case "asset-downloaded": {
      if (context.stagingVersion === null) return { context, effects: [] };
      if (event.remaining > 0) {
        return { context: { ...context, missingAssets: event.remaining }, effects: [] };
      }
      // Le dernier fichier est arrivé et vérifié : on peut basculer.
      const version = context.stagingVersion;
      return {
        context: {
          ...context,
          state: "active",
          activeVersion: version,
          stagingVersion: null,
          missingAssets: 0,
        },
        effects: [
          { type: "apply-manifest", version },
          { type: "schedule-retry", delayMs: settings.pollIntervalSec * 1000 },
        ],
      };
    }

    case "staging-failed": {
      // On abandonne la nouvelle version et on reste sur l'ancienne.
      // L'écran ne montre jamais un manifeste incomplet.
      const failures = context.consecutiveFailures + 1;
      const hasSomethingOnScreen = context.activeVersion > 0;
      return {
        context: {
          ...context,
          state: hasSomethingOnScreen ? "degraded" : "fallback",
          stagingVersion: null,
          missingAssets: 0,
          consecutiveFailures: failures,
        },
        effects: [
          // Écran fraîchement posé dont le premier téléchargement échoue :
          // il n'a rien à afficher. On bascule sur le contenu embarqué plutôt
          // que de le laisser indéfiniment sur un écran de préparation.
          ...(hasSomethingOnScreen
            ? []
            : [{ type: "play-fallback", reason: "offline-too-long" } as const]),
          { type: "schedule-retry", delayMs: retryDelayMs(failures - 1) },
        ],
      };
    }

    case "sync-failed": {
      const failures = context.consecutiveFailures + 1;
      const offlineDays = offlineDurationDays(context.lastContactMs, nowMs);
      const retry = { type: "schedule-retry", delayMs: retryDelayMs(failures - 1) } as const;

      // Deux raisons distinctes de basculer sur le contenu embarqué :
      //   - la coupure dure depuis trop longtemps, et ce qui est affiché
      //     est devenu faux ;
      //   - l'écran vient d'être posé et n'a jamais rien reçu, donc il n'y
      //     a rien à préserver.
      const contentIsStale = offlineDays > settings.offlineGraceDays;
      const nothingToShow = context.activeVersion === 0;

      if (contentIsStale || nothingToShow) {
        return {
          context: { ...context, state: "fallback", consecutiveFailures: failures },
          // Annoncé à l'entrée dans l'état, pas à chaque tentative ratée.
          effects:
            context.state === "fallback"
              ? [retry]
              : [{ type: "play-fallback", reason: "offline-too-long" }, retry],
        };
      }

      // Cas nominal d'une coupure : on passe en dégradé et on ne touche à
      // RIEN de ce qui est affiché.
      return {
        context: { ...context, state: "degraded", consecutiveFailures: failures },
        effects: [retry],
      };
    }

    case "tick": {
      // Au sortir d'une coupure, on se disperse avant de se manifester.
      if (context.state === "degraded" || context.state === "fallback") {
        return {
          context,
          effects: [
            { type: "schedule-retry", delayMs: reconnectJitterMs(random) },
            { type: "fetch-manifest" },
          ],
        };
      }
      return { context, effects: [{ type: "fetch-manifest" }] };
    }
  }
}

/** Vrai si l'écran affiche quelque chose de valide en ce moment. */
export function isDisplayingContent(context: AgentContext): boolean {
  return context.activeVersion > 0 || context.state === "fallback" || context.state === "clock-unreliable";
}
