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
  constructor(private readonly path: string) {}

  async load(): Promise<PersistedState | null> {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8")) as {
        manifest: unknown;
        etag: string | null;
        lastContactMs: number | null;
      };
      return {
        manifest: Manifest.parse(raw.manifest),
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
