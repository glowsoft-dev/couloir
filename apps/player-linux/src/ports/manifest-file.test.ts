import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ManifestFile } from "./manifest-file.js";

const MANIFESTE = {
  schemaVersion: 1,
  screenId: "ecran-un",
  version: 24,
  issuedAt: "2026-08-28T14:38:00Z",
  settings: {
    pollIntervalSec: 60,
    cacheBudgetBytes: 1024,
    offlineGraceDays: 7,
    timezone: "Europe/Paris",
    displayOff: [],
    showScreenCodeWatermark: true,
  },
  layout: {
    id: "plein-ecran",
    orientation: "landscape",
    zones: [
      {
        id: "principale",
        rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
        playlistId: "repli",
      },
    ],
  },
  playlists: [],
  slides: [],
  assets: [],
  dataSources: [],
  schedules: [],
  emergency: null,
  fallbackPlaylistId: "repli",
};

async function fichier(): Promise<string> {
  const dossier = await mkdtemp(join(tmpdir(), "couloir-"));
  const chemin = join(dossier, "manifest.json");
  await writeFile(
    chemin,
    JSON.stringify({ manifest: MANIFESTE, etag: "abc", lastContactMs: 1 }),
  );
  return chemin;
}

describe("ManifestFile", () => {
  it("relit le manifeste de l'écran auquel le boîtier est rattaché", async () => {
    const état = await new ManifestFile(await fichier(), "ecran-un").load();
    expect(état?.manifest.version).toBe(24);
  });

  it("refuse le manifeste d'un autre écran", async () => {
    /*
     * Le cas réel : un boîtier repointé vers un nouveau serveur, identité
     * refaite, cache conservé. Il rejouait la composition de l'ancien
     * serveur — sources de données comprises, qui ne répondaient plus.
     * Et comme la dalle affichait quelque chose, ça passait pour normal.
     */
    const état = await new ManifestFile(await fichier(), "ecran-deux").load();
    expect(état).toBeNull();
  });

  it("relit sans vérifier quand aucun écran n'est attendu", async () => {
    // Le boîtier pas encore rattaché : on ne peut rien comparer, et jeter le
    // cache le priverait de son contenu après une coupure.
    expect((await new ManifestFile(await fichier()).load())?.manifest.version).toBe(24);
    expect((await new ManifestFile(await fichier(), null).load())?.manifest.version).toBe(24);
  });

  it("ignore un fichier illisible plutôt que d'empoisonner le rendu", async () => {
    const dossier = await mkdtemp(join(tmpdir(), "couloir-"));
    const chemin = join(dossier, "manifest.json");
    await writeFile(chemin, "{ceci n'est pas du JSON");
    expect(await new ManifestFile(chemin, "ecran-un").load()).toBeNull();
  });

  it("réécrit de façon atomique", async () => {
    const chemin = await fichier();
    const f = new ManifestFile(chemin, "ecran-un");
    await f.save({ manifest: MANIFESTE as never, etag: "def", lastContactMs: 2 });
    const relu = JSON.parse(await readFile(chemin, "utf8"));
    expect(relu.etag).toBe("def");
  });
});
