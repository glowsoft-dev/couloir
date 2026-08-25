import type { PublishSpec, ScreenStatus } from "./api.js";

/**
 * Quels écrans montrent l'emploi du temps d'une classe.
 *
 * La question paraît anodine, elle ne l'est pas : quelqu'un signale une
 * absence le matin et veut savoir où ça va apparaître. Répondre « sur les
 * écrans » sans dire lesquels ne sert à rien — et répondre à côté serait
 * pire, puisque personne n'ira vérifier dans le couloir avant la récréation.
 *
 * La règle est celle du composeur, relue depuis les réglages saisis. On la
 * garde ici plutôt que de la deviner à partir du manifeste : le manifeste a
 * déjà résolu les classes en diapositives, et on ne saurait plus distinguer
 * « cette classe précisément » de « toutes les classes défilent ».
 */

/** Ce qu'un écran fait de l'emploi du temps de cette classe. */
export type SortEdt =
  /** L'écran l'affiche : c'est là que le changement se verra. */
  | "affiche"
  /** L'écran a une colonne de cours, mais elle vient de NetYPareo. */
  | "netypareo"
  /** L'écran ne montre pas de cours du tout. */
  | "aucun";

const AVEC_COLONNE = new Set(["principal-et-cours", "emploi-du-temps"]);

export function sortEdt(spec: PublishSpec | null | undefined, classId: string): SortEdt {
  if (!spec || !AVEC_COLONNE.has(spec.layout)) return "aucun";
  /**
   * NetYPareo prend toute la place quand il est branché.
   *
   * Le composeur ne mélange pas les deux sources : dès qu'un afficheur est
   * choisi, les classes locales ne sont plus montées. Un changement saisi
   * ici n'atteindra donc jamais cet écran — il faut le dire, pas le taire.
   */
  if ((spec.timetableAfficheurs ?? []).length > 0) return "netypareo";
  const classes = spec.timetableClassIds ?? [];
  // Aucune classe choisie veut dire « toutes défilent », pas « aucune ».
  return classes.length === 0 || classes.includes(classId) ? "affiche" : "aucun";
}

/**
 * Les colonnes que les écrans concernés montrent, si elles s'accordent.
 *
 * Un aperçu qui affiche la salle alors que les écrans ne la montrent pas
 * ferait relire une information que personne ne lira. On ne restreint donc
 * l'aperçu que lorsque tous les écrans concernés ont fait le même choix ;
 * dès qu'ils divergent, on montre tout, parce qu'aucun réglage ne serait
 * vrai partout et qu'en montrer plus se remarque, quand en montrer moins se
 * paie d'une salle manquante.
 */
export function champsCommuns(specs: readonly (PublishSpec | null | undefined)[]): string[] | undefined {
  const choix = specs.map((s) => s?.timetableChamps);
  if (choix.length === 0) return undefined;
  const premier = choix[0];
  if (premier === undefined) return undefined;
  const signature = JSON.stringify([...premier].sort());
  return choix.every((c) => c !== undefined && JSON.stringify([...c].sort()) === signature)
    ? [...premier]
    : undefined;
}

export interface OuCaSAffiche {
  /** Les écrans où le changement se verra, dans l'ordre du parc. */
  affiche: ScreenStatus[];
  /** Ceux dont la colonne vient de NetYPareo, que ce changement n'atteint pas. */
  netypareo: ScreenStatus[];
}

export function ouCaSAffiche(
  screens: readonly ScreenStatus[],
  compositions: Record<string, PublishSpec | null> | undefined,
  classId: string,
): OuCaSAffiche {
  const affiche: ScreenStatus[] = [];
  const netypareo: ScreenStatus[] = [];
  for (const screen of screens) {
    const sort = sortEdt(compositions?.[screen.id], classId);
    if (sort === "affiche") affiche.push(screen);
    else if (sort === "netypareo") netypareo.push(screen);
  }
  return { affiche, netypareo };
}
