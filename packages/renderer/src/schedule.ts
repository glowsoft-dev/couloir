import type { Manifest, Schedule, ScreenSettings } from "@couloir/protocol";
import { isWithinDailyWindow, localMoment, parseClock } from "./time.js";

/**
 * Quelle playlist occupe une zone à un instant donné.
 *
 * Plusieurs programmations peuvent viser la même zone en même temps — une
 * rotation générale toute l'année, une campagne pendant la semaine des portes
 * ouvertes. La priorité départage ; à priorité égale, la plus récemment
 * définie l'emporte, ce qui rend le comportement prévisible pour la personne
 * qui publie.
 */

export function isScheduleActive(schedule: Schedule, nowMs: number, timezone: string): boolean {
  if (schedule.startsAt && nowMs < Date.parse(schedule.startsAt)) return false;
  if (schedule.endsAt && nowMs >= Date.parse(schedule.endsAt)) return false;

  const moment = localMoment(nowMs, timezone);

  if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
    if (!schedule.daysOfWeek.includes(moment.dayOfWeek)) return false;
  }

  if (schedule.dailyStart && schedule.dailyEnd) {
    if (!isWithinDailyWindow(moment.minutesOfDay, schedule.dailyStart, schedule.dailyEnd)) return false;
  }

  return true;
}

/**
 * Playlist active pour une zone.
 * Retombe sur la playlist par défaut de la zone si aucune programmation ne
 * s'applique — une zone n'est jamais vide faute de programmation.
 */
export function activePlaylistId(manifest: Manifest, zoneId: string, nowMs: number): string | null {
  const zone = manifest.layout.zones.find((z) => z.id === zoneId);
  if (!zone) return null;

  const timezone = manifest.settings.timezone;
  const candidates = manifest.schedules
    .filter((s) => s.zoneId === zoneId)
    .filter((s) => isScheduleActive(s, nowMs, timezone));

  if (candidates.length === 0) return zone.playlistId;

  // Priorité la plus haute ; à égalité, la dernière définie gagne.
  let winner = candidates[0]!;
  for (const candidate of candidates.slice(1)) {
    if (candidate.priority >= winner.priority) winner = candidate;
  }
  return winner.playlistId;
}

/**
 * La dalle doit-elle être éteinte en ce moment ?
 *
 * Le rendu s'en sert pour ne pas consommer inutilement, et la coque native
 * pour couper réellement l'alimentation de l'écran. Un message d'urgence
 * passe outre — il rallume.
 *
 * Les jours désignent le jour où la plage COMMENCE, pas celui où on se
 * trouve. « Du lundi au vendredi, 19:00 → 07:30 » éteint donc le vendredi
 * soir jusqu'au samedi matin, et laisse le dimanche soir allumé. C'est la
 * seule lecture naturelle de la phrase, et c'est celle que la console
 * affiche en toutes lettres sous le réglage.
 */
export function isDisplayOffPeriod(settings: ScreenSettings, nowMs: number): boolean {
  const moment = localMoment(nowMs, settings.timezone);
  const veille = ((moment.dayOfWeek + 5) % 7) + 1;

  return settings.displayOff.some((window) => {
    if (!isWithinDailyWindow(moment.minutesOfDay, window.from, window.to)) return false;
    if (window.daysOfWeek.length === 0) return true;

    const start = parseClock(window.from);
    const end = parseClock(window.to);
    // Plage à cheval sur minuit, et on est avant l'heure de rallumage :
    // c'est la plage ouverte hier soir qui court encore.
    const commencéeLaVeille = start > end && moment.minutesOfDay < end;
    return window.daysOfWeek.includes(commencéeLaVeille ? veille : moment.dayOfWeek);
  });
}
