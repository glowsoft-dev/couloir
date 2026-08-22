import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { buildApp } from "../app.js";
import { CONSOLE_PREFIX } from "../console-api.js";
import { ensureTestDatabase } from "../db/connect.js";
import { migrate } from "../db/migrate.js";
import { PostgresStore } from "../db/postgres-store.js";
import { MediaStore } from "../media.js";
import { DepotComptes } from "./depot.js";

/**
 * Le garde de la console.
 *
 * C'est la pièce qui doit être juste : une erreur ici ouvre la publication
 * sur tous les écrans de l'école à qui passait par là. Les cas testés sont
 * ceux qu'on croit évidents et qu'on oublie d'écrire — la clé de secours qui
 * publierait, un lecteur qui modifierait, un éditeur qui créerait des
 * comptes, une session fermée qui continuerait de servir.
 */

const CLEF = "clef-de-secours-de-test";

let sql: Sql | null = null;
let app: FastifyInstance;
let depot: DepotComptes;
let dossier: string;

beforeAll(async () => {
  try {
    sql = await ensureTestDatabase("garde");
    await migrate(sql, () => {});
  } catch {
    sql = null;
  }
}, 30_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

beforeEach(async () => {
  if (!sql) return;
  await sql`TRUNCATE utilisateurs, sessions, journal RESTART IDENTITY CASCADE`;
  await sql`TRUNCATE screens, devices RESTART IDENTITY CASCADE`;

  dossier = await mkdtemp(join(tmpdir(), "couloir-garde-"));
  const media = new MediaStore(dossier);
  await media.load();
  depot = new DepotComptes(sql);
  app = buildApp({
    store: new PostgresStore(sql),
    media,
    consoleToken: CLEF,
    comptes: depot,
    cookieSécurisé: false,
  });
  await app.ready();
});

afterEach(async () => {
  await app?.close();
  if (dossier) await rm(dossier, { recursive: true, force: true });
});

const dbIt = (nom: string, corps: () => Promise<void>) =>
  it(nom, async () => {
    if (!sql) return;
    await corps();
  });

/** Ouvre une session et renvoie le cookie à rejouer. */
async function connexion(courriel: string, motDePasse: string): Promise<string> {
  const réponse = await app.inject({
    method: "POST",
    url: `${CONSOLE_PREFIX}/session`,
    payload: { courriel, motDePasse },
  });
  expect(réponse.statusCode).toBe(200);
  const posé = réponse.headers["set-cookie"];
  return String(Array.isArray(posé) ? posé[0] : posé).split(";")[0]!;
}

async function créer(role: "administrateur" | "editeur" | "lecteur", courriel: string) {
  return depot.creer({
    courriel,
    nom: courriel.split("@")[0]!,
    motDePasse: "une phrase de passe honnête",
    role,
  });
}

describe("sans session", () => {
  dbIt("refuse la console", async () => {
    const r = await app.inject({ method: "GET", url: `${CONSOLE_PREFIX}/screens` });
    expect(r.statusCode).toBe(401);
  });

  dbIt("laisse voir l'état de l'amorçage, et lui seul", async () => {
    // La console doit savoir s'il faut demander de se connecter ou de créer
    // le premier compte. Rien d'autre ne doit filtrer.
    const r = await app.inject({ method: "GET", url: `${CONSOLE_PREFIX}/amorce` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ comptesExistants: false });
  });
});

describe("la clé de secours", () => {
  dbIt("crée le premier administrateur, et une seule fois", async () => {
    const corps = {
      courriel: "jeremy@ecole.fr",
      nom: "Jérémy",
      motDePasse: "la première phrase de passe",
    };
    const premier = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/utilisateurs/premier`,
      headers: { authorization: `Bearer ${CLEF}` },
      payload: corps,
    });
    expect(premier.statusCode).toBe(200);
    expect(premier.json().utilisateur.role).toBe("administrateur");

    const second = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/utilisateurs/premier`,
      headers: { authorization: `Bearer ${CLEF}` },
      payload: { ...corps, courriel: "autre@ecole.fr" },
    });
    expect(second.statusCode).toBe(409);
  });

  dbIt("NE PUBLIE PAS", async () => {
    // Le point entier de la clé : quelqu'un qui la connaîtrait ne peut pas
    // s'en servir pour afficher quoi que ce soit dans un couloir.
    await créer("administrateur", "admin@ecole.fr");
    const r = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/screens/peu-importe/publish`,
      headers: { authorization: `Bearer ${CLEF}` },
      payload: { layout: "plein-ecran", items: [] },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().message).toContain("ne donne accès qu'aux comptes");
  });

  dbIt("ne montre pas le parc", async () => {
    await créer("administrateur", "admin@ecole.fr");
    const r = await app.inject({
      method: "GET",
      url: `${CONSOLE_PREFIX}/screens`,
      headers: { authorization: `Bearer ${CLEF}` },
    });
    expect(r.statusCode).toBe(401);
  });

  dbIt("rouvre la porte quand plus personne ne peut entrer", async () => {
    // Le dernier administrateur a perdu son mot de passe : la clé permet de
    // lui en donner un nouveau, et rien d'autre.
    const perdu = await créer("administrateur", "perdu@ecole.fr");
    const r = await app.inject({
      method: "PATCH",
      url: `${CONSOLE_PREFIX}/utilisateurs/${perdu.id}`,
      headers: { authorization: `Bearer ${CLEF}` },
      payload: { motDePasse: "une toute nouvelle phrase de passe" },
    });
    expect(r.statusCode).toBe(200);
    expect(await depot.authentifier("perdu@ecole.fr", "une toute nouvelle phrase de passe")).not.toBeNull();
  });
});

describe("les rôles", () => {
  dbIt("un lecteur consulte mais ne publie pas", async () => {
    await créer("lecteur", "lecteur@ecole.fr");
    const cookie = await connexion("lecteur@ecole.fr", "une phrase de passe honnête");

    expect((await app.inject({ method: "GET", url: `${CONSOLE_PREFIX}/screens`, headers: { cookie } })).statusCode).toBe(200);

    const publication = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/screens/peu-importe/publish`,
      headers: { cookie },
      payload: { layout: "plein-ecran", items: [] },
    });
    expect(publication.statusCode).toBe(403);
    expect(publication.json().message).toContain("lecture seule");
  });

  dbIt("un éditeur publie mais ne gère pas les comptes", async () => {
    await créer("editeur", "valerie@ecole.fr");
    const cookie = await connexion("valerie@ecole.fr", "une phrase de passe honnête");

    // Ce qui compte est que le garde laisse passer : la requête est ensuite
    // refusée sur le fond — composition vide — et non sur le droit d'agir.
    const publication = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/screens/inexistant/publish`,
      headers: { cookie },
      payload: { layout: "plein-ecran", items: [] },
    });
    expect(publication.statusCode).not.toBe(403);
    expect(publication.statusCode).not.toBe(401);

    const comptes = await app.inject({
      method: "GET",
      url: `${CONSOLE_PREFIX}/utilisateurs`,
      headers: { cookie },
    });
    expect(comptes.statusCode).toBe(403);
  });

  dbIt("un administrateur ne peut pas se rétrograder lui-même", async () => {
    // Sans ce garde, le dernier administrateur se retire et plus personne ne
    // peut créer de compte.
    const admin = await créer("administrateur", "admin@ecole.fr");
    const cookie = await connexion("admin@ecole.fr", "une phrase de passe honnête");

    const r = await app.inject({
      method: "PATCH",
      url: `${CONSOLE_PREFIX}/utilisateurs/${admin.id}`,
      headers: { cookie },
      payload: { role: "lecteur" },
    });
    expect(r.statusCode).toBe(409);
  });
});

describe("les sessions", () => {
  dbIt("se ferment, et le cookie ne sert plus", async () => {
    await créer("editeur", "valerie@ecole.fr");
    const cookie = await connexion("valerie@ecole.fr", "une phrase de passe honnête");

    await app.inject({ method: "DELETE", url: `${CONSOLE_PREFIX}/session`, headers: { cookie } });

    const après = await app.inject({ method: "GET", url: `${CONSOLE_PREFIX}/screens`, headers: { cookie } });
    expect(après.statusCode).toBe(401);
  });

  dbIt("posent un cookie inaccessible au JavaScript de la page", async () => {
    // Sans httpOnly, une faille d'injection dans la console suffirait à
    // emporter la session.
    await créer("editeur", "valerie@ecole.fr");
    const r = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/session`,
      payload: { courriel: "valerie@ecole.fr", motDePasse: "une phrase de passe honnête" },
    });
    const posé = String(r.headers["set-cookie"]);
    expect(posé).toContain("HttpOnly");
    expect(posé).toContain("SameSite=Strict");
  });

  dbIt("refusent un cookie inventé", async () => {
    await créer("editeur", "valerie@ecole.fr");
    const r = await app.inject({
      method: "GET",
      url: `${CONSOLE_PREFIX}/screens`,
      headers: { cookie: "couloir_session=un-jeton-inventé" },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe("le journal", () => {
  dbIt("retient qui s'est connecté", async () => {
    await créer("editeur", "valerie@ecole.fr");
    await connexion("valerie@ecole.fr", "une phrase de passe honnête");

    const entrées = await depot.lireJournal();
    expect(entrées.some((e) => e.action === "connexion" && e.auteur === "valerie")).toBe(true);
  });

  dbIt("n'est lisible que par un administrateur", async () => {
    await créer("editeur", "valerie@ecole.fr");
    const cookie = await connexion("valerie@ecole.fr", "une phrase de passe honnête");
    const r = await app.inject({ method: "GET", url: `${CONSOLE_PREFIX}/journal`, headers: { cookie } });
    expect(r.statusCode).toBe(403);
  });
});
