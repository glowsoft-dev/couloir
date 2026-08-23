import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import {
  type ChargeActualites,
  ErreurConnecteur,
  type ReglagesActualites,
  chercherActualites,
} from "./actualites.js";

/**
 * Le service d'actualités : réglages, cache, images, et service aux écrans.
 *
 * Le cache n'est pas une optimisation, c'est ce qui rend l'affaire fiable.
 * Le site de l'école tombera — maintenance, hébergeur, certificat expiré — et
 * ce jour-là les écrans doivent continuer d'afficher les dernières
 * actualités connues plutôt que d'afficher un vide inexplicable. La date de
 * récupération part avec la charge : c'est le rendu qui décide d'écrire
 * « Mis à jour lundi 8 h 12 » ou de retirer la zone.
 */

export interface ReglagesEnregistres extends ReglagesActualites {
  actif: boolean;
  modifieLe: string | null;
}

const PAR_DEFAUT: ReglagesEnregistres = {
  url: "",
  nombre: 5,
  actif: false,
  modifieLe: null,
};

/** Dix minutes : une actualité scolaire n'est pas une dépêche. */
const FRAICHEUR_MS = 10 * 60 * 1000;

/** Une image relayée : ce qu'on a téléchargé, et quand. */
interface ImageRelayee {
  origine: string;
  octets?: Buffer;
  type?: string;
  à?: number;
}

/** Deux mégaoctets. Au-delà, ce n'est pas une illustration d'article. */
const IMAGE_MAX_OCTETS = 2 * 1024 * 1024;
const IMAGE_FRAICHEUR_MS = 6 * 60 * 60 * 1000;

export class ServiceActualites {
  private cache: { charge: ChargeActualites; à: number } | null = null;
  private enCours: Promise<ChargeActualites> | null = null;

  /**
   * Les images des articles, relayées par le serveur.
   *
   * Sans ce relais, les écrans iraient chercher les illustrations
   * directement sur le site — c'est-à-dire sur Internet. Or c'est
   * précisément pour éviter ça que le serveur récupère les articles : dans
   * un établissement, les écrans sont souvent sur un réseau qui ne sort pas.
   * Leur donner des adresses externes reviendrait à rouvrir par la petite
   * porte ce qu'on avait fermé par la grande, et les couloirs afficheraient
   * du texte sans images sans que personne comprenne pourquoi.
   *
   * La table n'est pas un cache, c'est une liste blanche : on ne relaie que
   * les adresses vues dans la charge courante. Une route qui accepterait une
   * adresse arbitraire serait un relais ouvert, utilisable pour atteindre
   * depuis le serveur ce qu'on ne peut pas atteindre de l'extérieur.
   */
  private readonly images = new Map<string, ImageRelayee>();

  constructor(private readonly sql: Sql) {}

  /** Enregistre une image et renvoie la clé sous laquelle on la relaiera. */
  private clefDImage(origine: string): string {
    const clef = createHash("sha256").update(origine).digest("base64url").slice(0, 22);
    const connue = this.images.get(clef);
    // On garde les octets déjà téléchargés : la même image revient à chaque
    // rafraîchissement tant que l'article reste en une.
    this.images.set(clef, connue ?? { origine });
    return clef;
  }

  /**
   * Réécrit les adresses d'images vers le serveur.
   *
   * `baseUrl` est celle par laquelle les ÉCRANS joignent le serveur, pas
   * celle de la console.
   */
  private relayer(charge: ChargeActualites, baseUrl: string): ChargeActualites {
    return {
      ...charge,
      articles: charge.articles.map((article) =>
        article.image
          ? { ...article, image: `${baseUrl}/connectors/news/image/${this.clefDImage(article.image)}` }
          : article,
      ),
    };
  }

  /**
   * Sert une image relayée.
   *
   * `null` si la clé n'est pas dans la liste blanche, ou si le site ne rend
   * pas une image — le rendu retire alors l'illustration et garde le texte.
   */
  async image(clef: string): Promise<{ octets: Buffer; type: string } | null> {
    const entrée = this.images.get(clef);
    if (!entrée) return null;

    if (entrée.octets && entrée.à && Date.now() - entrée.à < IMAGE_FRAICHEUR_MS) {
      return { octets: entrée.octets, type: entrée.type ?? "image/jpeg" };
    }

    try {
      const réponse = await fetch(entrée.origine, {
        signal: AbortSignal.timeout(10_000),
        headers: { "user-agent": "Couloir/1.0 (affichage scolaire)" },
        redirect: "follow",
      });
      const type = réponse.headers.get("content-type") ?? "";
      if (!réponse.ok || !type.startsWith("image/")) return this.dernierRecours(entrée);

      const octets = Buffer.from(await réponse.arrayBuffer());
      if (octets.byteLength > IMAGE_MAX_OCTETS) return this.dernierRecours(entrée);

      this.images.set(clef, { origine: entrée.origine, octets, type, à: Date.now() });
      return { octets, type };
    } catch {
      return this.dernierRecours(entrée);
    }
  }

  /** Le site est tombé : on ressert la copie, même vieille. */
  private dernierRecours(entrée: ImageRelayee): { octets: Buffer; type: string } | null {
    return entrée.octets ? { octets: entrée.octets, type: entrée.type ?? "image/jpeg" } : null;
  }

  async reglages(): Promise<ReglagesEnregistres> {
    const lignes = await this.sql<
      { url: string; categorie: string | null; nombre: number; actif: boolean; modifie_le: Date }[]
    >`SELECT url, categorie, nombre, actif, modifie_le FROM reglages_actualites`;
    const ligne = lignes[0];
    if (!ligne) return PAR_DEFAUT;
    return {
      url: ligne.url,
      ...(ligne.categorie ? { categorie: ligne.categorie } : {}),
      nombre: ligne.nombre,
      actif: ligne.actif,
      modifieLe: ligne.modifie_le.toISOString(),
    };
  }

  async enregistrer(reglages: {
    url: string;
    categorie?: string;
    nombre: number;
    actif: boolean;
  }): Promise<ReglagesEnregistres> {
    await this.sql`
      INSERT INTO reglages_actualites (unique_ligne, url, categorie, nombre, actif, modifie_le)
      VALUES (TRUE, ${reglages.url.trim()}, ${reglages.categorie?.trim() || null}, ${reglages.nombre}, ${reglages.actif}, now())
      ON CONFLICT (unique_ligne) DO UPDATE SET
        url = EXCLUDED.url,
        categorie = EXCLUDED.categorie,
        nombre = EXCLUDED.nombre,
        actif = EXCLUDED.actif,
        modifie_le = now()
    `;
    // Changer l'adresse doit se voir tout de suite, pas dans dix minutes.
    this.cache = null;
    return this.reglages();
  }

  /**
   * Ce que les écrans reçoivent.
   *
   * Trois situations, et elles ne se confondent pas : le connecteur est
   * éteint, le site répond, le site est tombé mais on a du cache. Seule la
   * première rend une liste vide — les deux autres rendent quelque chose.
   */
  async charge(baseUrl: string): Promise<ChargeActualites> {
    const reglages = await this.reglages();
    if (!reglages.actif || !reglages.url) {
      return { articles: [], source: "aucune", recupereLe: maintenant() };
    }

    if (this.cache && Date.now() - this.cache.à < FRAICHEUR_MS) {
      return this.relayer(this.cache.charge, baseUrl);
    }

    // Vingt écrans peuvent demander en même temps : une seule requête part.
    this.enCours ??= this.rafraichir(reglages).finally(() => {
      this.enCours = null;
    });

    try {
      return this.relayer(await this.enCours, baseUrl);
    } catch (cause) {
      // Le site est tombé. On sert le dernier état connu, aussi vieux
      // soit-il : c'est le rendu qui décide d'afficher sa date ou de retirer
      // la zone, et il ne peut le faire que s'il reçoit quelque chose.
      if (this.cache) return this.relayer(this.cache.charge, baseUrl);
      throw cause;
    }
  }

  private async rafraichir(reglages: ReglagesEnregistres): Promise<ChargeActualites> {
    const charge = await chercherActualites(reglages);
    this.cache = { charge, à: Date.now() };
    return charge;
  }

  /** Essai à la demande, sans toucher au cache ni aux réglages enregistrés. */
  async essayer(reglages: ReglagesActualites): Promise<ChargeActualites> {
    return chercherActualites(reglages, { timeoutMs: 12_000 });
  }

  /** Ce que la console montre : d'où vient la charge servie en ce moment. */
  etat(): { enCache: boolean; recupereLe: string | null; articles: number } {
    return {
      enCache: this.cache !== null,
      recupereLe: this.cache?.charge.recupereLe ?? null,
      articles: this.cache?.charge.articles.length ?? 0,
    };
  }
}

function maintenant(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

export { ErreurConnecteur };
