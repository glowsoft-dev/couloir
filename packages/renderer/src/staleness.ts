import type { DataSourceRef } from "@couloir/protocol";

/**
 * Vieillissement des données vivantes.
 *
 * C'est ce qui empêche un écran de mentir pendant une coupure : un emploi du
 * temps d'hier ne doit jamais s'afficher comme s'il était celui d'aujourd'hui.
 * Chaque source décide de son comportement au-delà de sa durée de validité —
 * garder en affichant la date, se retirer, ou basculer sur un repli.
 */

/** Ce que l'agent a récupéré et gardé en cache pour une source. */
export interface SourceSnapshot {
  fetchedAtMs: number;
  payload: unknown;
}

export type SourceState =
  /** Rien n'a jamais été récupéré : la source ne peut pas s'afficher. */
  | { status: "never-loaded" }
  /** Utilisable. `needsRefresh` dit qu'on a dépassé la fréquence souhaitée. */
  | { status: "usable"; payload: unknown; ageSec: number; needsRefresh: boolean }
  /** Périmée mais affichée, avec sa date de dernière mise à jour. */
  | { status: "stale-shown"; payload: unknown; ageSec: number; fetchedAtMs: number }
  /** Périmée et retirée de la rotation. */
  | { status: "hidden"; ageSec: number }
  /** Périmée, remplacée par le contenu de repli de la source. */
  | { status: "fallback"; ageSec: number };

export function resolveSource(
  source: DataSourceRef,
  snapshot: SourceSnapshot | undefined,
  nowMs: number,
): SourceState {
  if (!snapshot) return { status: "never-loaded" };

  const ageSec = Math.max(0, (nowMs - snapshot.fetchedAtMs) / 1000);

  if (ageSec <= source.maxStaleSec) {
    return {
      status: "usable",
      payload: snapshot.payload,
      ageSec,
      needsRefresh: ageSec > source.ttlSec,
    };
  }

  switch (source.stalePolicy) {
    case "keep-with-date":
      return { status: "stale-shown", payload: snapshot.payload, ageSec, fetchedAtMs: snapshot.fetchedAtMs };
    case "hide":
      return { status: "hidden", ageSec };
    case "fallback":
      return { status: "fallback", ageSec };
  }
}

/** Une source dans cet état peut-elle occuper une diapositive ? */
export function isDisplayable(state: SourceState): boolean {
  return state.status === "usable" || state.status === "stale-shown";
}

/**
 * Mention affichée à l'écran quand la donnée n'est plus fraîche.
 * Elle est lue par des élèves dans un couloir : on donne l'heure, pas un délai
 * en secondes.
 */
export function stalenessLabel(state: SourceState, locale = "fr-FR", timezone = "Europe/Paris"): string | null {
  if (state.status !== "stale-shown") return null;
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(state.fetchedAtMs));
  return `Mis à jour ${time}`;
}
