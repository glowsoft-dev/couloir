// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("retire la salle d'un cours annulé", () => {
    // Un cours annulé qui garde sa salle envoie quelqu'un devant une porte
    // fermée — c'est le trajet même que la mention « annulé » évite.
    const renderer = mountRenderer(container);
    renderer.update({
      ...zonesScreen(),
      zones: [
        {
          ...zonesScreen().zones[0]!,
          slide: {
            kind: "data",
            slideId: "cours",
            sourceId: "edt",
            view: "timetable-day",
            params: { affichage: "journee" },
            staleLabel: null,
            payload: {
              days: [
                {
                  classId: "sio1",
                  classLabel: "BTS SIO 1",
                  entries: [
                    {
                      time: "10:10",
                      subject: "Anglais",
                      room: "A 112",
                      teacher: "Mme Roche",
                      change: "cancelled",
                      note: "Annulé — Mme Roche absente",
                    },
                    { time: "11:10", subject: "Économie-droit", room: "A 210", teacher: "Mme Bréan" },
                  ],
                },
              ],
            },
          },
        },
      ],
    });

    const texte = container.textContent ?? "";
    expect(texte).toContain("Annulé — Mme Roche absente");
    expect(texte).not.toContain("A 112");
    expect(container.querySelector(".couloir-row--cancelled .room")?.textContent).toBe("—");
    // Le cours suivant, lui, garde tout.
    expect(texte).toContain("A 210");
    expect(texte).toContain("Mme Bréan");
  });

  it("dessine tout ce que la séance porte : horaires, groupe, module, salle, enseignant", () => {
    // Six informations arrivent du logiciel de l'école. En laisser deux au
    // fond de la charge utile, c'est faire monter quelqu'un à l'échelle pour
    // savoir avec qui a lieu le cours.
    const renderer = mountRenderer(container);
    renderer.update({
      ...zonesScreen(),
      zones: [
        {
          ...zonesScreen().zones[0]!,
          slide: {
            kind: "data",
            slideId: "cours",
            sourceId: "edt",
            view: "timetable-day",
            params: { affichage: "journee" },
            staleLabel: null,
            payload: {
              days: [
                {
                  classId: "bat-b",
                  classLabel: "Bâtiment B",
                  entries: [
                    {
                      time: "08:30",
                      endTime: "12:00",
                      subject: "BTS Gestion 2e année",
                      detail: "Gérer la relation client",
                      room: "CCI SALLE B11",
                      teacher: "M. MAGNIEN C.",
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    });

    const texte = container.textContent ?? "";
    for (const attendu of [
      "08:30",
      "12:00",
      "BTS Gestion 2e année",
      "Gérer la relation client",
      "CCI SALLE B11",
      "M. MAGNIEN C.",
    ]) {
      expect(texte).toContain(attendu);
    }
  });

  it("ne laisse pas de trou quand l'enseignant ou l'heure de fin manquent", () => {
    const renderer = mountRenderer(container);
    renderer.update({
      ...zonesScreen(),
      zones: [
        {
          ...zonesScreen().zones[0]!,
          slide: {
            kind: "data",
            slideId: "cours",
            sourceId: "edt",
            view: "timetable-day",
            params: { affichage: "journee" },
            staleLabel: null,
            payload: {
              days: [
                {
                  classId: "bat-b",
                  classLabel: "Bâtiment B",
                  entries: [{ time: "08:30", subject: "Atelier", room: "A distance" }],
                },
              ],
            },
          },
        },
      ],
    });

    expect(container.textContent).toContain("A distance");
    expect(container.querySelector(".couloir-prof")).toBeNull();
    expect(container.querySelector(".couloir-fin")).toBeNull();
  });

  it("ne montre que les colonnes demandées", () => {
    // Réglé écran par écran : un couloir de bâtiment veut la salle, un écran
    // d'accueil s'en passe, et certains établissements ne souhaitent pas
    // afficher les noms d'enseignants.
    const renderer = mountRenderer(container);
    const avec = (champs: string | undefined) => ({
      ...zonesScreen(),
      zones: [
        {
          ...zonesScreen().zones[0]!,
          slide: {
            kind: "data" as const,
            slideId: "cours",
            sourceId: "edt",
            view: "timetable-day" as const,
            params: { affichage: "journee", ...(champs === undefined ? {} : { champs }) },
            staleLabel: null,
            payload: {
              days: [
                {
                  classId: "b",
                  classLabel: "Bâtiment B",
                  entries: [
                    {
                      time: "08:30",
                      endTime: "12:00",
                      subject: "BTS Gestion",
                      detail: "Relation client",
                      room: "B11",
                      teacher: "M. MAGNIEN C.",
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    });

    renderer.update(avec("salle"));
    let texte = container.textContent ?? "";
    expect(texte).toContain("B11");
    expect(texte).toContain("BTS Gestion");
    expect(texte).not.toContain("M. MAGNIEN C.");
    expect(texte).not.toContain("Relation client");
    expect(texte).not.toContain("12:00");

    renderer.update(avec("heureFin,module"));
    texte = container.textContent ?? "";
    expect(texte).toContain("12:00");
    expect(texte).toContain("Relation client");
    expect(texte).not.toContain("B11");
  });

  it("montre tout quand le réglage n'a jamais été touché", () => {
    // Une publication faite avant ce réglage ne doit pas se retrouver
    // amputée.
    const renderer = mountRenderer(container);
    renderer.update({
      ...zonesScreen(),
      zones: [
        {
          ...zonesScreen().zones[0]!,
          slide: {
            kind: "data",
            slideId: "cours",
            sourceId: "edt",
            view: "timetable-day",
            params: { affichage: "journee" },
            staleLabel: null,
            payload: {
              days: [
                {
                  classId: "b",
                  classLabel: "Bâtiment B",
                  entries: [
                    { time: "08:30", endTime: "12:00", subject: "BTS", detail: "Module", room: "B11", teacher: "M. X" },
                  ],
                },
              ],
            },
          },
        },
      ],
    });

    const texte = container.textContent ?? "";
    for (const attendu of ["08:30", "12:00", "BTS", "Module", "B11", "M. X"]) {
      expect(texte).toContain(attendu);
    }
  });

  it("garde l'heure et l'intitulé même quand plus rien n'est coché", () => {
    // Sans eux la colonne ne dit plus rien : ils ne sont pas décochables.
    const renderer = mountRenderer(container);
    renderer.update({
      ...zonesScreen(),
      zones: [
        {
          ...zonesScreen().zones[0]!,
          slide: {
            kind: "data",
            slideId: "cours",
            sourceId: "edt",
            view: "timetable-day",
            params: { affichage: "journee", champs: "" },
            staleLabel: null,
            payload: {
              days: [
                {
                  classId: "b",
                  classLabel: "Bâtiment B",
                  entries: [
                    { time: "08:30", endTime: "12:00", subject: "BTS", detail: "Module", room: "B11", teacher: "M. X" },
                  ],
                },
              ],
            },
          },
        },
      ],
    });

    const texte = container.textContent ?? "";
    expect(texte).toContain("08:30");
    expect(texte).toContain("BTS");
    expect(texte).not.toContain("B11");
    expect(texte).not.toContain("M. X");
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

interface TimetableEntryDeTest {
  time: string;
  endTime?: string;
  subject: string;
  detail?: string;
  room: string;
  teacher?: string;
  change?: string;
}

describe("maintenant et ensuite", () => {
  // Mercredi 14 octobre, 9 h 15 à Paris (UTC+2 en octobre).
  const A_9H15 = new Date("2026-10-14T07:15:00Z");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(A_9H15);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const ecran = (
    entries: TimetableEntryDeTest[],
    params: Record<string, string> = {},
    notice?: string,
  ): ScreenState => ({
    ...zonesScreen(),
    zones: [
      {
        ...zonesScreen().zones[0]!,
        slide: {
          kind: "data",
          slideId: "cours",
          sourceId: "edt",
          view: "timetable-day",
          params,
          staleLabel: null,
          payload: {
            days: [
              {
                classId: "a",
                classLabel: "Campus by CCI Nievre Bat A",
                entries,
                ...(notice ? { notice } : {}),
              },
            ],
          },
        },
      },
    ],
  });

  const JOURNEE: TimetableEntryDeTest[] = [
    {
      time: "08:30",
      endTime: "12:00",
      subject: "BTS NDRC 1",
      detail: "Relation client",
      room: "CCI SALLE A14",
      teacher: "M. Perrin",
    },
    { time: "10:00", endTime: "12:00", subject: "Bachelor RH", room: "CCI SALLE A03" },
    { time: "13:30", endTime: "17:00", subject: "BTS MCO 2", room: "CCI SALLE A21" },
  ];

  const lignes = () =>
    [...container.querySelectorAll<HTMLElement>(".mx-ligne")].filter((li) => !li.hidden);
  const texteDe = (li: HTMLElement) => li.textContent ?? "";

  it("montre ce qui se passe et ce qui vient, pas l'après-midi", () => {
    mountRenderer(container).update(ecran(JOURNEE));
    vi.advanceTimersByTime(0);

    const enCours = container.querySelectorAll(".mx-bloc--en-cours .mx-ligne");
    expect(enCours).toHaveLength(1);
    expect(texteDe(enCours[0] as HTMLElement)).toContain("jusqu'à 12 h");
    expect(lignes().map((li) => li.querySelector(".mx-salle-nom")?.textContent)).toEqual([
      "A14",
      "A03",
    ]);
    // 13 h 30 est à plus de deux heures : il n'oriente personne à 9 h 15.
    expect(container.textContent).not.toContain("BTS MCO 2");
    expect(container.querySelector(".mx-lieu")?.textContent).toBe("Bâtiment A");
    expect(container.querySelector(".mx-heure")?.textContent).toBe("9 h 15");
  });

  it("tait le module et l'enseignant tant qu'on ne les a pas demandés", () => {
    mountRenderer(container).update(ecran(JOURNEE));
    vi.advanceTimersByTime(0);
    expect(container.textContent).not.toContain("M. Perrin");
    expect(container.textContent).not.toContain("Relation client");
  });

  it("les montre quand l'écran les demande", () => {
    mountRenderer(container).update(ecran(JOURNEE, { champs: "module,enseignant,salle" }));
    vi.advanceTimersByTime(0);
    expect(container.querySelector(".mx-prof")?.textContent).toBe("M. Perrin");
    expect(container.querySelector(".mx-detail")?.textContent).toBe("Relation client");
  });

  it("dit annulé à la place de la salle", () => {
    const annule = {
      time: "10:00",
      endTime: "12:00",
      subject: "BTS SIO 1",
      room: "CCI SALLE A08",
      change: "cancelled",
    };
    mountRenderer(container).update(ecran([annule]));
    vi.advanceTimersByTime(0);
    const salle = container.querySelector(".mx-ligne--annulee .mx-salle-nom");
    expect(salle?.textContent).toBe("Annulé");
    expect(container.textContent).not.toContain("A08");
  });

  it("fait passer un cours dans « En ce moment » à son heure, sans nouvelles données", () => {
    mountRenderer(container).update(ecran(JOURNEE));
    vi.advanceTimersByTime(0);
    expect(container.querySelectorAll(".mx-bloc--en-cours .mx-ligne")).toHaveLength(1);

    vi.advanceTimersByTime(45 * 60_000); // 10 h
    expect(container.querySelectorAll(".mx-bloc--en-cours .mx-ligne")).toHaveLength(2);
    expect(container.querySelector(".mx-heure")?.textContent).toBe("10 h");
  });

  it("explique une dalle vide au lieu de la laisser vide", () => {
    vi.setSystemTime(new Date("2026-10-14T09:15:00Z")); // 11 h 15
    mountRenderer(container).update(ecran(JOURNEE.slice(2)));
    vi.advanceTimersByTime(0);
    expect(container.querySelector(".mx-vide")?.textContent).toBe(
      "Pas de cours dans les deux prochaines heures. Reprise à 13 h 30.",
    );
  });

  it("annonce la fin de la journée", () => {
    vi.setSystemTime(new Date("2026-10-14T16:00:00Z")); // 18 h
    mountRenderer(container).update(ecran(JOURNEE));
    vi.advanceTimersByTime(0);
    expect(container.querySelector(".mx-vide")?.textContent).toBe(
      "Les cours sont terminés pour aujourd'hui.",
    );
  });

  it("relaie les vacances", () => {
    mountRenderer(container).update(ecran([], {}, "Vacances de la Toussaint"));
    vi.advanceTimersByTime(0);
    expect(container.querySelector(".mx-vide")?.textContent).toBe("Vacances de la Toussaint");
  });

  it("garde la journée complète pour qui la demande", () => {
    mountRenderer(container).update(ecran(JOURNEE, { affichage: "journee" }));
    vi.advanceTimersByTime(0);
    expect(container.querySelector(".mx")).toBeNull();
    expect(container.textContent).toContain("BTS MCO 2");
  });
});
