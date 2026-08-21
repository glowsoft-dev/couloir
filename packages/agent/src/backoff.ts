/**
 * Rythme des tentatives de reconnexion.
 *
 * Deux problèmes distincts, deux mécanismes :
 *
 *  - pendant la coupure, on espace progressivement les tentatives pour ne
 *    pas s'épuiser en boucle : 5 s, 15 s, 60 s, puis toutes les 5 minutes ;
 *
 *  - au retour du réseau, on attend un délai tiré au hasard entre 0 et 60 s
 *    avant de se manifester. Sans ça, quarante écrans qui redémarrent
 *    ensemble après une coupure de courant tombent tous sur le serveur à
 *    la même seconde.
 */

export const RETRY_STEPS_MS = [5_000, 15_000, 60_000, 300_000] as const;
export const RECONNECT_JITTER_MAX_MS = 60_000;

/** Délai avant la n-ième tentative (0 = première tentative après échec). */
export function retryDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures < 0) throw new RangeError("consecutiveFailures doit être positif");
  const index = Math.min(consecutiveFailures, RETRY_STEPS_MS.length - 1);
  return RETRY_STEPS_MS[index]!;
}

/**
 * Délai de dispersion au retour du réseau.
 * `random` est injecté pour que les tests soient déterministes.
 */
export function reconnectJitterMs(random: () => number = Math.random): number {
  return Math.floor(random() * RECONNECT_JITTER_MAX_MS);
}

/** Depuis combien de temps l'écran n'a pas parlé au serveur, en jours. */
export function offlineDurationDays(lastContactMs: number | null, nowMs: number): number {
  if (lastContactMs === null) return Number.POSITIVE_INFINITY;
  return (nowMs - lastContactMs) / 86_400_000;
}
