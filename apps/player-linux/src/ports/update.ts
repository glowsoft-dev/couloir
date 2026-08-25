import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { UpdatePort } from "@couloir/agent";

/**
 * Le remplacement du lecteur sur un Raspberry.
 *
 * L'ordre n'est pas négociable : on écrit à côté, on garde l'ancienne
 * version, on bascule par un renommage. Un lecteur à moitié écrit, c'est un
 * couloir noir qu'on ne rallume qu'en montant à l'échelle — l'inverse exact
 * de ce que cette mise à jour existe pour éviter.
 *
 * Trois dossiers voisins : `courant`, `precedent`, et un `.entrant` de
 * travail. Le renommage d'un dossier est atomique sur le même système de
 * fichiers, si bien qu'une coupure de courant laisse toujours l'un ou
 * l'autre, jamais un mélange.
 */
export class LinuxUpdate implements UpdatePort {
  constructor(private readonly racine: string) {}

  private get courant(): string {
    return join(this.racine, "courant");
  }
  private get precedent(): string {
    return join(this.racine, "precedent");
  }
  private get entrant(): string {
    return join(this.racine, ".entrant");
  }
  private get compteur(): string {
    return join(this.racine, "demarrages-rates");
  }

  async versionInstallee(): Promise<string | null> {
    try {
      return (await readFile(join(this.courant, "version"), "utf8")).trim() || null;
    } catch {
      return null;
    }
  }

  async installer(
    version: string,
    fichiers: { nom: string; contenu: Uint8Array }[],
  ): Promise<void> {
    await rm(this.entrant, { recursive: true, force: true });
    await mkdir(this.entrant, { recursive: true });

    for (const fichier of fichiers) {
      // Le nom vient du serveur : on refuse tout ce qui sortirait du dossier.
      if (fichier.nom.includes("/") || fichier.nom.includes("..")) {
        throw new Error(`nom de fichier refusé : ${fichier.nom}`);
      }
      await writeFile(join(this.entrant, fichier.nom), fichier.contenu);
    }
    await writeFile(join(this.entrant, "version"), `${version}\n`);

    /*
     * On ne garde qu'une génération en arrière.
     *
     * Deux versions successives mauvaises ne se rattrapent pas par un
     * troisième dossier : elles se rattrapent en allant voir. Empiler les
     * anciennes remplirait la carte sans rien apprendre.
     */
    await rm(this.precedent, { recursive: true, force: true });
    if (existsSync(this.courant)) await rename(this.courant, this.precedent);
    await rename(this.entrant, this.courant);
    // Le compteur repart de zéro : c'est une version neuve, pas la suite de
    // l'échec précédent.
    await writeFile(this.compteur, "0\n");
  }

  async revenirEnArriere(): Promise<boolean> {
    if (!existsSync(this.precedent)) return false;
    // La version fautive part : la garder ferait osciller entre les deux à
    // chaque démarrage.
    await rm(this.entrant, { recursive: true, force: true });
    if (existsSync(this.courant)) await rename(this.courant, this.entrant);
    await rename(this.precedent, this.courant);
    await rm(this.entrant, { recursive: true, force: true });
    await writeFile(this.compteur, "0\n");
    return true;
  }

  async demarragesRates(): Promise<number> {
    try {
      const brut = Number.parseInt((await readFile(this.compteur, "utf8")).trim(), 10);
      return Number.isFinite(brut) && brut > 0 ? brut : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Compté au démarrage, effacé au premier contact réussi.
   *
   * Un processus démarré ne prouve rien : il peut planter trois secondes plus
   * tard, ou tourner sans jamais joindre le serveur. Reprendre contact, si.
   */
  async noterDemarrage(): Promise<void> {
    await mkdir(this.racine, { recursive: true });
    await writeFile(this.compteur, `${(await this.demarragesRates()) + 1}\n`);
  }

  async marquerDemarrageReussi(): Promise<void> {
    await mkdir(this.racine, { recursive: true });
    await writeFile(this.compteur, "0\n");
  }

  /** Les fichiers de la version en place, pour vérifier ce qui tourne. */
  async fichiersCourants(): Promise<{ nom: string; sha256: string }[]> {
    if (!existsSync(this.courant)) return [];
    const noms = (await readdir(this.courant)).filter((n) => n !== "version");
    return Promise.all(
      noms.map(async (nom) => ({
        nom,
        sha256: createHash("sha256")
          .update(await readFile(join(this.courant, nom)))
          .digest("hex"),
      })),
    );
  }
}
