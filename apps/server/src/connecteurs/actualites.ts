import { z } from "zod";

/**
 * Les actualités du site de l'école.
 *
 * C'est la promesse d'origine : ce que la personne chargée de la
 * communication publie sur le site apparaît dans les couloirs, sans qu'elle
 * ait à toucher aux écrans.
 *
 * **C'est le serveur qui va chercher, pas les écrans.** Trois raisons, et
 * chacune suffirait : les écrans sont souvent sur un réseau restreint qui ne
 * sort pas ; vingt écrans interrogeant le site toutes les dix minutes le
 * feraient tomber tôt ou tard ; et normaliser une seule fois évite d'écrire
 * la connaissance de WordPress dans le noyau de rendu, qui doit rester
 * ignorant de l'endroit d'où vient une donnée.
 *
 * Deux protocoles, essayés dans cet ordre :
 *
 *   1. l'API REST de WordPress — la plus riche : images, catégories, extraits
 *      déjà rédigés ;
 *   2. le flux RSS ou Atom — moins riche, mais à peu près universel. Presque
 *      tout ce qui publie des articles en émet un, y compris les sites qui
 *      ont désactivé l'API REST.
 */

export const Article = z.object({
  id: z.string(),
  titre: z.string(),
  extrait: z.string().optional(),
  categorie: z.string().optional(),
  /** Adresse absolue d'une image d'illustration, si le site en fournit une. */
  image: z.string().url().optional(),
  publieLe: z.string().optional(),
});
export type Article = z.infer<typeof Article>;

export const ChargeActualites = z.object({
  articles: z.array(Article),
  /** D'où ça vient, pour que la console puisse le dire sans deviner. */
  source: z.enum(["wordpress", "rss", "aucune"]),
  recupereLe: z.string(),
});
export type ChargeActualites = z.infer<typeof ChargeActualites>;

export class ErreurConnecteur extends Error {
  constructor(
    message: string,
    /** Ce qu'on suggère de faire. Affiché tel quel dans la console. */
    readonly conseil?: string,
  ) {
    super(message);
    this.name = "ErreurConnecteur";
  }
}

/**
 * Décode les entités HTML et retire les balises.
 *
 * WordPress renvoie du HTML dans les titres et les extraits. Un écran de
 * couloir n'affiche que du texte : laisser passer les balises donnerait
 * « &#8217; » et « <p> » en grand au-dessus d'un escalier.
 */
export function enTexte(html: string): string {
  const entités: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#039;": "'",
    "&#39;": "'",
    "&#8217;": "’",
    "&#8216;": "‘",
    "&#8220;": "“",
    "&#8221;": "”",
    "&#8230;": "…",
    "&nbsp;": " ",
    "&hellip;": "…",
    "&eacute;": "é",
    "&egrave;": "è",
    "&agrave;": "à",
    "&ccedil;": "ç",
  };

  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z#0-9]+;/gi, (entité) => entités[entité.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Coupe un extrait sans couper un mot en deux.
 *
 * On lit un écran de couloir en marchant : au-delà de deux ou trois lignes,
 * personne ne finit la phrase. Mieux vaut une phrase entière et courte qu'un
 * paragraphe tronqué au milieu d'un mot.
 */
export function raccourcir(texte: string, maximum = 180): string {
  if (texte.length <= maximum) return texte;
  const coupe = texte.slice(0, maximum);
  const dernierEspace = coupe.lastIndexOf(" ");
  return `${coupe.slice(0, dernierEspace > 60 ? dernierEspace : maximum).trimEnd()}…`;
}

interface ArticleWordPress {
  id?: number;
  date?: string;
  link?: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  _embedded?: {
    "wp:featuredmedia"?: { source_url?: string; media_details?: { sizes?: Record<string, { source_url?: string }> } }[];
    "wp:term"?: { name?: string; taxonomy?: string }[][];
  };
}

/** L'image la plus adaptée : assez grande pour une dalle, pas l'originale de 6 Mo. */
function imageDe(article: ArticleWordPress): string | undefined {
  const média = article._embedded?.["wp:featuredmedia"]?.[0];
  if (!média) return undefined;
  const tailles = média.media_details?.sizes;
  return (
    tailles?.["large"]?.source_url ??
    tailles?.["medium_large"]?.source_url ??
    média.source_url ??
    undefined
  );
}

function catégorieDe(article: ArticleWordPress): string | undefined {
  const termes = article._embedded?.["wp:term"]?.flat() ?? [];
  const catégorie = termes.find((t) => t?.taxonomy === "category" && t.name);
  // « Non classé » est le défaut de WordPress : l'afficher n'apprend rien.
  if (!catégorie?.name || /^non class/i.test(catégorie.name)) return undefined;
  return enTexte(catégorie.name);
}

async function récupérer(url: string, signal: AbortSignal): Promise<Response> {
  const réponse = await fetch(url, {
    signal,
    headers: { "user-agent": "Couloir/1.0 (affichage scolaire)", accept: "*/*" },
    redirect: "follow",
  });
  return réponse;
}

/** Essaie l'API REST de WordPress. Renvoie `null` si le site n'en expose pas. */
async function viaWordPress(
  base: string,
  nombre: number,
  categorie: string | undefined,
  signal: AbortSignal,
): Promise<Article[] | null> {
  const url = new URL("wp-json/wp/v2/posts", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("per_page", String(Math.min(nombre, 20)));
  url.searchParams.set("_embed", "1");
  url.searchParams.set("status", "publish");
  if (categorie) url.searchParams.set("categories", categorie);

  const réponse = await récupérer(url.toString(), signal);
  if (!réponse.ok) return null;
  if (!réponse.headers.get("content-type")?.includes("json")) return null;

  const corps: unknown = await réponse.json();
  if (!Array.isArray(corps)) return null;

  return (corps as ArticleWordPress[])
    .map((article) => {
      const titre = enTexte(article.title?.rendered ?? "");
      if (!titre) return null;
      const extrait = raccourcir(enTexte(article.excerpt?.rendered ?? ""));
      const image = imageDe(article);
      const catégorie = catégorieDe(article);
      return {
        id: String(article.id ?? article.link ?? titre),
        titre,
        ...(extrait ? { extrait } : {}),
        ...(catégorie ? { categorie: catégorie } : {}),
        ...(image ? { image } : {}),
        ...(article.date ? { publieLe: article.date } : {}),
      } satisfies Article;
    })
    .filter((a): a is Article => a !== null);
}

/**
 * Lit un flux RSS ou Atom.
 *
 * Analyse volontairement minimale, sans dépendance : on n'extrait que quatre
 * champs de balises dont la forme est stable depuis vingt ans. Un vrai
 * analyseur XML serait plus rigoureux, mais il faudrait l'embarquer dans le
 * serveur pour lire trois titres.
 */
export function lireFlux(xml: string, nombre: number): Article[] {
  const entrées = xml.split(/<(?:item|entry)[\s>]/i).slice(1);

  return entrées
    .slice(0, nombre)
    .map((bloc, index) => {
      const champ = (nom: string): string | undefined => {
        const balise = new RegExp(`<${nom}[^>]*>([\\s\\S]*?)</${nom}>`, "i").exec(bloc);
        if (!balise?.[1]) return undefined;
        // Le contenu est souvent enveloppé dans CDATA.
        const brut = balise[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
        const texte = enTexte(brut);
        return texte || undefined;
      };

      const titre = champ("title");
      if (!titre) return null;

      // Atom met l'adresse dans un attribut plutôt que dans le contenu.
      const lien = champ("link") ?? /<link[^>]*href="([^"]+)"/i.exec(bloc)?.[1];
      const extrait = champ("description") ?? champ("summary") ?? champ("content");
      const image = /<enclosure[^>]+url="([^"]+)"[^>]*type="image/i.exec(bloc)?.[1]
        ?? /<media:content[^>]+url="([^"]+)"/i.exec(bloc)?.[1];
      const date = champ("pubDate") ?? champ("published") ?? champ("updated");
      const catégorie = champ("category");

      return {
        id: lien ?? `flux-${index}`,
        titre,
        ...(extrait ? { extrait: raccourcir(extrait) } : {}),
        ...(catégorie && !/^non class/i.test(catégorie) ? { categorie: catégorie } : {}),
        ...(image ? { image } : {}),
        ...(date ? { publieLe: date } : {}),
      } satisfies Article;
    })
    .filter((a): a is Article => a !== null);
}

/** Les adresses de flux à essayer quand l'API REST n'a rien donné. */
function candidatsDeFlux(base: string): string[] {
  const racine = base.endsWith("/") ? base : `${base}/`;
  return [base, `${racine}feed/`, `${racine}rss`, `${racine}?feed=rss2`, `${racine}atom.xml`].filter(
    (url, i, tout) => tout.indexOf(url) === i,
  );
}

export interface ReglagesActualites {
  /** L'adresse du site, ou directement celle d'un flux. */
  url: string;
  /** Identifiant de catégorie WordPress, pour ne remonter qu'une rubrique. */
  categorie?: string;
  nombre: number;
}

/**
 * Va chercher les actualités.
 *
 * Ne renvoie jamais une liste vide en silence : un site qui ne publie rien et
 * un site injoignable demandent deux réactions différentes, et l'écran doit
 * pouvoir dire laquelle.
 */
export async function chercherActualites(
  reglages: ReglagesActualites,
  options: { timeoutMs?: number } = {},
): Promise<ChargeActualites> {
  let base: URL;
  try {
    base = new URL(reglages.url);
  } catch {
    throw new ErreurConnecteur(
      "Cette adresse n'est pas valide.",
      "Copiez l'adresse du site depuis la barre du navigateur, en gardant https:// au début.",
    );
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new ErreurConnecteur("Seules les adresses http et https sont acceptées.");
  }

  const contrôle = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const recupereLe = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  try {
    const parWordPress = await viaWordPress(
      reglages.url,
      reglages.nombre,
      reglages.categorie,
      contrôle,
    );
    if (parWordPress && parWordPress.length > 0) {
      return { articles: parWordPress, source: "wordpress", recupereLe };
    }

    for (const candidat of candidatsDeFlux(reglages.url)) {
      const réponse = await récupérer(candidat, contrôle).catch(() => null);
      if (!réponse?.ok) continue;
      const texte = await réponse.text();
      if (!/<(rss|feed|rdf:RDF)/i.test(texte)) continue;
      const articles = lireFlux(texte, reglages.nombre);
      if (articles.length > 0) return { articles, source: "rss", recupereLe };
    }
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") {
      throw new ErreurConnecteur(
        "Le site n'a pas répondu à temps.",
        "Vérifiez qu'il est accessible depuis le serveur, et non seulement depuis votre poste.",
      );
    }
    throw new ErreurConnecteur(
      `Impossible de joindre le site : ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  throw new ErreurConnecteur(
    "Aucun article trouvé à cette adresse.",
    "Vérifiez que le site publie bien des articles. Si c'est un WordPress dont l'API est désactivée, indiquez directement l'adresse du flux RSS.",
  );
}
