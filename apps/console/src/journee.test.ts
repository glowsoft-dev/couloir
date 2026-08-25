import { describe, expect, it } from "vitest";
import { disposerLesBlocs, enFrancais, finDeJournee } from "./journee.js";

describe("disposerLesBlocs", () => {
  it("laisse toute la largeur à une plage seule", () => {
    expect(disposerLesBlocs([{ debut: 480, fin: 600 }])).toEqual([{ colonne: 0, colonnes: 1 }]);
  });

  it("garde une colonne pour des plages qui se suivent", () => {
    // Deux affiches à la file ne se cachent pas : rien à partager.
    expect(
      disposerLesBlocs([
        { debut: 480, fin: 600 },
        { debut: 600, fin: 720 },
      ]),
    ).toEqual([
      { colonne: 0, colonnes: 1 },
      { colonne: 0, colonnes: 1 },
    ]);
  });

  it("partage la largeur entre deux plages qui se croisent", () => {
    const p = disposerLesBlocs([
      { debut: 480, fin: 1110 },
      { debut: 690, fin: 840 },
    ]);
    expect(p).toEqual([
      { colonne: 0, colonnes: 2 },
      { colonne: 1, colonnes: 2 },
    ]);
  });

  it("compte les colonnes par grappe, pas sur toute la journée", () => {
    // Deux le matin, deux l'après-midi, sans recouvrement entre les paires :
    // deux colonnes partout, et non quatre.
    const p = disposerLesBlocs([
      { debut: 480, fin: 600 },
      { debut: 540, fin: 660 },
      { debut: 840, fin: 960 },
      { debut: 900, fin: 1020 },
    ]);
    expect(p.map((x) => x.colonnes)).toEqual([2, 2, 2, 2]);
    expect(p.map((x) => x.colonne)).toEqual([0, 1, 0, 1]);
  });

  it("rend les placements dans l'ordre reçu, pas dans l'ordre horaire", () => {
    const p = disposerLesBlocs([
      { debut: 690, fin: 840 },
      { debut: 480, fin: 1110 },
    ]);
    expect(p[0]).toEqual({ colonne: 1, colonnes: 2 });
    expect(p[1]).toEqual({ colonne: 0, colonnes: 2 });
  });

  it("empile trois plages simultanées sur trois colonnes", () => {
    const p = disposerLesBlocs([
      { debut: 480, fin: 720 },
      { debut: 500, fin: 700 },
      { debut: 520, fin: 690 },
    ]);
    expect(p.map((x) => x.colonne)).toEqual([0, 1, 2]);
    expect(p.map((x) => x.colonnes)).toEqual([3, 3, 3]);
  });
});

describe("enFrancais", () => {
  it("dit l'heure comme on la prononce", () => {
    expect(enFrancais(19 * 60)).toBe("19 h");
    expect(enFrancais(18 * 60 + 30)).toBe("18 h 30");
    expect(enFrancais(8 * 60 + 5)).toBe("8 h 05");
  });
});

describe("finDeJournee", () => {
  it("se tait quand rien n'est programmé", () => {
    // Une autre phrase le dit déjà ; deux messages identiques finissent par
    // se contredire.
    expect(finDeJournee({ fins: [], relais: { quoi: "rien" } })).toBeNull();
  });

  it("dit ce qui prend la main après le dernier contenu", () => {
    expect(finDeJournee({ fins: [600, 1110], relais: { quoi: "emploiDuTemps" } })).toBe(
      "Après 18 h 30, rien n'est programmé : l'écran affiche les salles du jour.",
    );
  });

  it("nomme le média de repli", () => {
    expect(finDeJournee({ fins: [1080], relais: { quoi: "media", nom: "accueil.png" } })).toContain(
      "l'écran affiche accueil.png",
    );
  });

  it("ajoute l'extinction quand elle suit", () => {
    expect(
      finDeJournee({
        fins: [1110],
        relais: { quoi: "emploiDuTemps" },
        extinctions: [{ daysOfWeek: [1, 2, 3, 4, 5], from: "19:00", to: "07:30" }],
      }),
    ).toBe(
      "Après 18 h 30, rien n'est programmé : l'écran affiche les salles du jour, puis la dalle s'éteint à 19 h.",
    );
  });

  it("ignore une extinction déjà passée", () => {
    // Une dalle éteinte à 12 h ne dit rien de ce qui suit 18 h 30.
    expect(
      finDeJournee({
        fins: [1110],
        relais: { quoi: "rien" },
        extinctions: [{ daysOfWeek: [1, 2, 3, 4, 5], from: "12:00", to: "13:00" }],
      }),
    ).toBe("Après 18 h 30, rien n'est programmé : l'écran n'a plus rien à montrer.");
  });

  it("ignore une extinction qui ne vaut que le week-end", () => {
    expect(
      finDeJournee({
        fins: [1080],
        relais: { quoi: "permanents" },
        extinctions: [{ daysOfWeek: [6, 7], from: "19:00", to: "07:30" }],
      }),
    ).toBe("Après 18 h, rien n'est programmé : les contenus sans horaire continuent de tourner.");
  });

  it("retient la première extinction qui suit", () => {
    expect(
      finDeJournee({
        fins: [1080],
        relais: { quoi: "rien" },
        extinctions: [
          { daysOfWeek: [1, 2, 3, 4, 5], from: "21:00", to: "07:30" },
          { daysOfWeek: [1, 2, 3, 4, 5], from: "19:00", to: "20:00" },
        ],
      }),
    ).toContain("s'éteint à 19 h.");
  });
});
