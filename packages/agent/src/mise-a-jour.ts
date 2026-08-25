import { createHash } from "node:crypto";
import {
  type VersionDuLecteur,
  delaiDeBascule,
  doitRevenirEnArriere,
  doitSeMettreAJour,
} from "@couloir/protocol";
import type { NetPort, UpdatePort } from "./ports.js";

/**
 * La mise à jour du lecteur lui-même.
 *
 * Sans elle, mettre à jour douze écrans veut dire se brancher sur douze
 * Raspberry : le lecteur est posé une seule fois, à l'installation, et
 * `restart-app` relance le même fichier.
 *
 * Tout est écrit pour qu'un échec ne laisse pas un couloir noir. On vérifie
 * l'empreinte AVANT d'écrire, on garde la version précédente, on étale les
 * bascules, et un boîtier qui ne reprend pas contact revient tout seul en
 * arrière. C'est la même prudence que pour les médias, appliquée au code qui
 * les affiche.
 */

export interface JournalDeMiseAJour {
  (niveau: "info" | "warn" | "error", message: string, details?: Record<string, unknown>): void;
}

export interface OptionsDeMiseAJour {
  deviceId: string;
  /** Sur quelle durée les boîtiers se répartissent. 0 = tout de suite. */
  fenetreDeBasculeMs?: number;
  /** Injecté pour les tests : l'attente réelle se compte en minutes. */
  attendre?: (ms: number) => Promise<void>;
  log?: JournalDeMiseAJour;
}

export type ResultatDeMiseAJour =
  /** Rien à faire : pas de porte, pas de version annoncée, ou déjà à jour. */
  | { fait: "rien"; pourquoi: string }
  /** Installée. Il reste à relancer, ce que l'appelant décide. */
  | { fait: "installee"; version: string }
  /** Le serveur annonçait quelque chose qu'on n'a pas pu poser. */
  | { fait: "echec"; pourquoi: string };

const empreinte = (contenu: Uint8Array): string =>
  createHash("sha256").update(contenu).digest("hex");

/**
 * Va chercher la version servie et la pose si elle diffère.
 *
 * Ne relance rien : la relance est une décision qui appartient à l'agent, qui
 * sait s'il est en train de jouer une urgence.
 */
export async function mettreAJourLeLecteur(
  net: NetPort,
  update: UpdatePort | undefined,
  options: OptionsDeMiseAJour,
): Promise<ResultatDeMiseAJour> {
  const log = options.log ?? (() => {});
  if (!update) return { fait: "rien", pourquoi: "plateforme sans mise à jour" };

  let servie: VersionDuLecteur | null;
  try {
    servie = await net.fetchVersionDuLecteur();
  } catch (cause) {
    // Un serveur injoignable n'est pas une mise à jour ratée : l'écran
    // continue d'afficher, et on réessaiera au prochain tour.
    return { fait: "rien", pourquoi: `version illisible : ${String(cause)}` };
  }
  if (!servie) return { fait: "rien", pourquoi: "le serveur n'annonce pas de version" };

  const installee = await update.versionInstallee();
  if (!doitSeMettreAJour(installee ?? "", servie.version)) {
    return { fait: "rien", pourquoi: "déjà à jour" };
  }

  /*
   * On s'étale avant de télécharger, pas après.
   *
   * Douze boîtiers qui basculent à la même minute, c'est douze couloirs noirs
   * si la version est mauvaise. Attendre après le téléchargement les ferait
   * tous basculer ensemble malgré tout.
   */
  const delai = delaiDeBascule(options.deviceId, options.fenetreDeBasculeMs ?? 0);
  if (delai > 0) {
    log("info", "mise à jour du lecteur, après attente", { version: servie.version, delai });
    await (options.attendre ?? attenteReelle)(delai);
  }

  const fichiers: { nom: string; contenu: Uint8Array }[] = [];
  for (const attendu of servie.fichiers) {
    let contenu: Uint8Array;
    try {
      contenu = await net.fetchFichierDuLecteur(attendu.nom);
    } catch (cause) {
      return { fait: "echec", pourquoi: `${attendu.nom} : ${String(cause)}` };
    }
    /*
     * L'empreinte décide, pas la taille ni le code HTTP.
     *
     * Un portail captif qui répond 200 avec une page de connexion a la bonne
     * apparence et le mauvais contenu. Sans ce contrôle, on écraserait le
     * lecteur avec du HTML.
     */
    const obtenue = empreinte(contenu);
    if (obtenue !== attendu.sha256) {
      log("error", "empreinte du lecteur incorrecte, mise à jour abandonnée", {
        fichier: attendu.nom,
        attendu: attendu.sha256,
        obtenu: obtenue,
      });
      return { fait: "echec", pourquoi: `empreinte incorrecte pour ${attendu.nom}` };
    }
    fichiers.push({ nom: attendu.nom, contenu });
  }

  try {
    await update.installer(servie.version, fichiers);
  } catch (cause) {
    return { fait: "echec", pourquoi: `installation : ${String(cause)}` };
  }
  log("info", "lecteur mis à jour", { de: installee, vers: servie.version });
  return { fait: "installee", version: servie.version };
}

/**
 * Au démarrage : ce boîtier tient-il debout sur sa version ?
 *
 * Appelé avant tout le reste. Un lecteur qui ne reprend pas contact après
 * deux démarrages revient à la version d'avant — sinon une mauvaise version
 * poussée sur le parc éteindrait tous les couloirs jusqu'à ce que quelqu'un
 * monte à l'échelle, ce que cette mise à jour existe précisément pour éviter.
 */
export async function verifierLeDemarrage(
  update: UpdatePort | undefined,
  log?: JournalDeMiseAJour,
): Promise<{ revenu: boolean }> {
  if (!update) return { revenu: false };
  const rates = await update.demarragesRates();
  if (!doitRevenirEnArriere(rates, true)) return { revenu: false };

  const revenu = await update.revenirEnArriere();
  if (revenu) {
    log?.("warn", "retour à la version précédente du lecteur", { demarragesRates: rates });
  }
  return { revenu };
}

const attenteReelle = (ms: number): Promise<void> =>
  new Promise((resoudre) => setTimeout(resoudre, ms));
