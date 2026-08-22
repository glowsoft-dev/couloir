import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findBrokenReferences } from "@couloir/protocol";
import { buildApp } from "./app.js";
import { CONSOLE_PREFIX } from "./console-api.js";
import { CompositionError, compose } from "./composer.js";
import { MediaStore, type StoredMedia } from "./media.js";
import { MemoryStore } from "./store.js";

/**
 * Le composeur et l'API de la console.
 *
 * Le composeur est la pièce qui mérite le plus de tests : il traduit un
 * choix d'éditeur en manifeste, et une erreur ici produit un écran vide
 * qu'on ne diagnostiquera qu'en montant sur une échelle.
 */

const TOKEN = "jeton-de-test";
let directory: string;
let media: MediaStore;
let poster: StoredMedia;
let video: StoredMedia;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "couloir-console-"));
  media = new MediaStore(directory);
  await media.load();
  poster = await media.put("affiche", Buffer.alloc(2048, 1), "image/jpeg", "portes-ouvertes.jpg");
  video = await media.put("clip", Buffer.alloc(4096, 2), "video/mp4", "visite.mp4");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function composeWith(spec: Parameters<typeof compose>[0]["spec"]) {
  return compose({
    screenId: "ecran-1",
    version: 1,
    issuedAt: "2026-08-21T08:00:00Z",
    spec,
    media: media.index(),
    baseUrl: "http://serveur.test",
  });
}

describe("composeur", () => {
  it("produit un manifeste cohérent en plein écran", () => {
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [{ assetId: "affiche" }, { text: { titre: "Bonne rentrée" } }],
    });

    expect(findBrokenReferences(manifest)).toEqual([]);
    expect(manifest.layout.zones).toHaveLength(1);
    expect(manifest.assets.map((a) => a.id)).toEqual(["affiche"]);
  });

  it("n'impose pas de durée à une vidéo", () => {
    // Elle dure le temps qu'elle dure : c'est la couche DOM qui préviendra.
    const manifest = composeWith({ layout: "plein-ecran", items: [{ assetId: "clip" }] });
    const slide = manifest.slides.find((s) => s.id === "item-1");

    expect(slide).toMatchObject({ kind: "media", assetId: "clip" });
    // Aucune durée n'est posée : c'est la vidéo elle-même qui la donne.
    expect(slide && "durationMs" in slide && slide.durationMs !== undefined).toBe(false);
  });

  it("ajoute la colonne des cours et sa source", () => {
    const manifest = composeWith({
      layout: "principal-et-cours",
      items: [{ assetId: "affiche" }],
      timetableUrl: "http://serveur.test/connectors/timetable",
    });

    expect(findBrokenReferences(manifest)).toEqual([]);
    expect(manifest.layout.zones.map((z) => z.id)).toEqual(["principal", "cours"]);
    // La colonne se retire d'elle-même quand la donnée n'est plus fraîche.
    expect(manifest.dataSources[0]).toMatchObject({ id: "edt", stalePolicy: "hide" });
  });

  it("refuse la colonne des cours sans source", () => {
    expect(() =>
      composeWith({ layout: "principal-et-cours", items: [{ assetId: "affiche" }] }),
    ).toThrow(CompositionError);
  });

  it("place le bandeau en bas et réduit la zone au-dessus", () => {
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [{ assetId: "affiche" }],
      ticker: "Conseil de classe jeudi",
    });

    const principal = manifest.layout.zones.find((z) => z.id === "principal")!;
    const bandeau = manifest.layout.zones.find((z) => z.id === "bandeau")!;
    expect(principal.rect.heightPercent).toBe(91);
    expect(bandeau.rect.yPercent).toBe(91);
    expect(bandeau.rect.heightPercent).toBe(9);
  });

  it("ignore un bandeau vide plutôt que d'occuper la place pour rien", () => {
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [{ assetId: "affiche" }],
      ticker: "   ",
    });

    expect(manifest.layout.zones).toHaveLength(1);
    expect(manifest.layout.zones[0]!.rect.heightPercent).toBe(100);
  });

  it("prévoit toujours une playlist de repli", () => {
    // C'est elle qui s'affiche après une coupure trop longue.
    const manifest = composeWith({ layout: "plein-ecran", items: [{ assetId: "affiche" }] });

    expect(manifest.fallbackPlaylistId).toBe("repli");
    expect(manifest.playlists.find((p) => p.id === "repli")?.slideIds).toHaveLength(1);
  });

  it("refuse une publication vide, avec un message lisible", () => {
    expect(() => composeWith({ layout: "plein-ecran", items: [] })).toThrow(
      /au moins un contenu/,
    );
  });

  it("refuse un média disparu de la bibliothèque", () => {
    expect(() =>
      composeWith({ layout: "plein-ecran", items: [{ assetId: "fantome" }] }),
    ).toThrow(/n'existe plus/);
  });

  it("ne référence un média qu'une fois même s'il sert plusieurs diapositives", () => {
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [{ assetId: "affiche" }, { assetId: "affiche" }],
    });

    expect(manifest.assets).toHaveLength(1);
    expect(manifest.slides.filter((s) => s.kind === "media")).toHaveLength(2);
  });

  it("reprend l'empreinte du serveur, jamais une valeur fournie", () => {
    // Le player la vérifie après téléchargement : elle doit faire autorité.
    const manifest = composeWith({ layout: "plein-ecran", items: [{ assetId: "affiche" }] });
    expect(manifest.assets[0]).toMatchObject({ sha256: poster.sha256, bytes: poster.bytes });
  });
});

describe("accès à la console", () => {
  it("est fermée quand aucun jeton n'est configuré", async () => {
    const app = buildApp({ media, devRoutes: true });
    const response = await app.inject({ method: "GET", url: `${CONSOLE_PREFIX}/screens` });

    expect(response.statusCode).toBe(503);
    expect(response.json().message).toMatch(/n'est pas activée/);
  });

  it("refuse un jeton invalide", async () => {
    const app = buildApp({ media, consoleToken: TOKEN });
    const response = await app.inject({
      method: "GET",
      url: `${CONSOLE_PREFIX}/screens`,
      headers: { authorization: "Bearer mauvais-jeton" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("laisse passer le bon jeton", async () => {
    const app = buildApp({ media, consoleToken: TOKEN });
    const response = await app.inject({
      method: "GET",
      url: `${CONSOLE_PREFIX}/screens`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ screens: [], pending: [] });
  });
});

describe("mode urgence", () => {
  async function withScreens() {
    const store = new MemoryStore();
    const app = buildApp({ store, media, consoleToken: TOKEN });
    const auth = { authorization: `Bearer ${TOKEN}` };

    const codes = ["U·1·01", "U·1·02"];
    const screens = [];
    for (const code of codes) {
      const device = await store.startEnrollment("x".repeat(44), { platform: "linux" } as never);
      const { screen } = await store.claimNew(device.deviceId, {
        code, label: code, building: "U", floor: 1, area: "hall", orientation: "landscape",
      });
      await app.inject({
        method: "POST", url: `${CONSOLE_PREFIX}/screens/${screen.id}/publish`, headers: auth,
        payload: { layout: "plein-ecran", items: [{ assetId: poster.id }] },
      });
      screens.push(screen);
    }
    return { app, store, auth, screens };
  }

  it("prend tous les écrans et incrémente leur version", async () => {
    // Sans version incrémentée, l'agent ignorerait le manifeste : il refuse
    // toute version qui n'augmente pas.
    const { app, store, auth, screens } = await withScreens();

    const response = await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/emergency`, headers: auth,
      payload: { title: "Évacuation immédiate", body: "Parking nord." },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().applied).toEqual(["U·1·01", "U·1·02"]);
    for (const screen of screens) {
      const manifest = await store.getManifest(screen.id);
      expect(manifest?.version).toBe(2);
      expect(manifest?.emergency).toMatchObject({ title: "Évacuation immédiate" });
    }
  });

  it("signale les écrans qui n'ont rien reçu", async () => {
    // Savoir quels couloirs sont restés muets fait partie de l'information
    // d'urgence : on ne le passe pas sous silence.
    const { app, store, auth } = await withScreens();
    const device = await store.startEnrollment("y".repeat(44), { platform: "linux" } as never);
    await store.claimNew(device.deviceId, {
      code: "U·2·09", label: "Neuf", building: "U", floor: 2, area: "hall", orientation: "landscape",
    });

    const response = await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/emergency`, headers: auth,
      payload: { title: "Confinement" },
    });

    expect(response.json().skipped).toEqual(["U·2·09"]);
  });

  it("ne part qu'aux écrans visés quand on en désigne", async () => {
    const { app, store, auth, screens } = await withScreens();

    await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/emergency`, headers: auth,
      payload: { title: "Fermeture", screenIds: [screens[0]!.id] },
    });

    expect((await store.getManifest(screens[0]!.id))?.emergency).not.toBeNull();
    expect((await store.getManifest(screens[1]!.id))?.emergency).toBeNull();
  });

  it("ne se retire que sur action explicite", async () => {
    const { app, store, auth, screens } = await withScreens();
    await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/emergency`, headers: auth, payload: { title: "Évacuation" },
    });

    const cleared = await app.inject({ method: "DELETE", url: `${CONSOLE_PREFIX}/emergency`, headers: auth });

    expect(cleared.json().applied).toHaveLength(2);
    for (const screen of screens) {
      const manifest = await store.getManifest(screen.id);
      expect(manifest?.emergency).toBeNull();
      // Encore une version de plus : le retrait doit aussi partir.
      expect(manifest?.version).toBe(3);
    }
  });

  it("borne la validité pour qu'un écran rallumé tard l'ignore", async () => {
    const { app, store, auth, screens } = await withScreens();
    await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/emergency`, headers: auth,
      payload: { title: "Évacuation", validHours: 2 },
    });

    const manifest = await store.getManifest(screens[0]!.id);
    const window = Date.parse(manifest!.emergency!.validUntil) - Date.parse(manifest!.emergency!.issuedAt);
    expect(window).toBe(2 * 3_600_000);
  });

  it("dit s'il y a une urgence en cours", async () => {
    const { app, auth } = await withScreens();
    expect((await app.inject({ method: "GET", url: `${CONSOLE_PREFIX}/emergency`, headers: auth })).json())
      .toEqual({ emergency: null });

    await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/emergency`, headers: auth, payload: { title: "Alerte" },
    });

    const current = await app.inject({ method: "GET", url: `${CONSOLE_PREFIX}/emergency`, headers: auth });
    expect(current.json().emergency).toMatchObject({ title: "Alerte" });
  });
});

describe("parcours de la console", () => {
  async function ready() {
    const store = new MemoryStore();
    const app = buildApp({ store, media, consoleToken: TOKEN });
    const auth = { authorization: `Bearer ${TOKEN}` };
    return { app, store, auth };
  }

  it("montre les boîtiers en attente de rattachement", async () => {
    // C'est ce qui évite de recopier un code à la main depuis le couloir.
    const { app, store, auth } = await ready();
    const device = await store.startEnrollment("x".repeat(44), { platform: "linux" } as never);

    const response = await app.inject({ method: "GET", url: `${CONSOLE_PREFIX}/screens`, headers: auth });
    expect(response.json().pending).toEqual([
      expect.objectContaining({ deviceId: device.deviceId, pairingCode: device.pairingCode }),
    ]);
  });

  it("rattache un écran puis le publie", async () => {
    const { app, store, auth } = await ready();
    const device = await store.startEnrollment("x".repeat(44), { platform: "linux" } as never);

    const paired = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/pair`,
      headers: auth,
      payload: {
        pairingCode: device.pairingCode,
        code: "A·1·12",
        label: "Hall central",
        building: "A",
        floor: 1,
        area: "hall",
      },
    });
    expect(paired.statusCode).toBe(200);
    const screenId = paired.json().screenId as string;

    const published = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/screens/${screenId}/publish`,
      headers: auth,
      payload: {
        layout: "plein-ecran",
        items: [{ assetId: poster.id, durationMs: 10_000 }],
        ticker: "Portes ouvertes le 12 septembre",
      },
    });

    expect(published.statusCode).toBe(200);
    expect(published.json().version).toBe(1);
    expect(findBrokenReferences((await store.getManifest(screenId))!)).toEqual([]);
  });

  it("incrémente la version à chaque publication", async () => {
    // Le player ignore une version qui n'augmente pas : sans ça, une
    // republication ne partirait jamais sur l'écran.
    const { app, store, auth } = await ready();
    const device = await store.startEnrollment("x".repeat(44), { platform: "linux" } as never);
    const { screen } = await store.claimNew(device.deviceId, {
      code: "B·0·03",
      label: "CDI",
      building: "B",
      floor: 0,
      area: "cdi",
      orientation: "landscape",
    });

    const publish = () =>
      app.inject({
        method: "POST",
        url: `${CONSOLE_PREFIX}/screens/${screen.id}/publish`,
        headers: auth,
        payload: { layout: "plein-ecran", items: [{ assetId: poster.id }] },
      });

    expect((await publish()).json().version).toBe(1);
    expect((await publish()).json().version).toBe(2);
  });

  it("rend une erreur de composition en français, pas un 500", async () => {
    const { app, store, auth } = await ready();
    const device = await store.startEnrollment("x".repeat(44), { platform: "linux" } as never);
    const { screen } = await store.claimNew(device.deviceId, {
      code: "C·2·07",
      label: "Profs",
      building: "C",
      floor: 2,
      area: "salle",
      orientation: "landscape",
    });

    const response = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/screens/${screen.id}/publish`,
      headers: auth,
      payload: { layout: "plein-ecran", items: [{ assetId: "fantome" }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/n'existe plus dans la bibliothèque/);
  });

  it("liste la bibliothèque avec les noms d'origine", async () => {
    const { app, auth } = await ready();
    const response = await app.inject({ method: "GET", url: `${CONSOLE_PREFIX}/media`, headers: auth });

    expect(response.json().media).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: poster.id, filename: "portes-ouvertes.jpg" }),
        expect.objectContaining({ id: video.id, filename: "visite.mp4" }),
      ]),
    );
  });

  it("inscrit l'adresse configurée dans les médias, pas celle de l'éditeur", async () => {
    // Constaté sur une VM : l'URL venait de l'en-tête Host de la personne
    // qui publie. Publier depuis localhost produisait des adresses que les
    // écrans ne savaient pas joindre.
    const store = new MemoryStore();
    const app = buildApp({
      store,
      media,
      consoleToken: TOKEN,
      publicUrl: "https://couloir.ecole.fr",
    });
    const auth = { authorization: `Bearer ${TOKEN}` };

    const device = await store.startEnrollment("x".repeat(44), { platform: "linux" } as never);
    const { screen } = await store.claimNew(device.deviceId, {
      code: "D·1·01",
      label: "Préau",
      building: "D",
      floor: 1,
      area: "préau",
      orientation: "landscape",
    });

    await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/screens/${screen.id}/publish`,
      headers: { ...auth, host: "console-interne.local:3000" },
      payload: { layout: "plein-ecran", items: [{ assetId: poster.id }] },
    });

    const manifest = await store.getManifest(screen.id);
    expect(manifest!.assets[0]!.url).toBe(`https://couloir.ecole.fr/v1/assets/${poster.id}`);
  });

  it("compose un aperçu sans rien enregistrer", async () => {
    // L'aperçu doit être fidèle SANS effet de bord : le regarder ne doit
    // pas partir sur les écrans.
    const { app, store, auth } = await ready();
    const device = await store.startEnrollment("x".repeat(44), { platform: "linux" } as never);
    const { screen } = await store.claimNew(device.deviceId, {
      code: "E·0·01", label: "Préau", building: "E", floor: 0, area: "préau", orientation: "landscape",
    });

    const response = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/screens/${screen.id}/preview`,
      headers: auth,
      payload: { layout: "plein-ecran", items: [{ assetId: poster.id }] },
    });

    expect(response.statusCode).toBe(200);
    expect(findBrokenReferences(response.json().manifest)).toEqual([]);
    // Rien n'a été publié.
    expect(await store.getManifest(screen.id)).toBeNull();
  });

  it("l'aperçu et la publication produisent le même écran", async () => {
    // Deux chemins distincts finiraient par diverger, et l'aperçu se
    // mettrait à mentir. Ils partagent donc le composeur.
    const { app, store, auth } = await ready();
    const device = await store.startEnrollment("x".repeat(44), { platform: "linux" } as never);
    const { screen } = await store.claimNew(device.deviceId, {
      code: "E·0·02", label: "Couloir", building: "E", floor: 0, area: "couloir", orientation: "landscape",
    });
    const spec = { layout: "plein-ecran", items: [{ assetId: poster.id }], ticker: "Bonjour" };

    const preview = await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/screens/${screen.id}/preview`, headers: auth, payload: spec,
    });
    await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/screens/${screen.id}/publish`, headers: auth, payload: spec,
    });

    const published = await store.getManifest(screen.id);
    const comparable = (m: Record<string, unknown>) => ({ ...m, version: 0, issuedAt: "" });
    expect(comparable(preview.json().manifest)).toEqual(comparable(published as never));
  });

  it("refuse de publier sur un écran inconnu", async () => {
    const { app, auth } = await ready();
    const response = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/screens/inexistant/publish`,
      headers: auth,
      payload: { layout: "plein-ecran", items: [{ assetId: poster.id }] },
    });

    expect(response.statusCode).toBe(404);
  });
});
