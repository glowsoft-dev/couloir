/**
 * Qui se sert d'un média, côté serveur.
 *
 * La console fait déjà ce calcul pour afficher une colonne « utilisé par ».
 * Celui-ci existe séparément parce qu'il ne sert pas à informer mais à
 * refuser : entre le moment où la bibliothèque s'affiche et celui où l'on
 * clique sur « supprimer », quelqu'un d'autre a pu publier cette image sur un
 * écran. Un contrôle fait dans le navigateur ne verrait rien de tout ça, et
 * l'affiche disparaîtrait d'un mur pendant qu'on la regarde.
 */

export interface EcranConcerne {
  id: string;
  code: string;
  label: string;
}

export interface CompositionDEcran {
  ecran: EcranConcerne;
  /** Tel que le magasin le rend : rien ne garantit sa forme. */
  spec: unknown;
}

/** Les identifiants de médias que porte une composition, quelle qu'en soit la forme. */
export function mediasDeLaComposition(spec: unknown): Set<string> {
  const trouves = new Set<string>();
  if (typeof spec !== "object" || spec === null) return trouves;
  const objet = spec as Record<string, unknown>;

  const items = objet["items"];
  if (Array.isArray(items)) {
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const assetId = (item as Record<string, unknown>)["assetId"];
      if (typeof assetId === "string") trouves.add(assetId);
    }
  }

  // Le contenu par défaut compte autant que la rotation : il s'affiche dès
  // qu'aucune plage n'est programmée, c'est-à-dire souvent la nuit et le
  // week-end.
  const parDefaut = objet["parDefaut"];
  if (typeof parDefaut === "object" && parDefaut !== null) {
    const assetId = (parDefaut as Record<string, unknown>)["assetId"];
    if (typeof assetId === "string") trouves.add(assetId);
  }

  return trouves;
}

/** Les écrans qui afficheraient ce média si on le laissait en place. */
export function ecransQuiUtilisent(
  compositions: readonly CompositionDEcran[],
  assetId: string,
): EcranConcerne[] {
  const concernes: EcranConcerne[] = [];
  for (const { ecran, spec } of compositions) {
    if (mediasDeLaComposition(spec).has(assetId)) concernes.push(ecran);
  }
  return concernes;
}
