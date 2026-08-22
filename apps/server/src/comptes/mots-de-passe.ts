import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt) as (
  motDePasse: string | Buffer,
  sel: Buffer,
  longueur: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Le hachage des mots de passe.
 *
 * scrypt plutôt qu'une dépendance : il est dans Node, il est lent à dessein,
 * et il coûte de la mémoire — ce qui rend l'attaque par carte graphique bien
 * moins rentable qu'avec une fonction de hachage ordinaire.
 *
 * Les paramètres sont écrits dans l'empreinte elle-même. Ils vieillissent :
 * les stocker permet de durcir le coût dans cinq ans et de rehacher chaque
 * mot de passe au vol, à la connexion suivante, sans invalider les comptes
 * existants ni demander à personne d'en changer.
 */

/** ~64 Mo et une centaine de millisecondes sur une machine de bureau. */
const PARAMÈTRES = { N: 2 ** 16, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;
const LONGUEUR = 32;

export async function hacher(motDePasse: string): Promise<string> {
  const sel = randomBytes(16);
  const { N, r, p } = PARAMÈTRES;
  const empreinte = await derive(motDePasse.normalize("NFKC"), sel, LONGUEUR, PARAMÈTRES);
  return ["scrypt", N, r, p, sel.toString("base64"), empreinte.toString("base64")].join("$");
}

/**
 * Vérifie un mot de passe, et dit si l'empreinte mérite d'être refaite.
 *
 * Une empreinte produite avec des paramètres plus faibles reste valide — on
 * ne verrouille personne dehors — mais on la remplace à la volée.
 */
export async function vérifier(
  motDePasse: string,
  stockée: string,
): Promise<{ valide: boolean; àRefaire: boolean }> {
  const morceaux = stockée.split("$");
  if (morceaux.length !== 6 || morceaux[0] !== "scrypt") return { valide: false, àRefaire: false };

  const [, n, r, p, sel, empreinte] = morceaux;
  const attendue = Buffer.from(empreinte!, "base64");
  const calculée = await derive(motDePasse.normalize("NFKC"), Buffer.from(sel!, "base64"), attendue.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 512 * 1024 * 1024,
  });

  const valide = calculée.length === attendue.length && timingSafeEqual(calculée, attendue);
  return { valide, àRefaire: valide && Number(n) < PARAMÈTRES.N };
}

/**
 * Ce qu'on refuse comme mot de passe.
 *
 * Volontairement pauvre en règles : imposer une majuscule et un chiffre
 * produit « Motdepasse1 », pas de la sécurité. La longueur est ce qui compte,
 * et c'est la seule chose qu'on exige.
 */
export const LONGUEUR_MINIMALE = 12;

export function problèmeDeMotDePasse(motDePasse: string): string | null {
  if (motDePasse.length < LONGUEUR_MINIMALE) {
    return `Le mot de passe doit faire au moins ${LONGUEUR_MINIMALE} caractères. Une phrase courte fait très bien l'affaire.`;
  }
  if (motDePasse.trim().length === 0) return "Le mot de passe ne peut pas être vide.";
  return null;
}
