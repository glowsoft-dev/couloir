import { z } from "zod";
import { ErreurConnecteur } from "./actualites.js";
import { recupererJson } from "./chaine-tls.js";

/**
 * L'emploi du temps depuis NetYPareo.
 *
 * NetYPareo — le logiciel de gestion des CFA et campus consulaires — expose
 * une fonction « afficheur planning » faite exactement pour ça : des écrans
 * de couloir. Chaque afficheur est configuré dans NetYPareo (l'établissement
 * entier, ou un bâtiment) et rend les séances du jour en JSON, sans
 * authentification.
 *
 * On s'y branche plutôt que sur l'export iCalendar, pourtant documenté :
 * l'iCal de NetYPareo est **personnel**, il porte le planning d'un individu
 * et son lien vaut mot de passe. L'afficheur, lui, est déjà pensé pour être
 * public et collectif. Utiliser la porte prévue plutôt que d'en forcer une
 * autre évite d'avoir à protéger un secret qu'on n'aurait pas dû détenir.
 *
 * Le serveur interroge, jamais les écrans : même raison que pour les
 * actualités — un réseau d'établissement qui ne sort pas, et un service
 * scolaire qu'on ne veut pas voir interrogé par vingt boîtiers.
 */

/** Une séance, telle que NetYPareo la rend. */
const Seance = z.object({
  code: z.union([z.number(), z.string()]),
  /** Le groupe : « BTS Gestion 2e année ». */
  title: z.string(),
  /** Le module : « Architectures de données décisionnelles ». */
  category: z.string().optional().default(""),
  commentaire: z.string().optional().default(""),
  horaires: z.object({
    debut: z.string(),
    fin: z.string(),
    minuteDebut: z.number(),
    minuteFin: z.number(),
  }),
  /** Salle puis enseignant, dans cet ordre. */
  lines: z.array(z.string()).default([]),
});

const ReponseAfficheur = z.object({
  /** JJ/MM/AAAA. */
  date: z.string(),
  title: z.string(),
  elements: z.array(Seance).default([]),
});

export interface SeanceNormalisee {
  time: string;
  endTime: string;
  subject: string;
  detail?: string;
  room: string;
  teacher?: string;
  note?: string;
}

export interface JourneeAfficheur {
  /** L'identifiant de l'afficheur dans NetYPareo. */
  afficheur: string;
  titre: string;
  /** AAAA-MM-JJ. */
  date: string;
  seances: SeanceNormalisee[];
  /**
   * Vrai si le serveur NetYPareo servait une chaîne de certificats
   * incomplète et qu'on l'a complétée nous-mêmes. La console le signale :
   * ça marche, mais la vraie correction est du côté du serveur.
   */
  chaineCompletee: boolean;
}

/** « 08h30 » → « 08:30 ». NetYPareo écrit l'heure à la française. */
export function versHeure(brut: string, minutes?: number): string {
  const m = /^(\d{1,2})\s*h\s*(\d{0,2})$/i.exec(brut.trim());
  if (m) {
    return `${m[1]!.padStart(2, "0")}:${(m[2] || "00").padStart(2, "0")}`;
  }
  // Repli sur les minutes depuis minuit, que NetYPareo fournit aussi : deux
  // représentations de la même chose, et l'une rattrape l'autre.
  if (typeof minutes === "number" && minutes >= 0 && minutes < 24 * 60) {
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  return brut.trim();
}

/** « 24/08/2026 » → « 2026-08-24 ». */
export function versDateIso(brut: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(brut.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Décode les entités HTML que NetYPareo laisse passer.
 *
 * Ses libellés viennent d'un champ de saisie web, et arrivent avec le HTML
 * dedans : « &nbsp; · Réunion Equipe Campus » s'affichait tel quel sur la
 * dalle, entité comprise. Personne dans un couloir ne sait lire ça.
 *
 * On décode à l'entrée plutôt qu'à l'affichage : la donnée doit être propre
 * partout où elle passe — l'aperçu de la console, les preuves de diffusion,
 * et pas seulement l'écran.
 */
const ENTITES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  ugrave: "ù",
  ocirc: "ô",
  icirc: "î",
  ecirc: "ê",
  acirc: "â",
  euml: "ë",
  iuml: "ï",
  rsquo: "'",
  hellip: "…",
  laquo: "«",
  raquo: "»",
};

export function decoderEntites(brut: string): string {
  return brut
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (entier, nom: string) => ENTITES[nom.toLowerCase()] ?? entier)
    // L'espace insécable décodé reste un espace insécable : on le ramène à un
    // espace ordinaire, sinon la coupure de ligne s'en trouve empêchée au
    // milieu d'un intitulé long.
    .replace(/\u00a0/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Sépare salle et enseignant.
 *
 * NetYPareo rend deux lignes libres. On reconnaît la salle plutôt que de se
 * fier à l'ordre : « A distance » y figure aussi, et une séance sans
 * enseignant renseigné ne doit pas faire passer la salle pour un nom.
 */
export function separerLignes(lines: readonly string[]): { room: string; teacher?: string } {
  const estEnseignant = (l: string) => /^(m\.|mme|mlle|mr\b)/i.test(l.trim());
  const salles = lines.filter((l) => !estEnseignant(l));
  const enseignants = lines.filter((l) => estEnseignant(l));
  return {
    room: salles.join(", ").trim() || "—",
    ...(enseignants.length > 0 ? { teacher: enseignants.join(", ") } : {}),
  };
}

/**
 * Ce qui s'écrit sous l'intitulé du groupe.
 *
 * Le module d'abord, puis le commentaire de la séance s'il est court. Un
 * commentaire long — « Prépa Powerpoint pour l'oral du Bloc 3 : présentation
 * orale des livrables du Bloc 3 » — ne se lit pas en marchant, et le premier
 * jet le versait dans la pastille réservée aux mentions « salle changée » :
 * un paragraphe entier s'y déployait et poussait le reste de la journée hors
 * de l'écran.
 *
 * On garde donc ce qui tient sur une ligne, et on laisse tomber le reste.
 * L'information complète est dans NetYPareo, pas sur un mur de couloir.
 */
export function precision(module: string, commentaire: string): string | undefined {
  const propre = (t: string) => t.trim().replace(/\s+/g, " ");
  const m = propre(module);
  const c = propre(commentaire);

  if (!m && !c) return undefined;
  if (!c || c.toLowerCase() === m.toLowerCase()) return m || undefined;
  if (!m) return c.length <= LIMITE_PRECISION ? c : undefined;

  const ensemble = `${m} · ${c}`;
  return ensemble.length <= LIMITE_PRECISION ? ensemble : m;
}

/** Deux lignes dans la colonne des cours, pas davantage. */
const LIMITE_PRECISION = 72;

/**
 * Va chercher un afficheur.
 *
 * `base` est l'adresse de l'instance — « https://netypareo.exemple.com » —
 * et `afficheur` l'identifiant visible dans l'URL de la page de choix.
 */
export async function chercherAfficheur(
  base: string,
  afficheur: string,
  options: { timeoutMs?: number } = {},
): Promise<JourneeAfficheur> {
  let url: URL;
  try {
    url = new URL(
      `netypareo/index.php/planning/afficheur/seances/${encodeURIComponent(afficheur)}`,
      base.endsWith("/") ? base : `${base}/`,
    );
  } catch {
    throw new ErreurConnecteur(
      "Cette adresse n'est pas valide.",
      "Indiquez l'adresse de votre NetYPareo, par exemple https://netypareo.votre-campus.com.",
    );
  }

  let reponse: Awaited<ReturnType<typeof recupererJson>>;
  try {
    reponse = await recupererJson(url, options.timeoutMs ?? 10_000);
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") {
      throw new ErreurConnecteur(
        "NetYPareo n'a pas répondu à temps.",
        "Vérifiez que le serveur Couloir peut le joindre, et pas seulement votre poste.",
      );
    }
    throw new ErreurConnecteur(
      `Impossible de joindre NetYPareo : ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (reponse.statut < 200 || reponse.statut >= 300) {
    throw new ErreurConnecteur(
      `NetYPareo a répondu ${reponse.statut}.`,
      "Vérifiez le numéro de l'afficheur : il apparaît à la fin de l'adresse, sur la page qui les liste.",
    );
  }

  const analyse = ReponseAfficheur.safeParse(reponse.corps);
  if (!analyse.success) {
    throw new ErreurConnecteur(
      "La réponse de NetYPareo n'a pas la forme attendue.",
      "L'adresse pointe-t-elle bien sur un afficheur planning ?",
    );
  }

  const date = versDateIso(analyse.data.date);
  if (!date) {
    throw new ErreurConnecteur("NetYPareo a renvoyé une date que je ne sais pas lire.");
  }

  const seances = analyse.data.elements
    .map((e) => {
      // Décodé à l'entrée, une fois pour toutes : la donnée doit être propre
      // partout où elle passe, pas seulement sur la dalle.
      const { room, teacher } = separerLignes(e.lines.map(decoderEntites));
      const detail = precision(e.category, e.commentaire ? decoderEntites(e.commentaire) : e.commentaire);
      return {
        time: versHeure(e.horaires.debut, e.horaires.minuteDebut),
        endTime: versHeure(e.horaires.fin, e.horaires.minuteFin),
        subject: decoderEntites(e.title),
        ...(detail ? { detail } : {}),
        room,
        ...(teacher ? { teacher } : {}),
        _tri: e.horaires.minuteDebut,
      };
    })
    // NetYPareo ne garantit pas l'ordre : un couloir se lit de haut en bas,
    // dans l'ordre de la journée.
    .sort((a, b) => a._tri - b._tri)
    .map(({ _tri, ...seance }) => seance);

  return {
    afficheur,
    titre: analyse.data.title.trim(),
    date,
    seances,
    chaineCompletee: reponse.chaineCompletee,
  };
}
