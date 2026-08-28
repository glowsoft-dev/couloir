/**
 * La demi-journée en cours, et la taille qui va avec.
 *
 * Une journée entière tient rarement sur une dalle sans devenir illisible :
 * douze séances sur 1080 pixels, c'est du texte de trois centimètres qu'on
 * ne lit pas en passant à quatre mètres. Or personne, dans un couloir à neuf
 * heures, ne cherche la salle du cours de seize heures.
 *
 * On ne montre donc que la demi-journée en cours. Moins de lignes, des lignes
 * plus grandes : les deux vont ensemble, et c'est la même décision.
 */

/** L'heure qui sépare matin et après-midi, en minutes depuis minuit. */
export const BASCULE_PAR_DEFAUT = 13 * 60;

function enMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** L'heure locale de l'établissement, en minutes depuis minuit. */
export function minutesLocales(nowMs: number, timezone: string): number {
  const format = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = format.format(new Date(nowMs)).split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Les séances de la demi-journée en cours.
 *
 * Deux garde-fous, tous deux pour la même raison — un écran vide est pire
 * qu'un écran trop chargé :
 *
 *   - si la demi-journée en cours n'a rien, on montre l'autre. Un couloir à
 *     dix-huit heures doit dire ce qu'il y a demain matin, pas rien ;
 *   - si le tri ne laisse rien du tout, on rend la journée entière.
 */
export function demiJourneeEnCours<T extends { time: string }>(
  entries: readonly T[],
  minutesMaintenant: number,
  bascule = BASCULE_PAR_DEFAUT,
): T[] {
  if (entries.length === 0) return [];

  const matin = entries.filter((e) => enMinutes(e.time) < bascule);
  const apresMidi = entries.filter((e) => enMinutes(e.time) >= bascule);

  const voulue = minutesMaintenant < bascule ? matin : apresMidi;
  if (voulue.length > 0) return voulue;

  const autre = minutesMaintenant < bascule ? apresMidi : matin;
  return autre.length > 0 ? autre : [...entries];
}

/**
 * La taille des lignes, pour qu'elles remplissent la zone.
 *
 * L'échelle typographique générale est tirée de la hauteur de la dalle, ce
 * qui convient à un titre mais pas à une liste : quatre séances dans une
 * colonne de mille pixels laissent les deux tiers vides, et le texte reste
 * petit alors qu'il y a toute la place.
 *
 * On borne des deux côtés. En bas, parce qu'en dessous ça ne se lit plus de
 * loin, et il vaut mieux déborder que mentir sur la lisibilité. En haut,
 * parce qu'une seule séance en lettres géantes ressemble à une panne.
 */
export function tailleDesLignes(
  hauteurZonePx: number,
  nombreDeLignes: number,
  base: number,
): number {
  if (nombreDeLignes <= 0) return base;
  // Chaque ligne occupe environ deux fois et demie sa taille de police :
  // l'intitulé, la salle en dessous, et l'espace entre les lignes.
  const disponible = (hauteurZonePx * 0.82) / nombreDeLignes / 2.5;
  return Math.round(Math.min(Math.max(disponible, base), base * 2.2));
}
