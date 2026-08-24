import { describe, expect, it } from "vitest";
import { demoManifest } from "@couloir/protocol";
import { type RotationState, direct } from "./director.js";
import type { SourceSnapshot } from "./staleness.js";

/**
 * L'emploi du temps affiché doit être celui d'aujourd'hui.
 *
 * La fraîcheur mesurée ne suffit pas. Quand le logiciel de l'école tombe, le
 * serveur ressert la dernière journée connue — avec un 200, donc l'écran la
 * croit fraîche. Une panne pendant la nuit afficherait le lendemain matin la
 * journée de la veille, présentée comme celle du jour.
 *
 * C'est le seul cas où l'écran doit préférer ne rien montrer : un cours faux
 * envoie quelqu'un dans la mauvaise salle, à la mauvaise heure.
 */

/** Mardi 15 septembre 2026, 10 h 30 à Paris. */
const MAINTENANT = Date.UTC(2026, 8, 15, 8, 30);

function écranAvec(dateDeLaJournée: string | undefined) {
  const base = demoManifest("ecran-demo");
  const journée = {
    classId: "edt-jour",
    classLabel: "Bâtiment B",
    ...(dateDeLaJournée ? { date: dateDeLaJournée } : {}),
    entries: [{ time: "08:30", endTime: "12:00", subject: "BTS Gestion", room: "B11" }],
  };

  return direct({
    manifest: base,
    nowMs: MAINTENANT,
    sources: new Map<string, SourceSnapshot>([
      // Récupérée à l'instant : la fraîcheur mesurée est irréprochable.
      ["edt", { fetchedAtMs: MAINTENANT - 30_000, payload: { days: [journée] } }],
      ["actus-site", { fetchedAtMs: MAINTENANT - 30_000, payload: [{ title: "Portes ouvertes" }] }],
    ]),
    availableAssetIds: new Set(["affiche-po-2026"]),
    rotations: new Map<string, RotationState>(),
    screenCode: "B·1·01",
  });
}

const colonneDesCours = (écran: ReturnType<typeof écranAvec>) =>
  écran.screen.zones.find((z) => z.zoneId === "cours") ?? null;

describe("quand rien n'est programmé", () => {
  it("joue le contenu par défaut plutôt que la carte d'identité", () => {
    // Le repli dit « j'ai perdu le contact » ; le défaut dit « personne n'a
    // rien prévu à cette heure-ci ». Confondre les deux ferait afficher une
    // carte d'identité là où l'école a choisi une affiche d'accueil.
    const base = demoManifest("ecran-demo");
    const manifest = {
      ...base,
      defaultPlaylistId: "defaut",
      playlists: [
        ...base.playlists,
        { id: "defaut", slideIds: ["defaut-accueil"] },
      ],
      slides: [
        ...base.slides.map((s) =>
          s.id === "repli-identite"
            ? s
            : { ...s, visibility: { startsAt: "2099-01-01T00:00:00Z" } },
        ),
        {
          kind: "template" as const,
          id: "defaut-accueil",
          templateId: "annonce",
          fields: { titre: "Bienvenue au campus" },
          assetIds: [],
          durationMs: 30_000,
        },
      ],
    };

    const { screen } = direct({
      manifest: manifest as never,
      nowMs: MAINTENANT,
      sources: new Map<string, SourceSnapshot>(),
      availableAssetIds: new Set(["affiche-po-2026"]),
      rotations: new Map<string, RotationState>(),
      screenCode: "A·1·12",
    });

    const diapo = screen.zones[0]?.slide;
    expect(diapo).not.toBeNull();
    expect(diapo && "fields" in diapo ? diapo.fields["titre"] : null).toBe("Bienvenue au campus");
  });
});

describe("la colonne des cours", () => {
  it("s'affiche quand la journée est celle du jour", () => {
    const zone = colonneDesCours(écranAvec("2026-09-15"));
    expect(zone?.slide).not.toBeNull();
  });

  it("se retire quand la journée est celle de la veille", () => {
    // Le cas d'une panne nocturne du logiciel de l'école.
    const écran = écranAvec("2026-09-14");
    const zone = colonneDesCours(écran);
    // Soit la zone a disparu, soit elle est vide : dans les deux cas, aucun
    // cours faux n'est présenté.
    expect(zone?.slide ?? null).toBeNull();
  });

  it("se retire quand la journée est celle de demain", () => {
    expect(colonneDesCours(écranAvec("2026-09-16"))?.slide ?? null).toBeNull();
  });

  it("laisse passer une source qui ne date pas ses journées", () => {
    // Toutes les sources ne sont pas des emplois du temps, et une absence de
    // date ne doit pas faire disparaître une colonne qui allait bien.
    expect(colonneDesCours(écranAvec(undefined))?.slide).not.toBeNull();
  });

  it("ne fait pas tomber le reste de l'écran", () => {
    // La colonne se retire, la zone principale reste — et s'étire.
    const écran = écranAvec("2026-09-14");
    expect(écran.screen.zones.some((z) => z.slide !== null)).toBe(true);
  });
});
