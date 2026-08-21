import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StorePort } from "@couloir/agent";

/**
 * Le cache média sur disque.
 *
 * Trois précautions, chacune contre une panne qu'on ne verrait qu'une fois
 * l'écran posé en hauteur :
 *
 *   - un fichier arrive d'abord en `.part`, puis n'est publié qu'après
 *     vérification de son empreinte, par un renommage atomique. Une coupure
 *     de courant en plein téléchargement ne laisse jamais un média tronqué
 *     passer pour valide ;
 *   - l'index des accès est tenu à part, pour évincer les plus anciens quand
 *     le budget est atteint ;
 *   - un `.part` est conservé, pas supprimé : c'est lui qui permet de
 *     reprendre le téléchargement où il s'était arrêté.
 */

interface CacheIndex {
  [assetId: string]: { sha256: string; bytes: number; lastUsedMs: number };
}

export class FileStore implements StorePort {
  private index: CacheIndex = {};
  private readonly indexPath: string;

  constructor(
    private readonly directory: string,
    private readonly now: () => number = Date.now,
  ) {
    this.indexPath = join(directory, "index.json");
  }

  async open(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    try {
      this.index = JSON.parse(await readFile(this.indexPath, "utf8")) as CacheIndex;
    } catch {
      // Index absent ou illisible : on le reconstruit depuis les fichiers.
      this.index = {};
      await this.rebuildIndex();
    }
  }

  private async rebuildIndex(): Promise<void> {
    for (const name of await readdir(this.directory)) {
      if (name === "index.json" || name.endsWith(".part")) continue;
      const path = join(this.directory, name);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) continue;
      this.index[name] = { sha256: await hashFile(path), bytes: info.size, lastUsedMs: info.mtimeMs };
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    // L'index lui-même s'écrit de façon atomique : il est relu au démarrage.
    const temporary = `${this.indexPath}.tmp`;
    await writeFile(temporary, JSON.stringify(this.index));
    await rename(temporary, this.indexPath);
  }

  pathFor(assetId: string): string {
    return join(this.directory, assetId);
  }

  partPathFor(assetId: string): string {
    return join(this.directory, `${assetId}.part`);
  }

  async has(assetId: string, sha256: string): Promise<boolean> {
    const entry = this.index[assetId];
    if (!entry || entry.sha256 !== sha256) return false;

    // L'index peut mentir si quelqu'un a effacé le fichier à la main.
    const info = await stat(this.pathFor(assetId)).catch(() => null);
    if (!info?.isFile()) {
      delete this.index[assetId];
      await this.persist();
      return false;
    }

    entry.lastUsedMs = this.now();
    return true;
  }

  async partialBytes(assetId: string): Promise<number> {
    const info = await stat(this.partPathFor(assetId)).catch(() => null);
    return info?.isFile() ? info.size : 0;
  }

  async commit(assetId: string, sha256: string): Promise<void> {
    const partPath = this.partPathFor(assetId);
    const actual = await hashFile(partPath);
    if (actual !== sha256) {
      // Téléchargement corrompu ou repris de travers : on repart de zéro
      // plutôt que d'afficher n'importe quoi.
      await rm(partPath, { force: true });
      throw new Error(`empreinte incorrecte pour ${assetId} (attendu ${sha256}, obtenu ${actual})`);
    }

    const info = await stat(partPath);
    await rename(partPath, this.pathFor(assetId));
    this.index[assetId] = { sha256, bytes: info.size, lastUsedMs: this.now() };
    await this.persist();
  }

  async delete(assetId: string): Promise<void> {
    await rm(this.pathFor(assetId), { force: true });
    await rm(this.partPathFor(assetId), { force: true });
    delete this.index[assetId];
    await this.persist();
  }

  async usedBytes(): Promise<number> {
    return Object.values(this.index).reduce((sum, entry) => sum + entry.bytes, 0);
  }

  /** Éviction du plus ancien accès d'abord, sans jamais toucher au requis. */
  async evictTo(budgetBytes: number, keep: readonly string[]): Promise<string[]> {
    const protectedIds = new Set(keep);
    let used = await this.usedBytes();
    if (used <= budgetBytes) return [];

    const candidates = Object.entries(this.index)
      .filter(([id]) => !protectedIds.has(id))
      .sort((a, b) => a[1].lastUsedMs - b[1].lastUsedMs);

    const evicted: string[] = [];
    for (const [id, entry] of candidates) {
      if (used <= budgetBytes) break;
      await rm(this.pathFor(id), { force: true });
      delete this.index[id];
      used -= entry.bytes;
      evicted.push(id);
    }
    await this.persist();
    return evicted;
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
