import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LinuxUpdate } from "./update.js";

/*
 * Le remplacement du lecteur.
 *
 * C'est le code dont l'échec coûte le plus cher : un lecteur à moitié écrit,
 * c'est un couloir noir qu'on ne rallume qu'en montant à l'échelle — l'inverse
 * exact de ce que cette mise à jour existe pour éviter.
 */

let racine: string;
let update: LinuxUpdate;

const octets = (texte: string) => new TextEncoder().encode(texte);

beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), "couloir-maj-"));
  update = new LinuxUpdate(racine);
});

afterEach(async () => {
  await rm(racine, { recursive: true, force: true });
});

describe("installer", () => {
  it("pose la version et ses fichiers", async () => {
    await update.installer("abc123", [{ nom: "couloir-player.mjs", contenu: octets("v1") }]);

    expect(await update.versionInstallee()).toBe("abc123");
    expect(await readFile(join(racine, "courant", "couloir-player.mjs"), "utf8")).toBe("v1");
  });

  it("garde la version précédente", async () => {
    await update.installer("v1", [{ nom: "p.mjs", contenu: octets("un") }]);
    await update.installer("v2", [{ nom: "p.mjs", contenu: octets("deux") }]);

    expect(await update.versionInstallee()).toBe("v2");
    expect(await readFile(join(racine, "precedent", "p.mjs"), "utf8")).toBe("un");
  });

  it("n'empile pas les générations", async () => {
    // Deux versions mauvaises de suite ne se rattrapent pas par un troisième
    // dossier : elles se rattrapent en allant voir.
    await update.installer("v1", [{ nom: "p.mjs", contenu: octets("un") }]);
    await update.installer("v2", [{ nom: "p.mjs", contenu: octets("deux") }]);
    await update.installer("v3", [{ nom: "p.mjs", contenu: octets("trois") }]);

    expect(await readFile(join(racine, "precedent", "p.mjs"), "utf8")).toBe("deux");
    expect(existsSync(join(racine, "avant-precedent"))).toBe(false);
  });

  it("refuse un nom qui sortirait du dossier", async () => {
    // Le nom vient du serveur ; un serveur compromis ne doit pas pouvoir
    // écrire dans /etc.
    await expect(
      update.installer("v1", [{ nom: "../evasion.mjs", contenu: octets("x") }]),
    ).rejects.toThrow(/refusé/);
    await expect(
      update.installer("v1", [{ nom: "sous/dossier.mjs", contenu: octets("x") }]),
    ).rejects.toThrow(/refusé/);
  });

  it("remet le compteur d'échecs à zéro", async () => {
    // Une version neuve n'est pas la suite de l'échec précédent.
    await update.installer("v1", [{ nom: "p.mjs", contenu: octets("un") }]);
    await update.noterDemarrage();
    await update.noterDemarrage();
    await update.installer("v2", [{ nom: "p.mjs", contenu: octets("deux") }]);

    expect(await update.demarragesRates()).toBe(0);
  });
});

describe("revenirEnArriere", () => {
  it("remet la version précédente en place", async () => {
    await update.installer("v1", [{ nom: "p.mjs", contenu: octets("un") }]);
    await update.installer("v2", [{ nom: "p.mjs", contenu: octets("deux") }]);

    expect(await update.revenirEnArriere()).toBe(true);
    expect(await update.versionInstallee()).toBe("v1");
    expect(await readFile(join(racine, "courant", "p.mjs"), "utf8")).toBe("un");
  });

  it("jette la version fautive", async () => {
    // La garder ferait osciller entre les deux à chaque démarrage.
    await update.installer("v1", [{ nom: "p.mjs", contenu: octets("un") }]);
    await update.installer("v2", [{ nom: "p.mjs", contenu: octets("deux") }]);
    await update.revenirEnArriere();

    expect(existsSync(join(racine, "precedent"))).toBe(false);
    expect(await update.revenirEnArriere()).toBe(false);
  });

  it("ne revient nulle part au premier lecteur posé", async () => {
    await update.installer("v1", [{ nom: "p.mjs", contenu: octets("un") }]);
    expect(await update.revenirEnArriere()).toBe(false);
    // Et surtout : il reste en place. Mieux vaut un écran qui redémarre en
    // boucle et qu'on voit, qu'un retour vers du vide.
    expect(await update.versionInstallee()).toBe("v1");
  });
});

describe("compteur de démarrages", () => {
  it("compte les démarrages et s'efface au premier contact", async () => {
    await update.noterDemarrage();
    await update.noterDemarrage();
    expect(await update.demarragesRates()).toBe(2);

    await update.marquerDemarrageReussi();
    expect(await update.demarragesRates()).toBe(0);
  });

  it("repart de zéro sur un compteur illisible", async () => {
    // Une carte SD abîmée ne doit pas déclencher un retour en arrière.
    await writeFile(join(racine, "demarrages-rates"), "n'importe quoi");
    expect(await update.demarragesRates()).toBe(0);
  });
});

describe("fichiersCourants", () => {
  it("rend les empreintes de ce qui tourne, sans le fichier de version", async () => {
    await update.installer("v1", [
      { nom: "p.mjs", contenu: octets("un") },
      { nom: "c.js", contenu: octets("deux") },
    ]);
    const fichiers = await update.fichiersCourants();
    expect(fichiers.map((f) => f.nom).sort()).toEqual(["c.js", "p.mjs"]);
    for (const f of fichiers) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ne rend rien avant la première installation", async () => {
    expect(await update.fichiersCourants()).toEqual([]);
  });
});
