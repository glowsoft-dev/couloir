import { describe, expect, it } from "vitest";
import { demoManifest } from "@couloir/protocol";
import { type RotationState, direct } from "./director.js";
import { isVisible } from "./schedule.js";
import type { SourceSnapshot } from "./staleness.js";

/**
 * La programmation d'une affiche.
 *
 * « Cette affiche du 1er au 15 septembre », « celle-là le matin seulement ».
 * L'affiche rejoint la rotation le temps voulu puis en sort d'elle-même :
 * personne n'a à penser à la retirer trois semaines après.
 *
 * C'est l'ÉCRAN qui tranche, pas le serveur au moment de publier — un boîtier
 * coupé du réseau doit voir ses affiches arriver et repartir tout seul. D'où
 * ces tests : ils se jouent à n'importe quelle date, sans attendre septembre.
 */

const PARIS = "Europe/Paris";

/**
 * Un instant en heure de Paris. Septembre 2026 : le 1er est un mardi.
 *
 * Calculé en millisecondes plutôt que par une chaîne : soustraire deux
 * heures dans le texte donne « -01 » pour une heure du matin, et
 * `Date.parse` rend NaN sans prévenir.
 */
const à = (jour: number, heure = 12, minute = 0) =>
  Date.UTC(2026, 8, jour, heure - 2, minute);

describe("sans programmation", () => {
  it("une affiche passe toujours", () => {
    // Le cas courant, et il ne doit rien coûter.
    expect(isVisible(undefined, à(15), PARIS)).toBe(true);
  });
});

describe("une période de dates", () => {
  /**
   * Du 1er au 15 septembre inclus, en heure de Paris.
   *
   * Les bornes sont des instants absolus, pas des dates : « jusqu'au 15 »
   * veut dire « jusqu'à la fin du 15 chez nous », soit le 16 à minuit heure
   * locale. C'est à la console de faire cette conversion — la poser en UTC
   * sans y penser décale tout de deux heures en été.
   */
  const portesOuvertes = {
    startsAt: new Date(à(1, 0)).toISOString(),
    endsAt: new Date(à(16, 0)).toISOString(),
  };

  it("ne passe pas avant", () => {
    expect(isVisible(portesOuvertes, à(-1, 12), PARIS)).toBe(false); // 31 août
  });

  it("passe pendant", () => {
    expect(isVisible(portesOuvertes, à(1), PARIS)).toBe(true);
    expect(isVisible(portesOuvertes, à(15), PARIS)).toBe(true);
  });

  it("s'arrête toute seule après", () => {
    // Le point entier : personne n'a à penser à la retirer.
    expect(isVisible(portesOuvertes, à(16, 1), PARIS)).toBe(false);
    expect(isVisible(portesOuvertes, à(30), PARIS)).toBe(false);
  });

  it("accepte une date de début sans date de fin", () => {
    const depuisLe10 = { startsAt: new Date(à(10, 0)).toISOString() };
    expect(isVisible(depuisLe10, à(9), PARIS)).toBe(false);
    expect(isVisible(depuisLe10, à(11), PARIS)).toBe(true);
  });
});

describe("une plage horaire", () => {
  const leMatin = { dailyStart: "07:00", dailyEnd: "12:00" };

  it("passe le matin, pas l'après-midi", () => {
    expect(isVisible(leMatin, à(15, 9), PARIS)).toBe(true);
    expect(isVisible(leMatin, à(15, 15), PARIS)).toBe(false);
  });

  it("gère le passage de minuit", () => {
    const laNuit = { dailyStart: "22:00", dailyEnd: "06:00" };
    expect(isVisible(laNuit, à(15, 23), PARIS)).toBe(true);
    expect(isVisible(laNuit, à(15, 3), PARIS)).toBe(true);
    expect(isVisible(laNuit, à(15, 12), PARIS)).toBe(false);
  });
});

describe("des jours de semaine", () => {
  const enSemaine = { daysOfWeek: [1, 2, 3, 4, 5] };

  it("passe du lundi au vendredi", () => {
    expect(isVisible(enSemaine, à(14), PARIS)).toBe(true); // lundi
    expect(isVisible(enSemaine, à(18), PARIS)).toBe(true); // vendredi
  });

  it("ne passe pas le week-end", () => {
    expect(isVisible(enSemaine, à(19), PARIS)).toBe(false); // samedi
    expect(isVisible(enSemaine, à(20), PARIS)).toBe(false); // dimanche
  });

  it("suit le jour où la plage commence, pas celui où l'on se trouve", () => {
    // Même règle que l'extinction de la dalle. Deux règles différentes pour
    // la même phrase seraient un piège.
    const soirées = { daysOfWeek: [5], dailyStart: "18:00", dailyEnd: "08:00" };
    expect(isVisible(soirées, à(18, 20), PARIS)).toBe(true); // vendredi soir
    expect(isVisible(soirées, à(19, 6), PARIS)).toBe(true); // samedi matin, plage du vendredi
    expect(isVisible(soirées, à(19, 20), PARIS)).toBe(false); // samedi soir : non
  });
});

describe("tout à la fois", () => {
  it("exige que chaque condition soit remplie", () => {
    const cantine = {
      startsAt: new Date(à(1, 0)).toISOString(),
      endsAt: new Date(à(31, 0)).toISOString(),
      daysOfWeek: [1, 2, 3, 4, 5],
      dailyStart: "11:00",
      dailyEnd: "14:00",
    };
    expect(isVisible(cantine, à(15, 12), PARIS)).toBe(true); // mardi midi
    expect(isVisible(cantine, à(15, 16), PARIS)).toBe(false); // mardi, trop tard
    expect(isVisible(cantine, à(19, 12), PARIS)).toBe(false); // samedi midi
    expect(isVisible(cantine, à(61, 12), PARIS)).toBe(false); // 31 octobre, hors période
  });
});

describe("l'écran quand plus rien n'est dans sa période", () => {
  const NOW = à(15, 10);

  function écranAvec(visibility: unknown) {
    const base = demoManifest("ecran-demo");
    const manifest = {
      ...base,
      layout: { zones: [base.layout.zones[0]!] },
      slides: base.slides.map((s) =>
        s.id === "repli-identite" ? s : { ...s, visibility: visibility as never },
      ),
    };
    return direct({
      manifest: manifest as never,
      nowMs: NOW,
      sources: new Map<string, SourceSnapshot>([
        ["edt", { fetchedAtMs: NOW - 60_000, payload: [{ time: "08:00" }] }],
        ["actus-site", { fetchedAtMs: NOW - 60_000, payload: [{ title: "x" }] }],
      ]),
      availableAssetIds: new Set(["affiche-po-2026"]),
      rotations: new Map<string, RotationState>(),
      screenCode: "A·1·12",
    });
  }

  it("ne laisse jamais une dalle noire", () => {
    // Le pire scénario : on programme tout pour septembre, et le 20 août le
    // couloir est éteint sans que rien ne l'explique. Mieux vaut la carte
    // d'identité de l'écran — elle dit au moins que le boîtier fonctionne.
    const { screen } = écranAvec({ startsAt: new Date(à(400, 0)).toISOString() });

    expect(screen.zones.length).toBeGreaterThan(0);
    expect(screen.zones.some((z) => z.slide !== null)).toBe(true);
  });

  it("revient à la rotation normale dès qu'une affiche redevient valide", () => {
    const { screen } = écranAvec({ startsAt: new Date(à(1, 0)).toISOString() });
    expect(screen.mode).toBe("normal");
    expect(screen.zones[0]!.slide).not.toBeNull();
  });
});
