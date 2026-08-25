import type { PublishItem } from "./api.js";

/**
 * Un contenu en cours d'édition.
 *
 * Deux champs de plus que ce qu'on publie. `key` reste stable pendant qu'on
 * réordonne : sans elle, React réutilise la ligne de la case voisine et le
 * curseur saute d'un champ à l'autre en pleine frappe. `title` est le nom du
 * fichier, que le manifeste ne porte pas — l'écran n'en a que faire, mais on
 * ne compose pas une rotation avec des identifiants.
 *
 * Défini une fois : la même déclaration vivait dans quatre fichiers, et rien
 * n'aurait signalé qu'ils divergent.
 */
export type Draft = PublishItem & { key: string; title: string };
