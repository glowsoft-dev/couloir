/**
 * Qui a le droit de faire quoi.
 *
 * Trois rôles, pas davantage. Un système de permissions fines se paie en
 * réglages que personne ne comprend et que tout le monde finit par mettre au
 * maximum — dans une école, la question n'est jamais « peut-il modifier le
 * champ durée » mais « est-ce qu'on lui confie les écrans ».
 */

export const ROLES = ["administrateur", "editeur", "lecteur"] as const;
export type Role = (typeof ROLES)[number];

/** Ce qu'une action exige. */
export type Pouvoir =
  /** Voir le parc, les publications, l'emploi du temps. */
  | "consulter"
  /** Publier, importer des médias, tenir l'emploi du temps, agir sur un écran. */
  | "publier"
  /** Créer et retirer des comptes. */
  | "administrer";

const POUVOIRS: Record<Role, readonly Pouvoir[]> = {
  administrateur: ["consulter", "publier", "administrer"],
  editeur: ["consulter", "publier"],
  lecteur: ["consulter"],
};

export function peut(role: Role, pouvoir: Pouvoir): boolean {
  return POUVOIRS[role].includes(pouvoir);
}

/** Le libellé montré dans la console. */
export function libelléDuRole(role: Role): string {
  switch (role) {
    case "administrateur":
      return "Administrateur";
    case "editeur":
      return "Éditeur";
    case "lecteur":
      return "Lecteur";
  }
}

export function descriptionDuRole(role: Role): string {
  switch (role) {
    case "administrateur":
      return "Publie, et gère les comptes.";
    case "editeur":
      return "Publie sur les écrans, tient l'emploi du temps, déclenche une urgence.";
    case "lecteur":
      return "Consulte sans rien modifier.";
  }
}
