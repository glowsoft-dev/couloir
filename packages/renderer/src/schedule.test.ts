import { describe, expect, it } from "vitest";
import { isDisplayOffPeriod } from "./schedule.js";

/**
 * L'extinction programmée de la dalle.
 *
 * Le point délicat est le passage de minuit. « Du lundi au vendredi, de
 * 19:00 à 07:30 » se lit d'une seule façon : le vendredi soir, l'écran
 * reste éteint jusqu'au samedi matin. Les jours cochés désignent le jour où
 * la plage commence, pas celui où l'on se trouve.
 *
 * Sans ces tests, la console promettrait sous le réglage une phrase que le
 * rendu ne tiendrait pas — et personne ne monterait vérifier à 6 h du matin.
 */

const settings = (daysOfWeek: number[], from = "19:00", to = "07:30") =>
  ({ timezone: "Europe/Paris", displayOff: [{ daysOfWeek, from, to }] }) as never;

/** Août 2026 : le lundi 17 tombe un lundi. `jour` va de 1 (lundi) à 7. */
function at(jour: number, heure: number, minute = 0): number {
  const date = String(16 + jour).padStart(2, "0");
  // Paris est à UTC+2 en août.
  const utc = String(heure - 2).padStart(2, "0");
  return Date.parse(`2026-08-${date}T${utc}:${String(minute).padStart(2, "0")}:00Z`);
}

describe("extinction du lundi au vendredi, 19:00 → 07:30", () => {
  const semaine = settings([1, 2, 3, 4, 5]);

  it("éteint le lundi soir", () => {
    expect(isDisplayOffPeriod(semaine, at(1, 20))).toBe(true);
  });

  it("reste éteint le mardi au petit matin", () => {
    expect(isDisplayOffPeriod(semaine, at(2, 6))).toBe(true);
  });

  it("rallume le mardi à 07:30", () => {
    expect(isDisplayOffPeriod(semaine, at(2, 7, 29))).toBe(true);
    expect(isDisplayOffPeriod(semaine, at(2, 7, 30))).toBe(false);
  });

  it("reste allumé en pleine journée", () => {
    expect(isDisplayOffPeriod(semaine, at(3, 12))).toBe(false);
  });

  it("couvre le samedi matin, parce que la plage a commencé vendredi soir", () => {
    // Le samedi n'est pas coché, et pourtant l'écran doit rester éteint :
    // c'est la nuit du vendredi qui court encore.
    expect(isDisplayOffPeriod(semaine, at(6, 6))).toBe(true);
  });

  it("rallume le samedi en journée", () => {
    expect(isDisplayOffPeriod(semaine, at(6, 12))).toBe(false);
  });

  it("laisse le samedi soir allumé, faute d'être coché", () => {
    expect(isDisplayOffPeriod(semaine, at(6, 21))).toBe(false);
  });

  it("laisse le lundi matin allumé : aucune plage n'a commencé dimanche", () => {
    expect(isDisplayOffPeriod(semaine, at(1, 6))).toBe(false);
  });
});

describe("cas particuliers", () => {
  it("une plage sans jour coché vaut tous les jours", () => {
    expect(isDisplayOffPeriod(settings([]), at(7, 22))).toBe(true);
    expect(isDisplayOffPeriod(settings([]), at(7, 12))).toBe(false);
  });

  it("une plage à l'intérieur d'une même journée ne déborde pas", () => {
    const midi = settings([3], "12:00", "14:00");
    expect(isDisplayOffPeriod(midi, at(3, 13))).toBe(true);
    expect(isDisplayOffPeriod(midi, at(3, 15))).toBe(false);
    expect(isDisplayOffPeriod(midi, at(4, 13))).toBe(false);
  });

  it("aucune plage : l'écran reste allumé", () => {
    expect(isDisplayOffPeriod({ timezone: "Europe/Paris", displayOff: [] } as never, at(2, 3))).toBe(
      false,
    );
  });
});
