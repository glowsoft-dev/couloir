/**
 * Repérer un nom de personne dans un afficheur d'emploi du temps.
 *
 * NetYPareo mêle aux groupes des rendez-vous individuels — un entretien de
 * suivi, un bilan — et l'intitulé de la séance est alors le nom de l'élève.
 * Diffusé tel quel, il s'affiche en clair dans un couloir passant.
 *
 * Ce contrôle ne filtre rien : il alerte avant qu'on branche l'afficheur, à
 * côté de la liste complète, pour que quelqu'un tranche. La décision revient
 * à l'établissement, et NetYPareo sait exclure ces séances à la source.
 *
 * Le réglage penche volontairement vers l'alerte de trop. Un intitulé de
 * formation tout en majuscules et sans chiffre — « MECANIQUE AUTOMOBILE » —
 * sera signalé à tort ; on le lit, on hausse les épaules, on passe. L'erreur
 * inverse laisserait le nom d'un élève sur un mur.
 */

/** Sigles de formation. Leur présence dit qu'on lit un intitulé, pas un nom. */
const SIGLES = /\b(BTS|BAC|CAP|MASTER|M1|M2|LICENCE|TITRE|BLOC|PROMO|MC|BP|CQP)\b/i;

export function ressembleÀUnNom(intitulé: string): boolean {
  const mots = intitulé.trim().split(/\s+/);
  // « Prénom NOM », « Prénom Prénom NOM », « Prénom DE LA NOM ».
  if (mots.length < 2 || mots.length > 4) return false;
  // Une promotion porte son millésime, un nom jamais.
  if (/\d/.test(intitulé)) return false;
  if (SIGLES.test(intitulé)) return false;
  // Le patronyme est écrit en capitales. « EL », « DE » sont trop courts
  // pour trancher à eux seuls.
  return mots.some((mot) => mot.length > 2 && mot === mot.toUpperCase());
}

/** Les séances à faire relire, dans l'ordre où elles paraîtraient. */
export function séancesNominatives<T extends { subject: string }>(séances: readonly T[]): T[] {
  return séances.filter((s) => ressembleÀUnNom(s.subject));
}
