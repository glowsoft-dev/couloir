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
/**
 * La taille au-dessous de laquelle on refuse de descendre, en multiple de la
 * taille de base de la dalle. À 1080p la base vaut 21 px : le plancher tombe
 * donc à 36 px, ce qui se lit debout à quatre mètres.
 */
export const PLANCHER_LISIBLE = 1.7;

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
  /*
   * Chaque ligne occupe environ deux fois et demie sa taille de police :
   * l'intitulé, le module en dessous, et l'espace entre les lignes.
   *
   * On vise 90 % de la hauteur plutôt que la totalité — il faut de la marge
   * pour le sur-titre et pour qu'une journée un peu plus chargée que prévu
   * ne déborde pas hors de l'écran, où personne ne la verra.
   */
  const disponible = (hauteurZonePx * 0.9) / nombreDeLignes / 2.5;
  /*
   * Le plancher, qui est le vrai sujet.
   *
   * La première version rapetissait le texte jusqu'à ce que la journée
   * entière tienne dans la dalle. C'est le mauvais arbitrage : une liste
   * complète que personne ne peut lire en passant ne vaut pas mieux qu'une
   * dalle éteinte. On garde donc une taille lisible à quatre mètres même
   * quand ça déborde — et ce qui déborde défile, voir defilement().
   */
  const plancher = base * PLANCHER_LISIBLE;
  /*
   * Le plafond est haut, à quatre fois la base.
   *
   * Il ne sert qu'à empêcher qu'une séance unique remplisse la dalle de
   * lettres géantes, ce qui ressemble à une panne. Trop bas, il annule tout
   * l'intérêt : cinq séances dans mille pixels ont la place d'être lues à
   * quatre mètres, et c'est la seule chose qu'on demande à un écran de
   * couloir.
   */
  return Math.round(Math.min(Math.max(disponible, plancher), base * 4));
}

/**
 * Le défilement d'une liste trop longue pour sa zone.
 *
 * Rendu nécessaire par le plancher ci-dessus : puisqu'on refuse de rapetisser
 * le texte, une journée chargée dépasse, et les dernières séances de la
 * journée — celles qu'on affiche le matin pour l'après-midi — tomberaient
 * hors de l'écran sans que personne le sache.
 *
 * Rend `null` quand tout tient : une liste courte qui se met à bouger
 * attire l'oeil pour rien, et sur un mur ça fatigue.
 */
export function defilement(
  hauteurContenuPx: number,
  hauteurVisiblePx: number,
): { coursePx: number; dureeMs: number } | null {
  const debord = Math.ceil(hauteurContenuPx - hauteurVisiblePx);
  // Sous quelques pixels, c'est une erreur d'arrondi de mise en page, pas du
  // contenu caché. Faire défiler pour ça ne montrerait rien de plus.
  if (debord < 8) return null;
  /*
   * Assez lent pour se lire, et le trajet compte double : la liste descend,
   * puis remonte. Les deux temps d'arrêt laissent le temps de lire le haut
   * — l'heure qu'il est — et le bas — la fin de la journée.
   */
  const VITESSE_PX_PAR_SECONDE = 28;
  const ARRETS_MS = 6000;
  return {
    coursePx: debord,
    dureeMs: Math.round((debord / VITESSE_PX_PAR_SECONDE) * 2 * 1000) + ARRETS_MS,
  };
}
