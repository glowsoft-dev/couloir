import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ROUTES } from "@couloir/protocol";
import { buildApp } from "./app.js";
import { MediaStore, parseRange } from "./media.js";

/**
 * Le service des médias.
 *
 * Les requêtes `Range` ne sont pas un raffinement : sans elles, un
 * téléchargement de 400 Mo coupé à 90 % repart de zéro à chaque tentative,
 * et un écran en Wi-Fi capricieux ne finit jamais de se synchroniser.
 */

const POSTER = Buffer.alloc(10_000, 3);
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "couloir-media-test-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("analyse de l'en-tête Range", () => {
  it("accepte une plage complète", () => {
    expect(parseRange("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 });
  });

  it("accepte une plage ouverte — le cas de la reprise", () => {
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("accepte une plage depuis la fin", () => {
    expect(parseRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 });
  });

  it("borne une fin au-delà du fichier", () => {
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("rejette une plage qui commence après la fin", () => {
    expect(parseRange("bytes=2000-", 1000)).toBe("invalid");
  });

  it("rejette une syntaxe inconnue", () => {
    expect(parseRange("octets=0-10", 1000)).toBe("invalid");
    expect(parseRange("bytes=-", 1000)).toBe("invalid");
  });

  it("absence d'en-tête = fichier entier", () => {
    expect(parseRange(undefined, 1000)).toBeNull();
  });
});

describe("route de téléchargement", () => {
  async function appWithPoster() {
    const media = new MediaStore(directory);
    await media.load();
    const stored = await media.put("affiche", POSTER, "image/jpeg");
    return { app: buildApp({ media }), stored };
  }

  it("sert le fichier entier et annonce son empreinte", async () => {
    const { app, stored } = await appWithPoster();
    const response = await app.inject({ method: "GET", url: ROUTES.asset.replace(":assetId", "affiche") });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/jpeg");
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers["etag"]).toBe(`"${stored.sha256}"`);
    expect(response.rawPayload.byteLength).toBe(POSTER.byteLength);
  });

  it("reprend un téléchargement là où il s'était arrêté", async () => {
    const { app } = await appWithPoster();
    const response = await app.inject({
      method: "GET",
      url: ROUTES.asset.replace(":assetId", "affiche"),
      headers: { range: "bytes=9000-" },
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers["content-range"]).toBe("bytes 9000-9999/10000");
    expect(response.rawPayload.byteLength).toBe(1000);
  });

  it("répond 416 à une plage impossible", async () => {
    const { app } = await appWithPoster();
    const response = await app.inject({
      method: "GET",
      url: ROUTES.asset.replace(":assetId", "affiche"),
      headers: { range: "bytes=99999-" },
    });

    expect(response.statusCode).toBe(416);
    expect(response.headers["content-range"]).toBe("bytes */10000");
  });

  it("répond 404 pour un média inconnu", async () => {
    const { app } = await appWithPoster();
    const response = await app.inject({ method: "GET", url: ROUTES.asset.replace(":assetId", "fantome") });

    expect(response.statusCode).toBe(404);
    expect(response.json().retryable).toBe(false);
  });

  it("l'empreinte fait autorité et vient du serveur", async () => {
    // Le player la vérifie après téléchargement : elle ne peut donc pas
    // être fournie par celui qui téléverse.
    const media = new MediaStore(directory);
    await media.load();
    const stored = await media.put("affiche", POSTER, "image/jpeg");

    expect(stored.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.bytes).toBe(POSTER.byteLength);
  });
});
