import { describe, expect, it } from "vitest";
import { ressembleÀUnNom, séancesNominatives } from "./nomsDePersonnes.js";

/*
 * Les chaînes ci-dessous sont celles que l'afficheur du campus a réellement
 * servies. C'est le seul jeu d'essai qui vaille pour une heuristique : elle
 * n'a pas à être élégante, elle a à trier CES intitulés-là.
 */
const NOMS_REELS = ["Marc BERTAUD", "Naïma EL OUARDI", "Élodie CHASSAGNE", "Tom PRAT"];
const INTITULES_REELS = [
  "Attaché Commercial AC 2025-26",
  "BTS GESTION 2EME ANNE",
  "M2 Expert en architecture et développement logiciel",
];

describe("ressembleÀUnNom", () => {
  it.each(NOMS_REELS)("signale « %s »", (intitulé) => {
    expect(ressembleÀUnNom(intitulé)).toBe(true);
  });

  it.each(INTITULES_REELS)("laisse passer « %s »", (intitulé) => {
    expect(ressembleÀUnNom(intitulé)).toBe(false);
  });

  it("laisse passer un groupe sans majuscules ni chiffres", () => {
    expect(ressembleÀUnNom("Vente conseil")).toBe(false);
    expect(ressembleÀUnNom("Relation client")).toBe(false);
  });

  it("laisse passer une phrase entière", () => {
    // Au-delà de quatre mots, c'est un intitulé, pas un nom.
    expect(ressembleÀUnNom("Préparation à la certification professionnelle")).toBe(false);
  });

  it("signale un intitulé en capitales sans chiffre, et c'est assumé", () => {
    // Une alerte de trop se lit et se balaie ; l'erreur inverse laisserait le
    // nom d'un élève sur un mur de couloir.
    expect(ressembleÀUnNom("MECANIQUE AUTOMOBILE")).toBe(true);
  });

  it("ne signale rien sur un mot seul", () => {
    expect(ressembleÀUnNom("BERTAUD")).toBe(false);
    expect(ressembleÀUnNom("")).toBe(false);
  });
});

describe("séancesNominatives", () => {
  it("garde l'ordre d'affichage", () => {
    const journée = [
      { subject: "BTS GESTION 2EME ANNE" },
      { subject: "Marc BERTAUD" },
      { subject: "Attaché Commercial AC 2025-26" },
      { subject: "Élodie CHASSAGNE" },
    ];
    expect(séancesNominatives(journée).map((s) => s.subject)).toEqual([
      "Marc BERTAUD",
      "Élodie CHASSAGNE",
    ]);
  });
});
