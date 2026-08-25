import { describe, expect, it } from "vitest";
import type { PublishSpec, ScreenStatus } from "./api.js";
import { champsCommuns, ouCaSAffiche, sortEdt } from "./ouEdt.js";

const base: PublishSpec = { layout: "principal-et-cours", items: [] };

describe("sortEdt", () => {
  it("ne montre rien quand la mise en page n'a pas de colonne de cours", () => {
    expect(sortEdt({ ...base, layout: "plein-ecran" }, "c1")).toBe("aucun");
  });

  it("montre toutes les classes quand aucune n'est choisie", () => {
    expect(sortEdt(base, "c1")).toBe("affiche");
    expect(sortEdt({ ...base, timetableClassIds: [] }, "c1")).toBe("affiche");
  });

  it("ne montre que les classes choisies", () => {
    expect(sortEdt({ ...base, timetableClassIds: ["c1", "c2"] }, "c1")).toBe("affiche");
    expect(sortEdt({ ...base, timetableClassIds: ["c2"] }, "c1")).toBe("aucun");
  });

  it("signale NetYPareo, qui remplace les classes locales", () => {
    // Le composeur ne monte plus les classes dès qu'un afficheur est choisi :
    // un changement saisi ici n'atteindrait pas cet écran.
    const spec = { ...base, timetableAfficheurs: ["a1"], timetableClassIds: ["c1"] };
    expect(sortEdt(spec, "c1")).toBe("netypareo");
  });

  it("ne montre rien pour un écran jamais publié", () => {
    expect(sortEdt(null, "c1")).toBe("aucun");
    expect(sortEdt(undefined, "c1")).toBe("aucun");
  });
});

describe("ouCaSAffiche", () => {
  const ecran = (id: string, label: string) => ({ id, label }) as unknown as ScreenStatus;

  it("répartit le parc et garde son ordre", () => {
    const screens = [ecran("e1", "Hall"), ecran("e2", "CDI"), ecran("e3", "Atelier")];
    const compositions = {
      e1: base,
      e2: { ...base, timetableAfficheurs: ["a1"] },
      e3: { ...base, layout: "plein-ecran" as const },
    };
    const ou = ouCaSAffiche(screens, compositions, "c1");
    expect(ou.affiche.map((s) => s.label)).toEqual(["Hall"]);
    expect(ou.netypareo.map((s) => s.label)).toEqual(["CDI"]);
  });

  it("supporte l'absence de compositions", () => {
    expect(ouCaSAffiche([ecran("e1", "Hall")], undefined, "c1")).toEqual({
      affiche: [],
      netypareo: [],
    });
  });
});

describe("champsCommuns", () => {
  const avec = (champs?: ("salle" | "prof" | "fin")[]) =>
    ({ ...base, ...(champs ? { timetableChamps: champs } : {}) }) as PublishSpec;

  it("retient le choix quand tous les écrans le partagent", () => {
    expect(champsCommuns([avec(["salle"]), avec(["salle"])])).toEqual(["salle"]);
  });

  it("montre tout dès que les écrans divergent", () => {
    expect(champsCommuns([avec(["salle"]), avec(["salle", "prof"])])).toBeUndefined();
    expect(champsCommuns([avec(["salle"]), avec()])).toBeUndefined();
  });

  it("montre tout quand aucun écran n'est concerné", () => {
    expect(champsCommuns([])).toBeUndefined();
  });
});
