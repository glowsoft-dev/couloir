import { z } from "zod";

/**
 * La version du lecteur que le serveur met à disposition.
 *
 * Sans elle, mettre à jour douze écrans veut dire se brancher sur douze
 * Raspberry : le lecteur est téléchargé une seule fois, à l'installation, et
 * `restart-app` relance le même fichier.
 *
 * Servi en clair, comme les fichiers qu'il décrit : l'installateur le lit
 * avant que le boîtier n'ait la moindre identité, et il n'y a rien de secret
 * dans un numéro de version.
 */
export const FichierDeLecteur = z.object({
  nom: z.string(),
  /** Empreinte du contenu. C'est elle qui autorise la bascule, pas la taille. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  octets: z.number().int().nonnegative(),
});
export type FichierDeLecteur = z.infer<typeof FichierDeLecteur>;

export const VersionDuLecteur = z.object({
  /** La version que le serveur sert. Comparée telle quelle, sans ordre. */
  version: z.string().min(1),
  fichiers: z.array(FichierDeLecteur).min(1),
});
export type VersionDuLecteur = z.infer<typeof VersionDuLecteur>;

/**
 * Faut-il aller chercher cette version ?
 *
 * On compare par égalité et non par ordre : revenir en arrière est une
 * opération légitime — on republie la version d'avant quand la nouvelle
 * s'avère mauvaise — et une comparaison « strictement supérieur » refuserait
 * précisément le retour qu'on cherche à faire.
 */
export function doitSeMettreAJour(locale: string, distante: string | null): boolean {
  if (!distante) return false;
  return locale !== distante;
}

/**
 * Le délai avant qu'un écran donné n'applique la mise à jour.
 *
 * Douze écrans qui basculent à la même minute, c'est douze couloirs noirs si
 * la version est mauvaise. On étale sur une fenêtre, de façon déterministe :
 * un même boîtier tire toujours le même rang, si bien qu'il ne repasse pas
 * devant les autres à chaque tentative.
 *
 * Déterministe et non aléatoire aussi pour que ce soit testable : un délai
 * tiré au sort ne se vérifie pas.
 */
export function delaiDeBascule(deviceId: string, fenetreMs: number): number {
  if (fenetreMs <= 0) return 0;
  let empreinte = 0;
  for (const caractere of deviceId) {
    empreinte = (empreinte * 31 + caractere.charCodeAt(0)) >>> 0;
  }
  return empreinte % fenetreMs;
}

/**
 * Combien de démarrages ratés avant de revenir à la version précédente.
 *
 * Deux, et non un : un premier démarrage peut échouer pour une raison qui n'a
 * rien à voir avec la version — une coupure de courant pendant l'écriture, un
 * réseau absent au mauvais moment. Revenir en arrière dès le premier raté
 * ferait rejeter des versions saines.
 */
export const DEMARRAGES_RATES_AVANT_RETOUR = 2;

/** Le boîtier doit-il revenir à la version précédente ? */
export function doitRevenirEnArriere(demarragesRates: number, aUnePrecedente: boolean): boolean {
  return aUnePrecedente && demarragesRates >= DEMARRAGES_RATES_AVANT_RETOUR;
}
