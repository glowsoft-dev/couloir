/**
 * Heure locale de l'école.
 *
 * Toute la programmation est exprimée en heure locale (« lundi, 8 h 00 »),
 * alors que le manifeste circule en UTC. La conversion passe par `Intl`,
 * disponible aussi bien dans Node que dans un WebView Android ou une dalle
 * Tizen — pas de dépendance à une bibliothèque de dates.
 *
 * Sans ça, un écran afficherait la programmation d'hiver en plein été.
 */

export interface LocalMoment {
  /** 1 = lundi … 7 = dimanche, comme dans le manifeste. */
  dayOfWeek: number;
  /** Minutes écoulées depuis minuit, heure locale. */
  minutesOfDay: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

/**
 * La date du jour dans le fuseau de l'école, en AAAA-MM-JJ.
 *
 * Sert à vérifier qu'un emploi du temps reçu est bien celui d'aujourd'hui.
 * Le fuseau du boîtier ne fait pas foi : un écran mal réglé afficherait la
 * mauvaise journée sans que personne comprenne pourquoi.
 */
export function dateLocale(nowMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function localMoment(nowMs: number, timezone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl rend « 24 » pour minuit sur certaines plateformes.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));

  return {
    dayOfWeek: WEEKDAY_INDEX[get("weekday")] ?? 1,
    minutesOfDay: hour * 60 + minute,
  };
}

/** Convertit « 08:30 » en minutes depuis minuit. */
export function parseClock(value: string): number {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Vrai si l'instant tombe dans la fenêtre horaire.
 *
 * Gère le passage de minuit : une extinction « 20:00 → 06:00 » couvre le
 * soir et le petit matin, pas les dix heures entre les deux.
 */
export function isWithinDailyWindow(minutesOfDay: number, from: string, to: string): boolean {
  const start = parseClock(from);
  const end = parseClock(to);
  if (start === end) return true;
  if (start < end) return minutesOfDay >= start && minutesOfDay < end;
  return minutesOfDay >= start || minutesOfDay < end;
}
