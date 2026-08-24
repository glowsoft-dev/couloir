// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { ScreenState } from "../director.js";
import { mountRenderer } from "./mount.js";

/**
 * Tests de la couche DOM.
 *
 * Elle ne décide de rien, mais elle a sa propre classe de bugs : des nœuds
 * qu'on oublie de retirer. Les transitions entre modes plein écran et
 * affichage en zones sont le point sensible.
 */

// happy-dom ne fournit pas ResizeObserver ; le rendu ne s'en sert que pour
// recalculer l'échelle typographique.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver;

function zonesScreen(slideId = "actu"): ScreenState {
  return {
    mode: "normal",
    zones: [
      {
        zoneId: "principal",
        rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
        playlistId: "p",
        slide: { kind: "template", slideId, templateId: "t", fields: { titre: "Bonjour" } },
      },
    ],
    emergency: null,
    identify: null,
    watermark: "A·1·12",
  };
}

const emergencyScreen: ScreenState = {
  mode: "emergency",
  zones: [],
  emergency: {
    id: "evac",
    title: "Évacuation immédiate",
    body: "Rejoignez le parking nord.",
    issuedAt: "2026-09-15T08:00:00Z",
    validUntil: "2026-09-15T12:00:00Z",
  },
  identify: null,
  watermark: null,
};

const identifyScreen: ScreenState = {
  mode: "identify",
  zones: [],
  emergency: null,
  identify: { screenCode: "A·1·12", label: "Hall central", ipAddress: "10.20.1.12" },
  watermark: null,
};

let container: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("transitions entre modes", () => {
  it("affiche l'urgence en plein écran, sans zone résiduelle", () => {
    const renderer = mountRenderer(container);
    renderer.update(zonesScreen());
    expect(container.querySelectorAll("[data-zone]")).toHaveLength(1);

    renderer.update(emergencyScreen);
    expect(container.querySelectorAll("[data-zone]")).toHaveLength(0);
    expect(container.querySelector(".couloir-full--emergency")).not.toBeNull();
    expect(container.textContent).toContain("Évacuation immédiate");
    // Le corps du message dit où aller : il doit être là, pas seulement le titre.
    expect(container.textContent).toContain("parking nord");
  });

  it("retire le panneau plein écran en revenant aux zones", () => {
    // Régression : sans nettoyage, les zones se dessinaient PAR-DESSUS le
    // panneau précédent, et on lisait deux écrans superposés.
    const renderer = mountRenderer(container);
    renderer.update(identifyScreen);
    expect(container.querySelector(".couloir-full--identify")).not.toBeNull();

    renderer.update(zonesScreen());
    expect(container.querySelector(".couloir-full")).toBeNull();
    expect(container.querySelectorAll("[data-zone]")).toHaveLength(1);
  });

  it("enchaîne deux modes plein écran sans les empiler", () => {
    const renderer = mountRenderer(container);
    renderer.update(identifyScreen);
    renderer.update(emergencyScreen);

    expect(container.querySelectorAll(".couloir-full")).toHaveLength(1);
    expect(container.querySelector(".couloir-full--identify")).toBeNull();
  });
});

describe("économie de rendu", () => {
  it("ne recrée pas le nœud quand la diapositive n'a pas changé", () => {
    // Un Raspberry Pi qui refait tout son DOM chaque seconde chauffe pour rien.
    const renderer = mountRenderer(container);
    renderer.update(zonesScreen("actu"));
    const first = container.querySelector("[data-slide]");

    renderer.update(zonesScreen("actu"));
    expect(container.querySelector("[data-slide]")).toBe(first);

    renderer.update(zonesScreen("affiche"));
    expect(container.querySelector("[data-slide]")).not.toBe(first);
  });

  it("remplace le nœud quand un contenu change sous le même identifiant", () => {
    // Le composeur numérote les contenus — `item-1`, `item-2` — et réutilise
    // donc les mêmes noms d'une publication à l'autre. Remplacer une affiche
    // par un texte au même rang gardait l'ancienne image à l'écran jusqu'au
    // prochain rechargement de la page : ce qui n'arrive jamais sur un
    // boîtier posé dans un couloir.
    const renderer = mountRenderer(container);

    const avecImage: ScreenState = {
      ...zonesScreen(),
      zones: [
        {
          ...zonesScreen().zones[0]!,
          slide: {
            kind: "media",
            slideId: "item-1",
            asset: { id: "affiche", sha256: "x", bytes: 1, mime: "image/png", url: "/a" },
          },
        },
      ],
    };
    const avecTexte: ScreenState = {
      ...zonesScreen(),
      zones: [
        {
          ...zonesScreen().zones[0]!,
          slide: {
            kind: "template",
            slideId: "item-1",
            templateId: "annonce",
            fields: { titre: "Bienvenue" },
          },
        },
      ],
    };

    renderer.update(avecImage);
    expect(container.querySelector("img")).not.toBeNull();

    renderer.update(avecTexte);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Bienvenue");
  });

  it("redessine une diapositive de données quand sa charge change", () => {
    // Un écran qui n'affiche qu'une seule diapositive de données ne tourne
    // jamais : sans cette comparaison, il ne verrait jamais ses données
    // changer.
    const renderer = mountRenderer(container);
    const avec = (titre: string): ScreenState => ({
      ...zonesScreen(),
      zones: [
        {
          ...zonesScreen().zones[0]!,
          slide: {
            kind: "data",
            slideId: "actualite-0",
            sourceId: "actus",
            view: "news-single",
            params: { index: "0" },
            staleLabel: null,
            payload: { articles: [{ titre }] },
          },
        },
      ],
    });

    renderer.update(avec("Portes ouvertes"));
    expect(container.textContent).toContain("Portes ouvertes");

    renderer.update(avec("Conseil de classe"));
    expect(container.textContent).toContain("Conseil de classe");
    expect(container.textContent).not.toContain("Portes ouvertes");
  });

  it("retire une zone qui a disparu de la mise en page", () => {
    const renderer = mountRenderer(container);
    renderer.update(zonesScreen());
    renderer.update({ ...zonesScreen(), zones: [] });

    expect(container.querySelectorAll("[data-zone]")).toHaveLength(0);
  });
});

describe("filigrane", () => {
  it("affiche le code de l'écran, et le retire quand il est désactivé", () => {
    const renderer = mountRenderer(container);
    renderer.update(zonesScreen());
    expect(container.querySelector(".couloir-watermark")?.textContent).toBe("A·1·12");

    renderer.update({ ...zonesScreen(), watermark: null });
    expect(container.querySelector(".couloir-watermark")).toBeNull();
  });
});
