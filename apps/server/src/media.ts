import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Service des médias.
 *
 * Deux exigences du cahier des charges tiennent ici :
 *   - les téléchargements interrompus reprennent où ils se sont arrêtés,
 *     donc il faut gérer les requêtes `Range` ;
 *   - le player vérifie une empreinte SHA-256, donc c'est le serveur qui la
 *     calcule et fait autorité.
 *
 * Le stockage est sur disque pour l'instant. Passer à un stockage objet
 * compatible S3 ne change que cette classe : l'API reste identique.
 */

export interface StoredMedia {
  id: string;
  sha256: string;
  bytes: number;
  mime: string;
  path: string;
  /** Nom d'origine du fichier, pour que la console reste lisible. */
  filename?: string;
}

export interface RangeRequest {
  start: number;
  end: number;
}

/** Analyse un en-tête `Range: bytes=<start>-<end>`. */
export function parseRange(header: string | undefined, size: number): RangeRequest | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return "invalid";

  // « bytes=-500 » : les 500 derniers octets.
  if (rawStart === "") {
    const length = Number(rawEnd);
    if (length <= 0) return "invalid";
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return "invalid";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return "invalid";
  return { start, end };
}

export class MediaStore {
  private readonly entries = new Map<string, StoredMedia>();

  constructor(private readonly directory: string) {
    this.namesPath = join(directory, "noms.json");
  }

  private async persistIndex(): Promise<void> {
    const names = Object.fromEntries(
      [...this.entries.values()].filter((m) => m.filename).map((m) => [m.id, m.filename!]),
    );
    await writeFile(this.namesPath, JSON.stringify(names));
  }

  private readonly namesPath: string;

  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    let names: Record<string, string> = {};
    try {
      names = JSON.parse(await readFile(this.namesPath, "utf8")) as Record<string, string>;
    } catch {
      // Bibliothèque neuve, ou index perdu : les noms d'origine ne sont
      // qu'un confort, on repart sans.
    }
    for (const name of await readdir(this.directory)) {
      const path = join(this.directory, name);
      const info = await stat(path);
      if (!info.isFile()) continue;
      if (name === "noms.json") continue;
      const id = name.replace(/\.[^.]+$/, "");
      this.entries.set(id, {
        id,
        sha256: await hashFile(path),
        bytes: info.size,
        mime: guessMime(name),
        path,
        ...(names[id] ? { filename: names[id] } : {}),
      });
    }
  }

  /** Enregistre un média et calcule son empreinte, qui fera foi. */
  async put(id: string, data: Buffer, mime: string, filename?: string): Promise<StoredMedia> {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, `${id}${extensionFor(mime)}`);
    await writeFile(path, data);
    const media: StoredMedia = {
      id,
      sha256: createHash("sha256").update(data).digest("hex"),
      bytes: data.byteLength,
      mime,
      path,
      ...(filename ? { filename } : {}),
    };
    this.entries.set(id, media);
    await this.persistIndex();
    return media;
  }

  get(id: string): StoredMedia | undefined {
    return this.entries.get(id);
  }

  /** La bibliothèque, du plus récent au plus ancien. */
  list(): StoredMedia[] {
    return [...this.entries.values()].reverse();
  }

  /** Vue indexée, telle qu'attendue par le composeur. */
  index(): ReadonlyMap<string, StoredMedia> {
    return this.entries;
  }

  stream(media: StoredMedia, range: RangeRequest | null): NodeJS.ReadableStream {
    return range
      ? createReadStream(media.path, { start: range.start, end: range.end })
      : createReadStream(media.path);
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function guessMime(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot >= 0 ? MIME_BY_EXTENSION[name.slice(dot).toLowerCase()] : undefined) ?? "application/octet-stream";
}

function extensionFor(mime: string): string {
  for (const [extension, value] of Object.entries(MIME_BY_EXTENSION)) {
    if (value === mime) return extension;
  }
  return "";
}
