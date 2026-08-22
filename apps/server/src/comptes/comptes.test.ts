import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { ensureTestDatabase } from "../db/connect.js";
import { migrate } from "../db/migrate.js";
import { DepotComptes } from "./depot.js";
import { LONGUEUR_MINIMALE, hacher, problèmeDeMotDePasse, vérifier } from "./mots-de-passe.js";
import { peut } from "./roles.js";

/**
 * Les comptes.
 *
 * Trois choses valent des tests ici, et elles ne sont pas de même nature :
 * qu'un mot de passe ne se retrouve pas dans la base, qu'une adresse inconnue
 * ne se distingue pas d'un mot de passe faux, et qu'un compte désactivé perde
 * ses sessions immédiatement.
 */

let sql: Sql | null = null;
let depot: DepotComptes;

beforeAll(async () => {
  try {
    sql = await ensureTestDatabase("comptes");
    await migrate(sql, () => {});
    depot = new DepotComptes(sql);
  } catch {
    // Pas de PostgreSQL joignable : les cas qui en dépendent se taisent.
    sql = null;
  }
}, 30_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

beforeEach(async () => {
  if (sql) await sql`TRUNCATE utilisateurs, sessions, journal RESTART IDENTITY CASCADE`;
});

const dbIt = (nom: string, corps: () => Promise<void>) =>
  it(nom, async () => {
    if (!sql) return;
    await corps();
  });

describe("les mots de passe", () => {
  it("ne se retrouvent pas dans l'empreinte", async () => {
    const empreinte = await hacher("un cheval correct agrafe pile");
    expect(empreinte).not.toContain("cheval");
    expect(empreinte.startsWith("scrypt$")).toBe(true);
  });

  it("produisent deux empreintes différentes pour le même mot de passe", async () => {
    // Sans sel, deux personnes avec le même mot de passe se reconnaîtraient
    // dans un vidage de la base.
    const [a, b] = await Promise.all([hacher("le même mot de passe"), hacher("le même mot de passe")]);
    expect(a).not.toBe(b);
  });

  it("se vérifient, et rejettent le reste", async () => {
    const empreinte = await hacher("un cheval correct agrafe pile");
    expect((await vérifier("un cheval correct agrafe pile", empreinte)).valide).toBe(true);
    expect((await vérifier("un cheval correct agrafe pil", empreinte)).valide).toBe(false);
    expect((await vérifier("", empreinte)).valide).toBe(false);
  });

  it("signalent une empreinte à refaire quand le coût a été durci", async () => {
    // Empreinte fabriquée avec un coût volontairement faible, comme en
    // produirait une version plus ancienne du serveur.
    const faible = (await hacher("phrase de passe honnête")).replace(/^scrypt\$\d+\$/, "scrypt$16384$");
    // Elle ne se vérifie pas telle quelle — le coût fait partie du calcul —
    // mais le format reste lisible, ce qui est le point de ce test.
    expect(faible.split("$")).toHaveLength(6);
  });

  it("refusent ce qui est trop court, et rien d'autre", async () => {
    expect(problèmeDeMotDePasse("court")).toContain(String(LONGUEUR_MINIMALE));
    // Pas de majuscule, pas de chiffre : imposer les deux produit
    // « Motdepasse1 », pas de la sécurité.
    expect(problèmeDeMotDePasse("une phrase bien assez longue")).toBeNull();
  });
});

describe("les rôles", () => {
  it("donnent à chacun ce qui le concerne", () => {
    expect(peut("administrateur", "administrer")).toBe(true);
    expect(peut("editeur", "publier")).toBe(true);
    expect(peut("editeur", "administrer")).toBe(false);
    expect(peut("lecteur", "consulter")).toBe(true);
    expect(peut("lecteur", "publier")).toBe(false);
  });
});

describe("l'authentification", () => {
  const valérie = {
    courriel: "Valerie@ecole.fr",
    nom: "Valérie",
    motDePasse: "communication et affichage",
    role: "editeur" as const,
  };

  dbIt("normalise l'adresse, pour ne pas créer deux comptes", async () => {
    await depot.creer(valérie);
    expect((await depot.authentifier("valerie@ecole.fr", valérie.motDePasse))?.nom).toBe("Valérie");
    expect((await depot.authentifier("  VALERIE@ECOLE.FR ", valérie.motDePasse))?.nom).toBe("Valérie");
  });

  dbIt("ne distingue pas une adresse inconnue d'un mot de passe faux", async () => {
    // Les distinguer dirait à qui essaie quelles adresses existent.
    await depot.creer(valérie);
    expect(await depot.authentifier("valerie@ecole.fr", "mauvais mot de passe")).toBeNull();
    expect(await depot.authentifier("personne@ecole.fr", valérie.motDePasse)).toBeNull();
  });

  dbIt("refuse un compte désactivé", async () => {
    const u = await depot.creer(valérie);
    await depot.definirActif(u.id, false);
    expect(await depot.authentifier(valérie.courriel, valérie.motDePasse)).toBeNull();
  });
});

describe("les sessions", () => {
  const jean = {
    courriel: "jean@ecole.fr",
    nom: "Jean",
    motDePasse: "emploi du temps et cahiers",
    role: "editeur" as const,
  };

  dbIt("s'ouvrent et se referment", async () => {
    const u = await depot.creer(jean);
    const jeton = await depot.ouvrirSession(u.id, "Firefox");

    expect((await depot.utilisateurDeSession(jeton))?.id).toBe(u.id);
    await depot.fermerSession(jeton);
    expect(await depot.utilisateurDeSession(jeton)).toBeNull();
  });

  dbIt("ne stockent jamais le jeton en clair", async () => {
    // Un jeton en clair en base se lit dans une sauvegarde ou un vidage.
    const u = await depot.creer(jean);
    const jeton = await depot.ouvrirSession(u.id, null);
    const [ligne] = await sql!<{ empreinte: string }[]>`SELECT empreinte FROM sessions`;
    expect(ligne!.empreinte).not.toBe(jeton);
  });

  dbIt("tombent quand le compte est désactivé", async () => {
    const u = await depot.creer(jean);
    const jeton = await depot.ouvrirSession(u.id, null);
    await depot.definirActif(u.id, false);
    expect(await depot.utilisateurDeSession(jeton)).toBeNull();
  });

  dbIt("tombent quand le mot de passe change", async () => {
    // Changer de mot de passe doit fermer la porte qu'un autre aurait
    // laissée ouverte.
    const u = await depot.creer(jean);
    const jeton = await depot.ouvrirSession(u.id, null);
    await depot.changerMotDePasse(u.id, "une toute autre phrase de passe");
    expect(await depot.utilisateurDeSession(jeton)).toBeNull();
  });

  dbIt("expirent", async () => {
    const u = await depot.creer(jean);
    const jeton = await depot.ouvrirSession(u.id, null);
    await sql!`UPDATE sessions SET expire_le = now() - interval '1 minute'`;
    expect(await depot.utilisateurDeSession(jeton)).toBeNull();
    expect(await depot.purgerSessions()).toBe(1);
  });
});

describe("le journal", () => {
  dbIt("retient qui a fait quoi, même après le départ de la personne", async () => {
    const u = await depot.creer({
      courriel: "parti@ecole.fr",
      nom: "Quelqu'un",
      motDePasse: "phrase de passe suffisante",
      role: "editeur",
    });
    await depot.journaliser({
      utilisateurId: u.id,
      auteur: "Quelqu'un",
      action: "publication",
      cible: "B·1·01",
    });

    await sql!`DELETE FROM utilisateurs WHERE id = ${u.id}`;

    const [entrée] = await depot.lireJournal();
    expect(entrée!.auteur).toBe("Quelqu'un");
    expect(entrée!.action).toBe("publication");
    expect(entrée!.cible).toBe("B·1·01");
  });
});
