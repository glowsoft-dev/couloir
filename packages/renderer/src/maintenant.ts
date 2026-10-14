/**
 * « Maintenant et ensuite » : ce qu'un écran de couloir doit montrer.
 *
 * Quelqu'un qui passe devant un écran se pose une seule question : où est mon
 * cours ? Il le cherche maintenant, ou dans l'heure qui vient. Le cours de
 * seize heures, à neuf heures, n'intéresse personne — et l'afficher réduit
 * tout le reste à une taille qu'on ne lit plus à quatre mètres.
 *
 * Une journée complète faisait dix à quinze lignes de quatre informations
 * chacune, qui débordaient et défilaient. On ne garde donc que les cours en
 * cours et ceux qui commencent dans les deux heures, réduits à ce qui oriente :
 * l'horaire, le groupe, la salle.
 */

/** Combien de temps à l'avance on annonce un cours. */
export const HORIZON_PAR_DEFAUT_MIN = 120;

/** Durée supposée d'une séance dont l'heure de fin manque. */
const DUREE_SUPPOSEE_MIN = 60;

function enMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export interface Repartition<T> {
  /** Commencés et pas encore terminés. */
  enCours: T[];
  /** Commencent dans l'horizon. */
  aSuivre: T[];
  /** Le premier cours au-delà de l'horizon, pour dire quand ça reprend. */
  prochain: T | null;
  /** Vrai quand plus aucun cours ne reste dans la journée. */
  journeeTerminee: boolean;
}

/**
 * Répartit les séances du jour autour de l'heure courante.
 *
 * Un cours annulé reste dans la liste : c'est précisément l'information que
 * cherche celui qui allait s'y rendre. C'est à l'affichage de dire qu'il est
 * annulé, pas au tri de le faire disparaître.
 */
export function repartirAutourDeMaintenant<T extends { time: string; endTime?: string }>(
  seances: readonly T[],
  minutesMaintenant: number,
  horizonMin = HORIZON_PAR_DEFAUT_MIN,
): Repartition<T> {
  const triees = [...seances].sort((a, b) => enMinutes(a.time) - enMinutes(b.time));
  const enCours: T[] = [];
  const aSuivre: T[] = [];
  let prochain: T | null = null;

  for (const seance of triees) {
    const debut = enMinutes(seance.time);
    const fin = seance.endTime ? enMinutes(seance.endTime) : debut + DUREE_SUPPOSEE_MIN;
    if (debut <= minutesMaintenant && minutesMaintenant < fin) {
      enCours.push(seance);
    } else if (minutesMaintenant < debut && debut <= minutesMaintenant + horizonMin) {
      aSuivre.push(seance);
    } else if (debut > minutesMaintenant + horizonMin && prochain === null) {
      prochain = seance;
    }
  }

  const journeeTerminee =
    enCours.length === 0 && aSuivre.length === 0 && prochain === null;
  return { enCours, aSuivre, prochain, journeeTerminee };
}

/**
 * La salle, réduite à ce qu'on lit sur la porte.
 *
 * NetYPareo écrit « CCI SALLE A14 » : sur un écran de couloir, seul « A14 »
 * oriente, et le préfixe mange la moitié de la largeur. Ce qui ne suit pas ce
 * modèle — « A distance », « Gymnase » — est laissé tel quel.
 */
export function salleCourte(salle: string): string {
  const courte = salle
    .trim()
    .replace(/^CCI\s+/i, "")
    .replace(/^SALLE\s+/i, "")
    .trim();
  return courte || salle.trim();
}

/**
 * Le lieu, écrit pour un passant.
 *
 * L'afficheur s'appelle « Campus by CCI Nievre Bat A » dans NetYPareo. On en
 * tire « Bâtiment A ». Un libellé qui ne suit pas ce modèle est gardé tel quel.
 */
export function lieuLisible(libelle: string): string {
  const batiment = /\bb[aâ]t(?:iment)?\.?\s+([A-Z0-9]+)\s*$/i.exec(libelle.trim());
  return batiment ? `Bâtiment ${batiment[1]!.toUpperCase()}` : libelle.trim();
}

/**
 * Le campus, tiré du même libellé quand le serveur ne l'a pas transmis.
 *
 * « Campus by CCI Nievre Bat A » donne « Campus by CCI Nievre ». Le nom
 * enregistré dans la console, accentué, est préféré quand il est connu : le
 * libellé de NetYPareo est écrit sans accents.
 */
export function campusDe(libelle: string): string {
  const reste = libelle.trim().replace(/\s*\bb[aâ]t(?:iment)?\.?\s+[A-Z0-9]+\s*$/i, "").trim();
  return reste === libelle.trim() ? "" : reste;
}

/**
 * Une heure « 08:30 » écrite comme on la dit : « 8 h 30 », « 14 h ».
 *
 * Les deux-points sont une écriture d'ordinateur ; un panneau de couloir
 * s'adresse à des gens.
 */
export function heureLisible(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || Number.isNaN(h)) return hhmm;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
