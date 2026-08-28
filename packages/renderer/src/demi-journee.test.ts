import { describe, expect, it } from "vitest";
import { demiJourneeEnCours, minutesLocales, tailleDesLignes } from "./demi-journee.js";

const seance = (time: string) => ({ time, subject: `cours de ${time}`, room: "B 104" });

const JOURNEE = ["08:00", "09:00", "10:10", "11:10", "13:30", "14:30", "15:40"].map(seance);

describe("demiJourneeEnCours", () => {
  it("ne montre que le matin, le matin", () => {
    const vu = demiJourneeEnCours(JOURNEE, 9 * 60).map((e) => e.time);
    expect(vu).toEqual(["08:00", "09:00", "10:10", "11:10"]);
  });

  it("ne montre que l'après-midi, l'après-midi", () => {
    const vu = demiJourneeEnCours(JOURNEE, 14 * 60).map((e) => e.time);
    expect(vu).toEqual(["13:30", "14:30", "15:40"]);
  });

  it("bascule à treize heures", () => {
    expect(demiJourneeEnCours(JOURNEE, 12 * 60 + 59)[0]!.time).toBe("08:00");
    expect(demiJourneeEnCours(JOURNEE, 13 * 60)[0]!.time).toBe("13:30");
  });

  it("montre l'autre demi-journée quand celle en cours est vide", () => {
    // Un couloir à dix-huit heures doit dire ce qu'il y a le matin, pas rien.
    const matinSeul = ["08:00", "09:00"].map(seance);
    expect(demiJourneeEnCours(matinSeul, 16 * 60).map((e) => e.time)).toEqual(["08:00", "09:00"]);
  });

  it("rend la journée entière plutôt que rien", () => {
    const uneSeule = [seance("11:00")];
    expect(demiJourneeEnCours(uneSeule, 15 * 60)).toHaveLength(1);
  });

  it("ne rend rien quand il n'y a rien", () => {
    expect(demiJourneeEnCours([], 9 * 60)).toEqual([]);
  });
});

describe("tailleDesLignes", () => {
  it("agrandit quand il y a de la place", () => {
    // Quatre séances dans une colonne de mille pixels : il y a la place.
    expect(tailleDesLignes(1000, 4, 24)).toBeGreaterThan(24);
  });

  it("ne descend jamais sous la taille de base", () => {
    // En dessous, ça ne se lit plus à quatre mètres : mieux vaut déborder
    // que mentir sur la lisibilité.
    expect(tailleDesLignes(300, 20, 24)).toBe(24);
  });

  it("ne dépasse pas plus du double", () => {
    // Une seule séance en lettres géantes ressemble à une panne.
    expect(tailleDesLignes(2000, 1, 24)).toBeLessThanOrEqual(Math.round(24 * 2.2));
  });

  it("rend la base sans ligne à placer", () => {
    expect(tailleDesLignes(1000, 0, 24)).toBe(24);
  });
});

describe("minutesLocales", () => {
  it("lit l'heure dans le fuseau de l'établissement", () => {
    // Midi UTC, c'est quatorze heures à Paris en été.
    const midiUtc = Date.parse("2026-07-01T12:00:00Z");
    expect(minutesLocales(midiUtc, "Europe/Paris")).toBe(14 * 60);
  });
});
