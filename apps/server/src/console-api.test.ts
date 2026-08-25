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

  it("laisse l'éditeur rouvrir la composition après coup", async () => {
    // Poser puis lever une urgence crée deux versions de plus. Sans report de
    // la composition, l'éditeur s'ouvrait vide devant un écran qui diffuse.
    const { app, auth, screens } = await withScreens();

    await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/emergency`, headers: auth,
      payload: { title: "Évacuation immédiate" },
    });
    await app.inject({ method: "DELETE", url: `${CONSOLE_PREFIX}/emergency`, headers: auth });

    const composition = await app.inject({
      method: "GET", url: `${CONSOLE_PREFIX}/screens/${screens[0]!.id}/composition`, headers: auth,
    });
    expect(composition.json().spec?.items).toHaveLength(1);
  });

  it("survit à une publication faite pendant l'urgence", async () => {
    /*
     * Le cas qui coûte le plus cher.
     *
     * Le composeur ne connaît pas les urgences : il compose ce qu'on lui
     * donne. Publier pendant une évacuation produisait donc un manifeste sans
     * message, et un couloir sur six cessait de l'annoncer — sans que
     * personne l'ait demandé ni le voie.
     */
    const { app, store, auth, screens } = await withScreens();

    await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/emergency`, headers: auth,
      payload: { title: "Évacuation immédiate", body: "Parking nord." },
    });

    await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/screens/${screens[0]!.id}/publish`, headers: auth,
      payload: { layout: "plein-ecran", items: [{ assetId: poster.id }] },
    });

    const manifest = await store.getManifest(screens[0]!.id);
    expect(manifest?.emergency?.title).toBe("Évacuation immédiate");

    const état = await app.inject({ method: "GET", url: `${CONSOLE_PREFIX}/emergency`, headers: auth });
    expect(état.json().ecrans).toBe(2);
  });

  it("ne ressuscite pas une alerte périmée", async () => {
    // Un écran republié après la fin de validité ne doit pas remettre en
    // ligne une évacuation d'avant-hier.
    const { app, store, auth, screens } = await withScreens();

    await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/emergency`, headers: auth,
      payload: { title: "Confinement" },
    });

    const courant = (await store.getManifest(screens[0]!.id))!;
    await store.putManifest({
      ...courant,
      version: courant.version + 1,
      emergency: { ...courant.emergency!, validUntil: "2020-01-01T00:00:00Z" },
    });

    await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/screens/${screens[0]!.id}/publish`, headers: auth,
      payload: { layout: "plein-ecran", items: [{ assetId: poster.id }] },
    });

    expect((await store.getManifest(screens[0]!.id))?.emergency).toBeNull();
  });

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
    // Le compte d'écrans accompagne l'état : « urgence en cours » sans
    // chiffre laisserait croire que tout le parc l'affiche.
    expect((await app.inject({ method: "GET", url: `${CONSOLE_PREFIX}/emergency`, headers: auth })).json())
      .toEqual({ emergency: null, ecrans: 0, parc: 2 });

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

  it("rouvre la composition en ligne, au lieu d'un éditeur vide", async () => {
    // Un écran qui affiche déjà quelque chose se corrige ; il ne se
    // remplace pas à l'aveugle.
    const { app, store, auth } = await ready();
    const device = await store.startEnrollment("z".repeat(44), { platform: "linux" } as never);
    const { screen } = await store.claimNew(device.deviceId, {
      code: "E·0·04", label: "Cantine", building: "E", floor: 0, area: "hall", orientation: "landscape",
    });

    // Avant toute publication : rien à rouvrir, et on le dit sans mentir.
    const vide = await app.inject({
      method: "GET", url: `${CONSOLE_PREFIX}/screens/${screen.id}/composition`, headers: auth,
    });
    expect(vide.json()).toEqual({ version: null, spec: null });

    const spec = {
      layout: "plein-ecran",
      items: [{ assetId: poster.id, durationMs: 9000 }],
      ticker: "Portes ouvertes samedi",
      displayOff: [{ daysOfWeek: [1, 2, 3, 4, 5], from: "19:00", to: "07:30" }],
    };
    await app.inject({
      method: "POST", url: `${CONSOLE_PREFIX}/screens/${screen.id}/publish`, headers: auth, payload: spec,
    });

    const rouvert = await app.inject({
      method: "GET", url: `${CONSOLE_PREFIX}/screens/${screen.id}/composition`, headers: auth,
    });
    expect(rouvert.json().version).toBe(1);
    expect(rouvert.json().spec).toEqual(spec);
  });

  it("republie une version passée sans effacer l'historique", async () => {
    // Publier serait irréversible sans ça : on ne pourrait revenir en
    // arrière qu'en refaisant la composition de mémoire.
    const { app, store, auth } = await ready();
    const device = await store.startEnrollment("y".repeat(44), { platform: "linux" } as never);
    const { screen } = await store.claimNew(device.deviceId, {
      code: "E·0·03", label: "Hall", building: "E", floor: 0, area: "hall", orientation: "landscape",
    });
    const publish = (ticker: string) =>
      app.inject({
        method: "POST",
        url: `${CONSOLE_PREFIX}/screens/${screen.id}/publish`,
        headers: auth,
        payload: { layout: "plein-ecran", items: [{ assetId: poster.id }], ticker },
      });

    await publish("premier");
    await publish("second");
    expect((await store.getManifest(screen.id))?.version).toBe(2);

    const restore = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/screens/${screen.id}/history/1/restore`,
      headers: auth,
    });

    expect(restore.statusCode).toBe(200);
    // Une nouvelle version portant l'ancien contenu, pas une réécriture.
    const current = await store.getManifest(screen.id);
    expect(current?.version).toBe(3);
    expect(JSON.stringify(current)).toContain("premier");

    const history = await app.inject({
      method: "GET", url: `${CONSOLE_PREFIX}/screens/${screen.id}/history`, headers: auth,
    });
    expect(history.json().versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
  });

  it("porte les plages d'extinction jusque dans le manifeste", async () => {
    // Une dalle allumée toute la nuit s'use et consomme pour personne.
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [{ assetId: poster.id }],
      displayOff: [{ daysOfWeek: [1, 2, 3, 4, 5], from: "19:00", to: "07:00" }],
    } as never);

    expect(manifest.settings.displayOff).toEqual([
      { daysOfWeek: [1, 2, 3, 4, 5], from: "19:00", to: "07:00" },
    ]);
  });

  it("met une diapositive par actualité, toutes sur la même source", async () => {
    // Une seule source pour N diapositives : l'écran ne fait qu'un appel
    // réseau, et chaque article garde sa propre preuve de diffusion.
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [{ assetId: poster.id }],
      actualites: 3,
      actualitesUrl: "http://serveur.test/connectors/news",
    } as never);

    const actus = manifest.slides.filter((s) => s.kind === "data" && s.sourceId === "actus");
    expect(actus).toHaveLength(3);
    expect(actus.map((s) => (s as { params: Record<string, string> }).params["index"])).toEqual([
      "0",
      "1",
      "2",
    ]);
    expect(manifest.dataSources.filter((s) => s.id === "actus")).toHaveLength(1);

    // Elles tournent AVEC les affiches, pas dans un coin à part.
    const principale = manifest.playlists.find((p) => p.id === "principale");
    expect(principale?.slideIds).toEqual(
      expect.arrayContaining(["actualite-0", "actualite-1", "actualite-2"]),
    );
  });

  it("affiche une actualité périmée plutôt que de laisser un trou", async () => {
    // L'inverse du choix fait pour l'emploi du temps, et c'est délibéré :
    // un cours faux envoie quelqu'un dans la mauvaise salle, une vieille
    // actualité ne fait de mal à personne.
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [{ assetId: poster.id }],
      actualites: 1,
      actualitesUrl: "http://serveur.test/connectors/news",
    } as never);

    const source = manifest.dataSources.find((s) => s.id === "actus");
    expect(source?.stalePolicy).toBe("keep-with-date");
    expect(manifest.dataSources.find((s) => s.id === "edt")).toBeUndefined();
  });

  it("refuse les actualités sans adresse configurée", async () => {
    // Mieux vaut refuser franchement que produire un manifeste dont la
    // source pointe nulle part, et le découvrir sur un écran.
    expect(() =>
      composeWith({ layout: "plein-ecran", items: [{ assetId: poster.id }], actualites: 2 } as never),
    ).toThrow(CompositionError);
  });

  it("accepte un écran qui ne diffuse que les actualités", async () => {
    // C'est la configuration du hall d'accueil.
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [],
      actualites: 2,
      actualitesUrl: "http://serveur.test/connectors/news",
    } as never);
    expect(findBrokenReferences(manifest)).toEqual([]);
    expect(manifest.playlists.find((p) => p.id === "principale")?.slideIds).toHaveLength(2);
  });

  it("publie un écran d'actualités seules, par la vraie route", async () => {
    // Le test du composeur seul ne suffit pas : la validation du corps est
    // une couche de plus, et elle imposait un contenu minimum. Le défaut
    // n'est apparu qu'en publiant pour de vrai.
    const { app, store, auth } = await ready();
    const device = await store.startEnrollment("w".repeat(44), { platform: "linux" } as never);
    const { screen } = await store.claimNew(device.deviceId, {
      code: "E·0·05", label: "Accueil", building: "E", floor: 0, area: "hall", orientation: "landscape",
    });

    const réponse = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/screens/${screen.id}/publish`,
      headers: auth,
      payload: { layout: "plein-ecran", items: [], actualites: 3 },
    });

    expect(réponse.statusCode).toBe(200);
    const manifest = await store.getManifest(screen.id);
    expect(manifest?.slides.filter((s) => s.kind === "data")).toHaveLength(3);
  });

  it("refuse par la vraie route un écran sans rien du tout", async () => {
    const { app, store, auth } = await ready();
    const device = await store.startEnrollment("v".repeat(44), { platform: "linux" } as never);
    const { screen } = await store.claimNew(device.deviceId, {
      code: "E·0·06", label: "Vide", building: "E", floor: 0, area: "hall", orientation: "landscape",
    });

    const réponse = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/screens/${screen.id}/publish`,
      headers: auth,
      payload: { layout: "plein-ecran", items: [] },
    });

    expect(réponse.statusCode).toBe(400);
    expect(réponse.json().message).toContain("actualités");
  });

  it("porte la période d'une affiche jusqu'au manifeste", async () => {
    // C'est l'écran qui tranche, pas le serveur au moment de publier : un
    // boîtier coupé du réseau doit voir ses affiches arriver et repartir.
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [
        {
          assetId: poster.id,
          visibility: { startsAt: "2099-09-01T00:00:00Z", endsAt: "2099-09-16T00:00:00Z" },
        },
        { assetId: video.id },
      ],
    } as never);

    const [datée, permanente] = manifest.slides.filter((s) => s.id.startsWith("item-"));
    expect((datée as { visibility?: unknown }).visibility).toEqual({
      startsAt: "2099-09-01T00:00:00Z",
      endsAt: "2099-09-16T00:00:00Z",
    });
    expect((permanente as { visibility?: unknown }).visibility).toBeUndefined();
  });

  it("refuse une période déjà terminée", async () => {
    // On veut le savoir en publiant, pas en montant voir un écran qui n'a
    // jamais rien affiché.
    expect(() =>
      composeWith({
        layout: "plein-ecran",
        items: [{ assetId: poster.id, visibility: { endsAt: "2020-01-01T00:00:00Z" } }],
      } as never),
    ).toThrow(CompositionError);
  });

  it("refuse une fin antérieure au début", async () => {
    expect(() =>
      composeWith({
        layout: "plein-ecran",
        items: [
          {
            assetId: poster.id,
            visibility: { startsAt: "2099-09-15T00:00:00Z", endsAt: "2099-09-01T00:00:00Z" },
          },
        ],
      } as never),
    ).toThrow(CompositionError);
  });

  it("retire une période vide au lieu de l'inscrire", async () => {
    // Un objet vide dans le manifeste ferait croire à un réglage qui
    // n'existe pas, et « sept jours cochés » veut dire « tous les jours ».
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [{ assetId: poster.id, visibility: { daysOfWeek: [1, 2, 3, 4, 5, 6, 7] } }],
    } as never);
    expect((manifest.slides.find((s) => s.id === "item-1") as { visibility?: unknown }).visibility)
      .toBeUndefined();
  });

  it("monte une source par afficheur choisi, et les fait défiler", async () => {
    // C'est l'inverse des classes, qui partagent une source et se
    // départagent par un sélecteur : chaque afficheur a sa propre adresse,
    // il n'y a rien à partager.
    const manifest = composeWith({
      layout: "principal-et-cours",
      items: [{ assetId: poster.id }],
      timetableAfficheurs: [
        { id: "2", url: "http://serveur.test/connectors/netypareo/2", label: "Bâtiment A" },
        { id: "4", url: "http://serveur.test/connectors/netypareo/4", label: "Bâtiment C" },
      ],
    } as never);

    expect(manifest.dataSources.map((s) => s.id)).toEqual(["edt-2", "edt-4"]);
    expect(manifest.playlists.find((p) => p.id === "cours")?.slideIds).toEqual([
      "cours-2",
      "cours-4",
    ]);
    expect(findBrokenReferences(manifest)).toEqual([]);
  });

  it("retire la colonne dès qu'un afficheur ne répond plus, sans toucher au reste", async () => {
    // `hide` et non `keep-with-date` : un cours faux envoie quelqu'un dans
    // la mauvaise salle. C'est l'inverse du choix fait pour les actualités.
    const manifest = composeWith({
      layout: "principal-et-cours",
      items: [{ assetId: poster.id }],
      timetableAfficheurs: [
        { id: "3", url: "http://serveur.test/connectors/netypareo/3", label: "Bâtiment B" },
      ],
    } as never);

    expect(manifest.dataSources.find((s) => s.id === "edt-3")?.stalePolicy).toBe("hide");
  });

  it("compose un écran d'emploi du temps seul, sans zone principale", async () => {
    // La mise en page d'un hall où l'on cherche une salle. Le premier jet
    // laissait une programmation visant la zone principale supprimée — le
    // composeur, qui revalide sa propre sortie, l'a refusée.
    const manifest = composeWith({
      layout: "emploi-du-temps",
      items: [],
      timetableAfficheurs: [
        { id: "1", url: "http://serveur.test/connectors/netypareo/1", label: "Intégral" },
      ],
      ticker: "Cherchez votre salle",
    } as never);

    expect(findBrokenReferences(manifest)).toEqual([]);
    expect(manifest.layout.id).toBe("emploi-du-temps");
    expect(manifest.layout.zones.map((z) => z.id)).toEqual(["cours", "bandeau"]);
    expect(manifest.layout.zones[0]!.rect.widthPercent).toBe(100);
    expect(manifest.schedules.some((s) => s.zoneId === "principal")).toBe(false);
  });

  it("laisse l'image entière par défaut, et la fait remplir sur demande", async () => {
    // Rogner ferait disparaître un titre sans prévenir : c'est le défaut le
    // plus coûteux, parce que personne ne s'en aperçoit avant de passer
    // devant l'écran.
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [{ assetId: poster.id }, { assetId: video.id, fit: "remplir" }],
    } as never);

    const [entiere, remplit] = manifest.slides.filter((s) => s.kind === "media");
    expect((entiere as { fit?: string }).fit).toBeUndefined();
    expect((remplit as { fit?: string }).fit).toBe("remplir");
  });

  it("joue le contenu par défaut quand rien n'est programmé", async () => {
    // Distinct du repli : celui-ci dit « j'ai perdu le contact », le défaut
    // dit « personne n'a rien prévu à cette heure-ci ».
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [{ assetId: poster.id, visibility: { dailyStart: "10:00", dailyEnd: "11:00" } }],
      parDefaut: { assetId: video.id },
    } as never);

    expect(manifest.defaultPlaylistId).toBe("defaut");
    expect(manifest.playlists.find((p) => p.id === "defaut")?.slideIds).toEqual(["defaut-media"]);
    // Le repli reste ce qu'il était : la carte d'identité de l'écran.
    expect(manifest.playlists.find((p) => p.id === "repli")?.slideIds).toEqual(["repli-identite"]);
    expect(findBrokenReferences(manifest)).toEqual([]);
  });

  it("ne donne aucune période au contenu par défaut", async () => {
    // Il ne serait pas un défaut s'il pouvait lui-même disparaître.
    const manifest = composeWith({
      layout: "plein-ecran",
      items: [{ assetId: poster.id }],
      parDefaut: { assetId: video.id },
    } as never);

    const defaut = manifest.slides.find((s) => s.id === "defaut-media");
    expect((defaut as { visibility?: unknown }).visibility).toBeUndefined();
  });

  it("accepte l'emploi du temps comme contenu par défaut, sans source en double", async () => {
    const manifest = composeWith({
      layout: "principal-et-cours",
      items: [{ assetId: poster.id }],
      parDefaut: { emploiDuTemps: true },
      timetableAfficheurs: [
        { id: "3", url: "http://serveur.test/connectors/netypareo/3", label: "Bâtiment B" },
      ],
    } as never);

    expect(manifest.playlists.find((p) => p.id === "defaut")?.slideIds).toEqual(["defaut-cours"]);
    // Une seule source : la diapositive du défaut réutilise celle de la colonne.
    expect(manifest.dataSources.filter((s) => s.id === "edt-3")).toHaveLength(1);
    expect(findBrokenReferences(manifest)).toEqual([]);
  });

  it("refuse un contenu par défaut disparu de la bibliothèque", async () => {
    expect(() =>
      composeWith({
        layout: "plein-ecran",
        items: [{ assetId: poster.id }],
        parDefaut: { assetId: "media-efface" },
      } as never),
    ).toThrow(CompositionError);
  });

  it("publie la même affiche sur plusieurs écrans d'un geste", async () => {
    const { app, store, auth } = await ready();
    const codes = ["F·0·01", "F·0·02", "F·0·03"];
    const ids: string[] = [];
    for (const [i, code] of codes.entries()) {
      const device = await store.startEnrollment(String(i).repeat(44), { platform: "linux" } as never);
      const { screen } = await store.claimNew(device.deviceId, {
        code, label: code, building: "F", floor: 0, area: "couloir", orientation: "landscape",
      });
      ids.push(screen.id);
    }

    const réponse = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/publications`,
      headers: auth,
      payload: {
        screenIds: ids,
        spec: { layout: "plein-ecran", items: [{ assetId: poster.id }], ticker: "Portes ouvertes" },
      },
    });

    expect(réponse.statusCode).toBe(200);
    const { resultats } = réponse.json();
    expect(resultats).toHaveLength(3);
    expect(resultats.every((r: { version?: number }) => r.version === 1)).toBe(true);
    for (const id of ids) {
      expect(JSON.stringify(await store.getManifest(id))).toContain("Portes ouvertes");
    }
  });

  it("garde à chaque écran ses propres réglages", async () => {
    // Une même affiche part sur plusieurs couloirs, mais chacun garde sa
    // mise en page. Les écraser reviendrait à reconfigurer des écrans pour
    // publier une image — et personne ne s'en apercevrait avant de passer
    // devant.
    const { app, store, auth } = await ready();
    const device = await store.startEnrollment("g".repeat(44), { platform: "linux" } as never);
    const { screen } = await store.claimNew(device.deviceId, {
      code: "G·0·01", label: "Hall", building: "G", floor: 0, area: "hall", orientation: "landscape",
    });

    // L'écran a d'abord ses propres réglages : extinction le soir.
    await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/screens/${screen.id}/publish`,
      headers: auth,
      payload: {
        layout: "plein-ecran",
        items: [{ assetId: poster.id }],
        displayOff: [{ daysOfWeek: [1, 2, 3, 4, 5], from: "19:00", to: "07:30" }],
      },
    });

    // Puis une publication groupée qui n'en parle pas.
    await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/publications`,
      headers: auth,
      payload: {
        screenIds: [screen.id],
        spec: { layout: "plein-ecran", items: [{ assetId: video.id }] },
      },
    });

    const manifest = await store.getManifest(screen.id);
    expect(manifest?.settings.displayOff).toEqual([
      { daysOfWeek: [1, 2, 3, 4, 5], from: "19:00", to: "07:30" },
    ]);
  });

  it("publie sur les écrans qui acceptent, et dit lesquels refusent", async () => {
    // Tout annuler pour un seul écran en défaut serait pire : on publie ce
    // qu'on peut, et on rend le détail.
    const { app, store, auth } = await ready();
    const device = await store.startEnrollment("h".repeat(44), { platform: "linux" } as never);
    const { screen } = await store.claimNew(device.deviceId, {
      code: "H·0·01", label: "Hall", building: "H", floor: 0, area: "hall", orientation: "landscape",
    });

    const réponse = await app.inject({
      method: "POST",
      url: `${CONSOLE_PREFIX}/publications`,
      headers: auth,
      payload: {
        screenIds: [screen.id, "ecran-qui-nexiste-pas"],
        spec: { layout: "plein-ecran", items: [{ assetId: poster.id }] },
      },
    });

    const { resultats } = réponse.json();
    expect(resultats[0].version).toBe(1);
    expect(resultats[1].erreur).toBe("Écran inconnu.");
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
