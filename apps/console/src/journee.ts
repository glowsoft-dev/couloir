/**
 * Ce que la journée d'un écran raconte.
 *
 * Deux calculs qui n'ont rien à faire dans le rendu : où poser des blocs qui
 * se chevauchent, et ce qui se passe une fois le dernier terminé. Le second
 * est une phrase qu'on lit et qu'on croit — elle doit être juste.
 */

export interface Plage {
  /** Minutes depuis minuit. */
  debut: number;
  fin: number;
}

export interface PlacementDeBloc {
  /** Colonne occupée, à partir de 0. */
  colonne: number;
  /** Combien de colonnes se partagent la largeur à cet endroit. */
  colonnes: number;
}

/**
 * Range les plages en colonnes pour qu'aucune n'en cache une autre.
 *
 * Deux affiches programmées sur des horaires qui se croisent se
 * superposaient : la seconde recouvrait la première, qu'on ne pouvait plus
 * ni lire ni attraper. Elles se partagent maintenant la largeur.
 *
 * La largeur se compte par grappe de plages qui se touchent, et non sur
 * toute la journée : deux affiches le matin et deux l'après-midi font deux
 * colonnes partout, pas quatre.
 */
export function disposerLesBlocs(plages: readonly Plage[]): PlacementDeBloc[] {
  const ordre = plages
    .map((plage, index) => ({ plage, index }))
    .sort((a, b) => a.plage.debut - b.plage.debut || a.plage.fin - b.plage.fin);

  const placements: PlacementDeBloc[] = plages.map(() => ({ colonne: 0, colonnes: 1 }));
  /** Fin de la dernière plage posée dans chaque colonne. */
  let finParColonne: number[] = [];
  /** Les indices de la grappe en cours, et la fin la plus tardive qu'elle atteint. */
  let grappe: number[] = [];
  let finDeGrappe = -Infinity;

  const cloreLaGrappe = () => {
    const largeur = Math.max(1, finParColonne.length);
    for (const index of grappe) placements[index]!.colonnes = largeur;
    finParColonne = [];
    grappe = [];
    finDeGrappe = -Infinity;
  };

  for (const { plage, index } of ordre) {
    // Une plage qui ne touche plus rien de la grappe en ouvre une nouvelle.
    if (plage.debut >= finDeGrappe) cloreLaGrappe();

    let colonne = finParColonne.findIndex((fin) => fin <= plage.debut);
    if (colonne === -1) {
      colonne = finParColonne.length;
      finParColonne.push(plage.fin);
    } else {
      finParColonne[colonne] = plage.fin;
    }

    placements[index] = { colonne, colonnes: 1 };
    grappe.push(index);
    finDeGrappe = Math.max(finDeGrappe, plage.fin);
  }
  cloreLaGrappe();

  return placements;
}

/** Ce que l'écran fait quand plus rien n'est programmé. */
export type Relais =
  | { quoi: "permanents" }
  | { quoi: "emploiDuTemps" }
  | { quoi: "media"; nom: string }
  | { quoi: "rien" };

export interface FenetreDExtinction {
  daysOfWeek: number[];
  from: string;
  to: string;
}

function enMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** « 18 h 30 », comme on le dit à voix haute, et « 19 h » sans les zéros. */
export function enFrancais(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/**
 * La phrase de fin de journée.
 *
 * Elle répond à la question qu'on se pose en regardant le bas de la
 * chronologie : et après ? Un trou n'est pas une erreur — c'est là que le
 * contenu par défaut prend la main — mais encore faut-il le dire, sinon on
 * remplit la soirée d'affiches pour rien.
 *
 * `null` quand rien n'est programmé : une autre phrase le dit déjà, et deux
 * messages qui disent la même chose se contredisent tôt ou tard.
 */
export function finDeJournee(options: {
  /** Fins des plages programmées, en minutes. */
  fins: readonly number[];
  relais: Relais;
  extinctions?: readonly FenetreDExtinction[];
}): string | null {
  if (options.fins.length === 0) return null;
  const dernier = Math.max(...options.fins);

  const suite = {
    permanents: "les contenus sans horaire continuent de tourner",
    emploiDuTemps: "l'écran affiche les salles du jour",
    media: "",
    rien: "l'écran n'a plus rien à montrer",
  };
  const quoi =
    options.relais.quoi === "media"
      ? `l'écran affiche ${options.relais.nom}`
      : suite[options.relais.quoi];

  /*
   * L'extinction retenue est la première qui tombe après le dernier contenu,
   * parmi les fenêtres qui valent un jour de semaine — la chronologie montre
   * une journée type, pas une date. Une extinction déjà passée à cette
   * heure-là ne dirait rien de ce qui suit.
   */
  const extinction = (options.extinctions ?? [])
    .filter((f) => f.daysOfWeek.length === 0 || f.daysOfWeek.some((j) => j >= 1 && j <= 5))
    .map((f) => enMinutes(f.from))
    .filter((debut) => debut > dernier)
    .sort((a, b) => a - b)[0];

  return `Après ${enFrancais(dernier)}, rien n'est programmé : ${quoi}${
    extinction === undefined ? "." : `, puis la dalle s'éteint à ${enFrancais(extinction)}.`
  }`;
}
