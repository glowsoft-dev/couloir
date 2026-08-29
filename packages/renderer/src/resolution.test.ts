import { describe, expect, it } from "vitest";
import {
  facteurDeZoom,
  lireResolution,
  resolutionChangee,
  ZOOM_MAXIMUM,
  ZOOM_MINIMUM,
} from "./resolution.js";

const DALLE_1080 = { largeur: 1920, hauteur: 1080, densite: 1 };

describe("lireResolution", () => {
  it("reconnaît une fenêtre qui couvre la dalle", () => {
    expect(lireResolution(1920, 1080, DALLE_1080).pleinEcran).toBe(true);
  });

  it("repère le kiosque lancé en fenêtre", () => {
    // Le cas réel : Chromium ouvert en 945 de large sur une dalle de 1920,
    // le contenu entouré de noir. Tout marchait, et rien ne le disait.
    expect(lireResolution(945, 1080, DALLE_1080).pleinEcran).toBe(false);
  });

  it("tolère les quelques pixels d'une barre système", () => {
    expect(lireResolution(1920, 1040, DALLE_1080).pleinEcran).toBe(true);
  });

  it("ne crie pas à l'anomalie quand la dalle est inconnue", () => {
    // Un WebView qui ne renseigne pas `screen` ne doit pas faire douter
    // d'un écran qui fonctionne.
    const r = lireResolution(1280, 720, { largeur: 0, hauteur: 0, densite: 0 });
    expect(r.pleinEcran).toBe(true);
    expect(r.densite).toBe(1);
  });

  it("retient la densité, qui distingue une 4K d'une 1080p", () => {
    const r = lireResolution(1920, 1080, { largeur: 1920, hauteur: 1080, densite: 2 });
    expect(r.densite).toBe(2);
  });
});

describe("facteurDeZoom", () => {
  it("vaut un par défaut", () => {
    expect(facteurDeZoom(undefined)).toBe(1);
    expect(facteurDeZoom(null)).toBe(1);
  });

  it("laisse passer un réglage raisonnable", () => {
    expect(facteurDeZoom(1.4)).toBe(1.4);
  });

  it("ramène un réglage aberrant dans les bornes plutôt que de refuser", () => {
    // Un écran ne doit jamais s'éteindre à cause d'un chiffre mal saisi.
    expect(facteurDeZoom(12)).toBe(ZOOM_MAXIMUM);
    expect(facteurDeZoom(0.05)).toBe(ZOOM_MINIMUM);
    expect(facteurDeZoom(Number.NaN)).toBe(1);
  });
});

describe("resolutionChangee", () => {
  it("est vraie au premier relevé", () => {
    expect(resolutionChangee(null, lireResolution(1920, 1080, DALLE_1080))).toBe(true);
  });

  it("est fausse quand rien ne bouge", () => {
    const a = lireResolution(1920, 1080, DALLE_1080);
    expect(resolutionChangee(a, lireResolution(1920, 1080, DALLE_1080))).toBe(false);
  });

  it("est vraie quand le kiosque perd le plein écran", () => {
    const avant = lireResolution(1920, 1080, DALLE_1080);
    expect(resolutionChangee(avant, lireResolution(945, 1080, DALLE_1080))).toBe(true);
  });
});
