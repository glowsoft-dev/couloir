import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Manifest } from "@couloir/protocol";
import type { ManifestPersistence, PersistedState } from "@couloir/agent";

/**
 * Le manifeste appliqué, gardé sur le disque.
 *
 * C'est ce qui permet à un écran de retrouver son contenu après une coupure
 * de courant, sans réseau : les médias sont déjà dans le cache, il ne
 * manquait que la liste qui dit quoi en faire.
 *
 * Écriture atomique, et validation à la relecture : un fichier corrompu par
 * une coupure en pleine écriture est ignoré plutôt que d'empoisonner le rendu.
 */
export class ManifestFile implements ManifestPersistence {
  /**
   * @param ecranAttendu L'écran auquel le boîtier est actuellement rattaché.
   *   Omis, on relit sans vérifier — le comportement d'avant.
   */
  constructor(
    private readonly path: string,
    private readonly ecranAttendu?: string | null,
  ) {}

  async load(): Promise<PersistedState | null> {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8")) as {
        manifest: unknown;
        etag: string | null;
        lastContactMs: number | null;
      };
      const manifest = Manifest.parse(raw.manifest);

      /*
       * Un manifeste appartient à UN écran, sur UN serveur.
       *
       * Rattacher un boîtier à un autre serveur ne suffisait pas à lui faire
       * oublier son contenu : l'identité était refaite, le cache restait, et
       * la dalle rejouait la composition de l'ancien serveur — dont les
       * sources de données pointent vers une machine qui n'existe plus. Vu
       * sur un écran en service : un emploi du temps de trois jours plus tôt,
       * et « source inaccessible » toutes les trente secondes.
       *
       * Le pire est que ça ressemble à un fonctionnement normal : l'écran
       * affiche quelque chose.
       */
      if (this.ecranAttendu && manifest.screenId !== this.ecranAttendu) return null;

      return {
        manifest,
        etag: raw.etag ?? null,
        lastContactMs: typeof raw.lastContactMs === "number" ? raw.lastContactMs : null,
      };
    } catch {
      return null;
    }
  }

  async save(state: PersistedState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(state));
    await rename(temporary, this.path);
  }
}
