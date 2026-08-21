import { describe, expect, it } from "vitest";
import { demoManifest } from "@couloir/protocol";
import { type RotationState, collapseEmptyZones, direct } from "./director.js";
import type { SourceSnapshot } from "./staleness.js";

/** Un mardi de septembre, 10 h 30 heure de Paris. */
const NOW = Date.parse("2026-09-15T08:30:00Z");
const MANIFEST = demoManifest("ecran-demo");

function sources(timetableAgeMs = 60_000, newsAgeMs = 60_000): Map<string, SourceSnapshot> {
  return new Map([
    ["edt", { fetchedAtMs: NOW - timetableAgeMs, payload: [{ time: "08:00" }] }],
    ["actus-site", { fetchedAtMs: NOW - newsAgeMs, payload: [{ title: "Portes ouvertes" }] }],
  ]);
}

function run(overrides: Partial<Parameters<typeof direct>[0]> = {}) {
  return direct({
    manifest: MANIFEST,
    nowMs: NOW,
    sources: sources(),
    availableAssetIds: new Set(["affiche-po-2026"]),
    rotations: new Map<string, RotationState>(),
    screenCode: "A·1·12",
    ...overrides,
  });
}

describe("mise en page", () => {
  it("remplit les trois zones quand tout va bien", () => {
    const { screen } = run();

    expect(screen.mode).toBe("normal");
    expect(screen.zones.map((z) => z.zoneId)).toEqual(["principal", "cours", "bandeau"]);
    expect(screen.zones.every((z) => z.slide !== null)).toBe(true);
  });

  it("affiche le code de l'écran en filigrane", () => {
    expect(run().screen.watermark).toBe("A·1·12");
  });

  it("fait tourner chaque zone indépendamment", () => {
    let output = run();
    const first = output.screen.zones.find((z) => z.zoneId === "principal")!.slide!.slideId;

    // La zone principale change au bout de 14 s, la colonne cours tient 20 s.
    output = direct({
      manifest: MANIFEST,
      nowMs: NOW + 15_000,
      sources: sources(),
      availableAssetIds: new Set(["affiche-po-2026"]),
      rotations: output.rotations,
    });

    expect(output.screen.zones.find((z) => z.zoneId === "principal")!.slide!.slideId).not.toBe(first);
    expect(output.screen.zones.find((z) => z.zoneId === "cours")!.slide!.slideId).toBe("cours-du-jour");
  });
});

describe("données périmées", () => {
  it("retire l'emploi du temps au-delà de sa durée de validité", () => {
    // La source « edt » a une politique `hide` et 4 h de tolérance : passé ce
    // délai, mieux vaut ne rien montrer qu'un emploi du temps faux.
    const { screen } = run({ sources: sources(5 * 3_600_000) });

    expect(screen.zones.some((z) => z.zoneId === "cours")).toBe(false);
  });

  it("étire les zones restantes sur la place libérée", () => {
    const { screen } = run({ sources: sources(5 * 3_600_000) });
    const principal = screen.zones.find((z) => z.zoneId === "principal")!;

    // La zone principale occupait 66 % ; elle récupère toute la bande.
    expect(principal.rect.widthPercent).toBeCloseTo(100, 5);
  });

  it("garde les actualités en affichant leur date", () => {
    // Politique `keep-with-date` : on le dit franchement plutôt que de
    // laisser croire que c'est frais.
    const { screen } = run({ sources: sources(60_000, 8 * 86_400_000) });
    const slide = screen.zones.find((z) => z.zoneId === "principal")!.slide!;

    expect(slide.kind).toBe("data");
    if (slide.kind !== "data") return;
    expect(slide.staleLabel).toMatch(/^Mis à jour /);
  });
});

describe("médias absents du cache", () => {
  it("saute une affiche pas encore téléchargée sans bloquer la rotation", () => {
    const { screen } = run({ availableAssetIds: new Set() });
    const principal = screen.zones.find((z) => z.zoneId === "principal")!;

    expect(principal.slide).not.toBeNull();
    expect(principal.slide!.slideId).not.toBe("affiche-portes-ouvertes");
  });
});

describe("modes exclusifs", () => {
  it("l'urgence prend tout l'écran et efface les zones", () => {
    const manifest = {
      ...MANIFEST,
      emergency: {
        id: "evac",
        title: "Évacuation immédiate",
        issuedAt: "2026-09-15T08:00:00Z",
        validUntil: "2026-09-15T12:00:00Z",
      },
    };
    const { screen } = run({ manifest });

    expect(screen.mode).toBe("emergency");
    expect(screen.zones).toEqual([]);
    expect(screen.emergency?.title).toBe("Évacuation immédiate");
  });

  it("ignore une urgence dont la fenêtre est passée", () => {
    // Un écran rallumé trois jours plus tard ne doit pas afficher une alerte
    // incendie périmée.
    const manifest = {
      ...MANIFEST,
      emergency: {
        id: "vieux",
        title: "Alerte d'hier",
        issuedAt: "2026-09-12T08:00:00Z",
        validUntil: "2026-09-12T12:00:00Z",
      },
    };
    expect(run({ manifest }).screen.mode).toBe("normal");
  });

  it("l'urgence passe avant l'extinction programmée", () => {
    const manifest = {
      ...MANIFEST,
      settings: {
        ...MANIFEST.settings,
        displayOff: [{ daysOfWeek: [1, 2, 3, 4, 5, 6, 7], from: "00:00", to: "23:59" }],
      },
      emergency: {
        id: "evac",
        title: "Évacuation",
        issuedAt: "2026-09-15T08:00:00Z",
        validUntil: "2026-09-15T12:00:00Z",
      },
    };
    expect(run({ manifest }).screen.mode).toBe("emergency");
  });

  it("le repérage montre le code en plein écran", () => {
    const { screen } = run({
      identify: { screenCode: "A·1·12", label: "Hall central", ipAddress: "10.20.1.12" },
    });

    expect(screen.mode).toBe("identify");
    expect(screen.identify?.screenCode).toBe("A·1·12");
  });

  it("le repli occupe toute la dalle", () => {
    const { screen } = run({ forceFallback: true });

    expect(screen.mode).toBe("fallback");
    expect(screen.zones).toHaveLength(1);
    expect(screen.zones[0]!.rect).toEqual({
      xPercent: 0,
      yPercent: 0,
      widthPercent: 100,
      heightPercent: 100,
    });
    expect(screen.zones[0]!.slide!.slideId).toBe("repli-identite");
  });

  it("éteint la dalle pendant la plage programmée", () => {
    const manifest = {
      ...MANIFEST,
      settings: {
        ...MANIFEST.settings,
        displayOff: [{ daysOfWeek: [1, 2, 3, 4, 5, 6, 7], from: "00:00", to: "23:59" }],
      },
    };
    expect(run({ manifest }).screen.mode).toBe("display-off");
  });
});

describe("preuves de diffusion", () => {
  it("émet une transition à chaque changement de diapositive", () => {
    const first = run();
    expect(first.transitions).toHaveLength(3); // une par zone au démarrage

    const stable = direct({
      manifest: MANIFEST,
      nowMs: NOW + 1_000,
      sources: sources(),
      availableAssetIds: new Set(["affiche-po-2026"]),
      rotations: first.rotations,
    });
    expect(stable.transitions).toEqual([]);

    const advanced = direct({
      manifest: MANIFEST,
      nowMs: NOW + 15_000,
      sources: sources(),
      availableAssetIds: new Set(["affiche-po-2026"]),
      rotations: first.rotations,
    });
    const transition = advanced.transitions.find((t) => t.zoneId === "principal");
    expect(transition).toMatchObject({ fromSlideId: "actu-du-jour", toSlideId: "affiche-portes-ouvertes" });
  });
});

describe("repli des zones vides", () => {
  it("supprime une bande entièrement vide et étire les autres", () => {
    const zones = [
      { zoneId: "haut", rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 50 }, playlistId: "a", slide: null },
      {
        zoneId: "bas",
        rect: { xPercent: 0, yPercent: 50, widthPercent: 100, heightPercent: 50 },
        playlistId: "b",
        slide: { kind: "widget" as const, slideId: "s", widget: "ticker", config: {} },
      },
    ];

    const result = collapseEmptyZones(zones);
    expect(result).toHaveLength(1);
    expect(result[0]!.rect).toMatchObject({ yPercent: 0, heightPercent: 100 });
  });

  it("renvoie une liste vide si plus rien n'est diffusable", () => {
    expect(collapseEmptyZones([])).toEqual([]);
  });
});
