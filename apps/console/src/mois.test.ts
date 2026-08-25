import { describe, expect, it } from "vitest";
import { enDate, grilleDuMois, nomDuMois, paraitLeJour } from "./mois.js";
import { débutDeJournée, finDeJournée } from "./Periode.js";

describe("paraitLeJour", () => {
  it("montre ce qui n'a pas de période", () => {
    expect(paraitLeJour(undefined, "2026-03-14")).toBe(true);
    expect(paraitLeJour({}, "2026-03-14")).toBe(true);
  });

  it("respecte les bornes de la période, dernier jour inclus", () => {
    // « du 10 au 15 » inclut le 15 en entier : c'est ce que quelqu'un écrit.
    const v = { startsAt: débutDeJournée("2026-03-10"), endsAt: finDeJournée("2026-03-15") };
    expect(paraitLeJour(v, "2026-03-09")).toBe(false);
    expect(paraitLeJour(v, "2026-03-10")).toBe(true);
    expect(paraitLeJour(v, "2026-03-15")).toBe(true);
    expect(paraitLeJour(v, "2026-03-16")).toBe(false);
  });

  it("respecte les jours de la semaine", () => {
    // Le 14 mars 2026 est un samedi, le 16 un lundi.
    const v = { daysOfWeek: [1, 2, 3, 4, 5] };
    expect(paraitLeJour(v, "2026-03-14")).toBe(false);
    expect(paraitLeJour(v, "2026-03-16")).toBe(true);
  });

  it("ignore les heures", () => {
    // Une affiche de 19:00 à 07:30 paraît bien ce jour-là : la faire
    // disparaître parce qu'on regarde à midi serait un mensonge.
    expect(paraitLeJour({ dailyStart: "19:00", dailyEnd: "07:30" }, "2026-03-16")).toBe(true);
  });
});

describe("grilleDuMois", () => {
  it("commence toujours un lundi et tient six semaines", () => {
    const grille = grilleDuMois(2026, 2); // mars 2026
    expect(grille).toHaveLength(42);
    expect(new Date(`${grille[0]!.date}T12:00:00`).getDay()).toBe(1);
  });

  it("marque les jours des mois voisins", () => {
    // Mars 2026 commence un dimanche : la première case est le lundi 23 février.
    const grille = grilleDuMois(2026, 2);
    expect(grille[0]).toEqual({ date: "2026-02-23", duMois: false });
    expect(grille.find((c) => c.date === "2026-03-01")?.duMois).toBe(true);
    expect(grille.filter((c) => c.duMois)).toHaveLength(31);
  });

  it("garde six semaines même pour un mois court", () => {
    // Une grille qui change de hauteur fait sauter tout ce qui est en dessous.
    expect(grilleDuMois(2026, 1)).toHaveLength(42);
  });
});

describe("enDate", () => {
  it("rend la date locale, pas l'UTC", () => {
    expect(enDate(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(enDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("nomDuMois", () => {
  it("écrit le mois avec une capitale", () => {
    expect(nomDuMois(2026, 8)).toBe("Septembre 2026");
  });
});
