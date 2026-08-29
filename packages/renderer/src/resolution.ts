/**
 * Ce que la dalle dit d'elle-même, et ce qu'on en fait.
 *
 * Le rendu dérive toutes ses tailles de la hauteur disponible. Encore
 * faut-il que cette hauteur soit la bonne : jusqu'ici elle était lue une
 * fois, sans jamais vérifier qu'elle correspondait à la dalle réelle. Un
 * navigateur lancé en fenêtre plutôt qu'en plein écran donnait donc une
 * mise en page calculée pour une surface qui n'était pas celle de l'écran,
 * et personne ne pouvait le voir depuis la console.
 */

/** Part de la dalle qu'il faut couvrir pour se dire en plein écran. */
export const COUVERTURE_ATTENDUE = 0.92;

export const ZOOM_MINIMUM = 0.6;
export const ZOOM_MAXIMUM = 2.5;

export interface Resolution {
  /** La surface réellement dessinée, en pixels CSS. */
  largeurPx: number;
  hauteurPx: number;
  /** La dalle, telle que le système la déclare. Zéro si on ne sait pas. */
  largeurDallePx: number;
  hauteurDallePx: number;
  /**
   * Deux sur un écran haute densité : un pixel CSS y vaut deux points
   * physiques. On ne s'en sert pas pour dimensionner — le pixel CSS est déjà
   * la bonne unité pour la lisibilité — mais pour le dire à la console, qui
   * sinon annoncerait du 1080p sur une dalle 4K.
   */
  densite: number;
  /**
   * Faux quand la fenêtre ne couvre pas la dalle.
   *
   * C'est le défaut qui coûte le plus cher à diagnostiquer sur place : tout
   * fonctionne, le contenu arrive, et l'écran affiche une vignette entourée
   * de noir. Vu du couloir, ça ressemble à un problème de contenu.
   */
  pleinEcran: boolean;
}

/**
 * Le zoom demandé, ramené dans des bornes tenables.
 *
 * En dessous du minimum le texte cesse d'être lisible de loin, ce que tout
 * le reste du rendu s'emploie à éviter ; au-dessus du maximum il ne reste
 * plus qu'une ligne à l'écran. On corrige en silence plutôt que de refuser :
 * un réglage aberrant ne doit pas éteindre un écran.
 */
export function facteurDeZoom(zoom: number | null | undefined): number {
  if (typeof zoom !== "number" || !Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.min(Math.max(zoom, ZOOM_MINIMUM), ZOOM_MAXIMUM);
}

export function lireResolution(
  largeurPx: number,
  hauteurPx: number,
  dalle: { largeur: number; hauteur: number; densite: number },
): Resolution {
  const largeurDallePx = Math.round(dalle.largeur) || 0;
  const hauteurDallePx = Math.round(dalle.hauteur) || 0;
  /*
   * Sans dalle déclarée, on ne conclut pas.
   *
   * Un WebView embarqué ne renseigne pas toujours `screen`. Annoncer une
   * anomalie dans ce cas ferait douter d'un écran qui va très bien, et la
   * console finirait par être lue comme un bruit de fond.
   */
  const mesurable = largeurDallePx > 0 && hauteurDallePx > 0;
  const pleinEcran =
    !mesurable ||
    (largeurPx >= largeurDallePx * COUVERTURE_ATTENDUE &&
      hauteurPx >= hauteurDallePx * COUVERTURE_ATTENDUE);

  return {
    largeurPx: Math.round(largeurPx),
    hauteurPx: Math.round(hauteurPx),
    largeurDallePx,
    hauteurDallePx,
    densite: dalle.densite > 0 ? dalle.densite : 1,
    pleinEcran,
  };
}

/** Vrai quand deux relevés diffèrent assez pour être renvoyés au serveur. */
export function resolutionChangee(a: Resolution | null, b: Resolution): boolean {
  if (!a) return true;
  return (
    a.largeurPx !== b.largeurPx ||
    a.hauteurPx !== b.hauteurPx ||
    a.largeurDallePx !== b.largeurDallePx ||
    a.hauteurDallePx !== b.hauteurDallePx ||
    a.densite !== b.densite ||
    a.pleinEcran !== b.pleinEcran
  );
}
