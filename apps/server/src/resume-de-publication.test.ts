import { describe, expect, it } from "vitest";
import type { Manifest, Slide } from "@couloir/protocol";
import { resumeDePublication } from "./resume-de-publication.js";

/** Un manifeste où tout est composé, sauf ce que le repli contient. */
const manifeste = (slides: Slide[], repli: string[] = []): Manifest =>
  ({
    slides: [...slides, ...repli.map((id) => ({ kind: "template", id }) as unknown as Slide)],
    playlists: [
      { id: "principale", slideIds: slides.map((s) => s.id) },
      { id: "repli", slideIds: repli },
    ],
    fallbackPlaylistId: "repli",
  }) as unknown as Manifest;

const image = (id: string): Slide => ({ kind: "image", id, assetId: "a", durationMs: 1 }) as Slide;
const cours = (id: string): Slide =>
  ({ kind: "data", id, sourceId: "edt", view: "timetable-day", params: {}, durationMs: 1 }) as Slide;
const bandeau = (id: string): Slide =>
  ({ kind: "widget", id, widget: "ticker", params: {}, durationMs: 1 }) as Slide;

describe("resumeDePublication", () => {
  it("compte les contenus composés", () => {
    expect(resumeDePublication(manifeste([image("a"), image("b")]))).toBe("2 contenus");
    expect(resumeDePublication(manifeste([image("a")]))).toBe("1 contenu");
  });

  it("ne compte pas les colonnes de cours comme des contenus", () => {
    // Sinon « 5 contenus » désignerait deux affiches et trois classes.
    expect(
      resumeDePublication(manifeste([image("a"), image("b"), cours("c1"), cours("c2"), cours("c3")])),
    ).toBe("2 contenus, emploi du temps");
  });

  it("signale le bandeau sans le compter", () => {
    expect(resumeDePublication(manifeste([image("a"), bandeau("b")]))).toBe("1 contenu, bandeau");
  });

  it("dit qu'il n'y avait aucun contenu propre", () => {
    // Un écran d'emploi du temps seul : c'est un cas courant, pas une erreur.
    expect(resumeDePublication(manifeste([cours("c1")]))).toBe("aucun contenu, emploi du temps");
  });

  it("ne compte pas la carte d'identité du repli", () => {
    // Le composeur la pose lui-même ; la compter ferait dire « 2 contenus » à
    // une publication qui en porte un.
    expect(resumeDePublication(manifeste([image("a")], ["repli-identite"]))).toBe("1 contenu");
  });

  it("nomme les trois ensemble", () => {
    expect(resumeDePublication(manifeste([image("a"), cours("c1"), bandeau("b")]))).toBe(
      "1 contenu, emploi du temps, bandeau",
    );
  });
});
