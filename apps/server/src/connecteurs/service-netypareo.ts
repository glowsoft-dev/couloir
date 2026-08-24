import type { Sql } from "postgres";
import { ErreurConnecteur } from "./actualites.js";
import { type JourneeAfficheur, chercherAfficheur } from "./netypareo.js";

/**
 * Le service NetYPareo : réglages, cache, et service aux écrans.
 *
 * Le cache joue le même rôle que pour les actualités, avec un enjeu plus
 * fort : un emploi du temps absent envoie les gens au mauvais endroit, et
 * NetYPareo sera en maintenance un matin comme n'importe quel service. On
 * garde donc la dernière journée connue — mais **datée**, pour que le rendu
 * puisse la retirer plutôt que de laisser croire qu'elle est d'aujourd'hui.
 */

export interface AfficheurConfigure {
  afficheur: string;
  /** Le bâtiment que cet afficheur dessert. Vide = par défaut. */
  batiment: string | null;
  libelle: string;
}

export interface ReglagesNetypareo {
  baseUrl: string;
  actif: boolean;
  afficheurs: AfficheurConfigure[];
}

/** Quinze minutes : un emploi du temps ne change pas toutes les minutes. */
const FRAICHEUR_MS = 15 * 60 * 1000;

export class ServiceNetypareo {
  private readonly cache = new Map<string, { journee: JourneeAfficheur; à: number }>();
  private readonly enCours = new Map<string, Promise<JourneeAfficheur>>();

  constructor(private readonly sql: Sql) {}

  async reglages(): Promise<ReglagesNetypareo> {
    const [base] = await this.sql<{ base_url: string; actif: boolean }[]>`
      SELECT base_url, actif FROM netypareo
    `;
    const afficheurs = await this.sql<
      { afficheur: string; batiment: string | null; libelle: string }[]
    >`SELECT afficheur, batiment, libelle FROM netypareo_afficheurs ORDER BY batiment NULLS FIRST, afficheur`;
    return {
      baseUrl: base?.base_url ?? "",
      actif: base?.actif ?? false,
      afficheurs,
    };
  }

  async enregistrer(reglages: {
    baseUrl: string;
    actif: boolean;
    afficheurs: { afficheur: string; batiment?: string | null; libelle?: string }[];
  }): Promise<ReglagesNetypareo> {
    await this.sql.begin(async (tx) => {
      await tx`
        INSERT INTO netypareo (unique_ligne, base_url, actif, modifie_le)
        VALUES (TRUE, ${reglages.baseUrl.trim()}, ${reglages.actif}, now())
        ON CONFLICT (unique_ligne) DO UPDATE SET
          base_url = EXCLUDED.base_url, actif = EXCLUDED.actif, modifie_le = now()
      `;
      // Remplacement franc : la liste envoyée par la console fait foi.
      await tx`DELETE FROM netypareo_afficheurs`;
      for (const a of reglages.afficheurs) {
        await tx`
          INSERT INTO netypareo_afficheurs (afficheur, batiment, libelle)
          VALUES (${a.afficheur.trim()}, ${a.batiment?.trim() || null}, ${a.libelle?.trim() ?? ""})
        `;
      }
    });
    this.cache.clear();
    return this.reglages();
  }

  /**
   * Quel afficheur pour un écran donné.
   *
   * Le bâtiment de l'écran d'abord, l'afficheur par défaut ensuite. Un écran
   * d'un bâtiment non apparié affiche donc l'établissement entier plutôt que
   * rien : mieux vaut trop d'information que pas d'emploi du temps.
   */
  async afficheurPour(batiment: string | null | undefined): Promise<string | null> {
    const { afficheurs, actif } = await this.reglages();
    if (!actif || afficheurs.length === 0) return null;
    const exact = batiment
      ? afficheurs.find((a) => a.batiment?.toUpperCase() === batiment.toUpperCase())
      : undefined;
    return (exact ?? afficheurs.find((a) => !a.batiment) ?? null)?.afficheur ?? null;
  }

  /** Ce que les écrans reçoivent, au format que le rendu connaît déjà. */
  async journee(afficheur: string): Promise<JourneeAfficheur> {
    const { baseUrl, actif } = await this.reglages();
    if (!actif || !baseUrl) throw new ErreurConnecteur("NetYPareo n'est pas configuré.");

    const enCache = this.cache.get(afficheur);
    if (enCache && Date.now() - enCache.à < FRAICHEUR_MS) return enCache.journee;

    // Plusieurs écrans du même bâtiment demandent en même temps : une seule
    // requête part vers NetYPareo.
    let promesse = this.enCours.get(afficheur);
    if (!promesse) {
      promesse = chercherAfficheur(baseUrl, afficheur)
        .then((journee) => {
          this.cache.set(afficheur, { journee, à: Date.now() });
          return journee;
        })
        .finally(() => this.enCours.delete(afficheur));
      this.enCours.set(afficheur, promesse);
    }

    try {
      return await promesse;
    } catch (cause) {
      // NetYPareo est tombé : on ressert la dernière journée connue. Elle
      // porte sa date, et le rendu retire la colonne si elle n'est plus celle
      // du jour — un cours faux envoie quelqu'un dans la mauvaise salle.
      if (enCache) return enCache.journee;
      throw cause;
    }
  }

  /** Essai à la demande, sans toucher au cache ni aux réglages. */
  async essayer(baseUrl: string, afficheur: string): Promise<JourneeAfficheur> {
    return chercherAfficheur(baseUrl, afficheur, { timeoutMs: 12_000 });
  }
}
