import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { hacher, vérifier } from "./mots-de-passe.js";
import type { Role } from "./roles.js";

/**
 * Les comptes, les sessions et le journal.
 *
 * Tout ce qui touche à l'identité passe par ici : le reste du serveur ne
 * manipule jamais une empreinte ni un jeton de session en clair.
 */

export interface Utilisateur {
  id: string;
  courriel: string;
  nom: string;
  role: Role;
  actif: boolean;
  creeLe: string;
  derniereConnexion: string | null;
}

export interface EntreeJournal {
  id: string;
  au: string;
  auteur: string;
  action: string;
  cible: string | null;
  details: unknown;
}

/** Durée d'une session. Assez longue pour ne pas gêner, assez courte pour qu'un poste laissé ouvert dans une salle des profs finisse par se refermer. */
export const DUREE_SESSION_MS = 12 * 60 * 60 * 1000;

/** Le jeton voyage en clair vers le navigateur ; seule son empreinte est stockée. */
function empreinteDeJeton(jeton: string): string {
  return createHash("sha256").update(jeton).digest("base64url");
}

/** Une école écrira « Valerie@… » un jour et « valerie@… » le lendemain. */
export function normaliserCourriel(courriel: string): string {
  return courriel.trim().toLowerCase();
}

interface LigneUtilisateur {
  id: string;
  courriel: string;
  nom: string;
  role: Role;
  actif: boolean;
  cree_le: Date;
  derniere_connexion: Date | null;
}

function versUtilisateur(ligne: LigneUtilisateur): Utilisateur {
  return {
    id: ligne.id,
    courriel: ligne.courriel,
    nom: ligne.nom,
    role: ligne.role,
    actif: ligne.actif,
    creeLe: ligne.cree_le.toISOString(),
    derniereConnexion: ligne.derniere_connexion?.toISOString() ?? null,
  };
}

const CHAMPS = `id, courriel, nom, role, actif, cree_le, derniere_connexion`;

export class DepotComptes {
  constructor(private readonly sql: Sql) {}

  async compter(): Promise<number> {
    const [ligne] = await this.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM utilisateurs`;
    return ligne?.n ?? 0;
  }

  async lister(): Promise<Utilisateur[]> {
    const lignes = await this.sql<LigneUtilisateur[]>`
      SELECT ${this.sql.unsafe(CHAMPS)} FROM utilisateurs ORDER BY nom
    `;
    return lignes.map(versUtilisateur);
  }

  async parId(id: string): Promise<Utilisateur | null> {
    const lignes = await this.sql<LigneUtilisateur[]>`
      SELECT ${this.sql.unsafe(CHAMPS)} FROM utilisateurs WHERE id = ${id}
    `;
    return lignes[0] ? versUtilisateur(lignes[0]) : null;
  }

  async creer(entree: {
    courriel: string;
    nom: string;
    motDePasse: string;
    role: Role;
  }): Promise<Utilisateur> {
    const empreinte = await hacher(entree.motDePasse);
    const lignes = await this.sql<LigneUtilisateur[]>`
      INSERT INTO utilisateurs (id, courriel, nom, empreinte, role)
      VALUES (
        gen_random_uuid(),
        ${normaliserCourriel(entree.courriel)},
        ${entree.nom.trim()},
        ${empreinte},
        ${entree.role}
      )
      RETURNING ${this.sql.unsafe(CHAMPS)}
    `;
    return versUtilisateur(lignes[0]!);
  }

  async changerRole(id: string, role: Role): Promise<void> {
    await this.sql`UPDATE utilisateurs SET role = ${role} WHERE id = ${id}`;
  }

  /**
   * Désactiver plutôt que supprimer.
   *
   * Le journal continue de nommer qui a publié, même une fois la personne
   * partie — et un compte réactivé retrouve son historique.
   */
  async definirActif(id: string, actif: boolean): Promise<void> {
    await this.sql`UPDATE utilisateurs SET actif = ${actif} WHERE id = ${id}`;
    if (!actif) await this.sql`DELETE FROM sessions WHERE utilisateur_id = ${id}`;
  }

  async changerMotDePasse(id: string, motDePasse: string): Promise<void> {
    const empreinte = await hacher(motDePasse);
    await this.sql`UPDATE utilisateurs SET empreinte = ${empreinte} WHERE id = ${id}`;
    // Toutes les sessions tombent : changer de mot de passe doit fermer la
    // porte que quelqu'un d'autre aurait laissée ouverte.
    await this.sql`DELETE FROM sessions WHERE utilisateur_id = ${id}`;
  }

  /**
   * Vérifie un couple adresse / mot de passe.
   *
   * Renvoie `null` aussi bien pour une adresse inconnue que pour un mot de
   * passe faux ou un compte désactivé : distinguer les cas dans la réponse
   * dirait à qui essaie quelles adresses existent.
   */
  async authentifier(courriel: string, motDePasse: string): Promise<Utilisateur | null> {
    const lignes = await this.sql<(LigneUtilisateur & { empreinte: string })[]>`
      SELECT ${this.sql.unsafe(CHAMPS)}, empreinte
      FROM utilisateurs WHERE courriel = ${normaliserCourriel(courriel)}
    `;
    const ligne = lignes[0];
    if (!ligne) {
      // On hache quand même : sans ça, une adresse inconnue répond bien plus
      // vite qu'une adresse connue, et la liste des comptes se devine.
      await hacher(motDePasse);
      return null;
    }

    const { valide, àRefaire } = await vérifier(motDePasse, ligne.empreinte);
    if (!valide || !ligne.actif) return null;

    if (àRefaire) await this.changerMotDePasse(ligne.id, motDePasse);
    await this.sql`UPDATE utilisateurs SET derniere_connexion = now() WHERE id = ${ligne.id}`;
    return versUtilisateur(ligne);
  }

  // --- Sessions ---------------------------------------------------------

  /** Renvoie le jeton en clair : c'est la seule fois où il existe. */
  async ouvrirSession(utilisateurId: string, agent: string | null): Promise<string> {
    const jeton = randomBytes(32).toString("base64url");
    await this.sql`
      INSERT INTO sessions (empreinte, utilisateur_id, expire_le, agent)
      VALUES (
        ${empreinteDeJeton(jeton)},
        ${utilisateurId},
        ${new Date(Date.now() + DUREE_SESSION_MS)},
        ${agent}
      )
    `;
    return jeton;
  }

  async utilisateurDeSession(jeton: string): Promise<Utilisateur | null> {
    const lignes = await this.sql<LigneUtilisateur[]>`
      SELECT u.id, u.courriel, u.nom, u.role, u.actif, u.cree_le, u.derniere_connexion
      FROM sessions s JOIN utilisateurs u ON u.id = s.utilisateur_id
      WHERE s.empreinte = ${empreinteDeJeton(jeton)}
        AND s.expire_le > now()
        AND u.actif
    `;
    return lignes[0] ? versUtilisateur(lignes[0]) : null;
  }

  async fermerSession(jeton: string): Promise<void> {
    await this.sql`DELETE FROM sessions WHERE empreinte = ${empreinteDeJeton(jeton)}`;
  }

  /** Les sessions expirées ne servent plus qu'à faire grossir la table. */
  async purgerSessions(): Promise<number> {
    const supprimées = await this.sql`DELETE FROM sessions WHERE expire_le <= now()`;
    return supprimées.count;
  }

  // --- Journal ----------------------------------------------------------

  async journaliser(entree: {
    utilisateurId: string | null;
    auteur: string;
    action: string;
    cible?: string;
    details?: unknown;
  }): Promise<void> {
    await this.sql`
      INSERT INTO journal (utilisateur_id, auteur, action, cible, details)
      VALUES (
        ${entree.utilisateurId},
        ${entree.auteur},
        ${entree.action},
        ${entree.cible ?? null},
        ${entree.details === undefined ? null : this.sql.json(entree.details as never)}
      )
    `;
  }

  async lireJournal(limite = 100): Promise<EntreeJournal[]> {
    type LigneJournal = {
      id: string;
      au: Date;
      auteur: string;
      action: string;
      cible: string | null;
      details: unknown;
    };
    const lignes = await this.sql<LigneJournal[]>`
      SELECT id::text, au, auteur, action, cible, details
      FROM journal ORDER BY au DESC LIMIT ${limite}
    `;
    return lignes.map((l: LigneJournal) => ({
      id: l.id,
      au: l.au.toISOString(),
      auteur: l.auteur,
      action: l.action,
      cible: l.cible,
      details: l.details,
    }));
  }
}
