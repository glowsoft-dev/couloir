import { describe, expect, it } from "vitest";
import { journalDeResolution } from "./resolution.js";

const PLEIN = {
  largeurPx: 1920,
  hauteurPx: 1080,
  largeurDallePx: 1920,
  hauteurDallePx: 1080,
  densite: 1,
  pleinEcran: true,
};

describe("journalDeResolution", () => {
  it("signale le kiosque resté en fenêtre", () => {
    const journal = journalDeResolution({
      ...PLEIN,
      largeurPx: 945,
      pleinEcran: false,
    });
    expect(journal.level).toBe("warn");
    // Les deux tailles dans le message : sans elles on saurait qu'il y a un
    // problème sans savoir s'il manque une barre ou la moitié de l'écran.
    expect(journal.message).toContain("945×1080");
    expect(journal.message).toContain("1920×1080");
  });

  it("reste au niveau information quand tout va bien", () => {
    expect(journalDeResolution(PLEIN).level).toBe("info");
  });

  it("mentionne la densité d'une dalle haute définition", () => {
    // Sans ça, la console annoncerait du 1080p sur une 4K.
    expect(journalDeResolution({ ...PLEIN, densite: 2 }).message).toContain("densité 2");
  });

  it("dit « inconnue » plutôt que d'inventer une dalle", () => {
    const journal = journalDeResolution({
      ...PLEIN,
      largeurDallePx: 0,
      hauteurDallePx: 0,
      pleinEcran: false,
    });
    expect(journal.message).toContain("inconnue");
  });

  it("emporte la mesure complète dans le contexte", () => {
    expect(journalDeResolution(PLEIN).context).toMatchObject({ hauteurDallePx: 1080 });
  });
});
