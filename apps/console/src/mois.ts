import type { Visibility } from "./api.js";

/**
 * Ce qui paraît un jour donné.
 *
 * La vue jour répond à « à quelle heure » ; celle-ci répond à « quels jours ».
 * Elle ignore donc délibérément les heures : une affiche programmée de 19:00 à
 * 07:30 paraît bel et bien ce jour-là, et la faire disparaître du calendrier
 * parce qu'on regarde à midi serait un mensonge.
 *
 * On ne réutilise pas `isVisible` du noyau de rendu pour cette raison : il
 * répond à « maintenant, précisément », ce qui n'est pas la question ici.
 */
export function paraitLeJour(visibility: Visibility | undefined, date: string): boolean {
  if (!visibility) return true;

  const jour = new Date(`${date}T12:00:00`);

  if (visibility.startsAt && jour.getTime() < Date.parse(visibility.startsAt)) return false;
  // `endsAt` porte minuit du lendemain : « jusqu'au 15 » inclut le 15 entier,
  // et midi le 15 tombe donc bien avant la borne.
  if (visibility.endsAt && jour.getTime() >= Date.parse(visibility.endsAt)) return false;

  if (visibility.daysOfWeek?.length) {
    const numéro = jour.getDay() || 7;
    if (!visibility.daysOfWeek.includes(numéro)) return false;
  }

  return true;
}

/** AAAA-MM-JJ, en heure locale — `toISOString` décalerait d'un fuseau. */
export function enDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface CaseDuMois {
  date: string;
  /** Faux pour les jours des mois voisins qui complètent les semaines. */
  duMois: boolean;
}

/**
 * Les six semaines d'un mois, du lundi au dimanche.
 *
 * Toujours six, et non cinq ou six selon le mois : une grille qui change de
 * hauteur en changeant de mois fait sauter tout ce qui est en dessous, et on
 * perd le fil en feuilletant.
 */
export function grilleDuMois(annee: number, mois: number): CaseDuMois[] {
  const premier = new Date(annee, mois, 1);
  // getDay() rend 0 pour dimanche ; on veut lundi en tête.
  const décalage = (premier.getDay() || 7) - 1;
  const début = new Date(annee, mois, 1 - décalage);

  return Array.from({ length: 42 }, (_, i) => {
    const jour = new Date(début.getFullYear(), début.getMonth(), début.getDate() + i);
    return { date: enDate(jour), duMois: jour.getMonth() === mois };
  });
}

/** « septembre 2026 », capitale initiale comprise. */
export function nomDuMois(annee: number, mois: number): string {
  const nom = new Date(annee, mois, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  return nom.charAt(0).toUpperCase() + nom.slice(1);
}
