import { describe, expect, it } from "vitest";
import type { PublishSpec, ScreenStatus } from "./api.js";
import { phraseDUsage, usageDesMedias } from "./usageDesMedias.js";

const ecran = (id: string, label: string) => ({ id, label }) as unknown as ScreenStatus;
const spec = (partiel: Partial<PublishSpec>): PublishSpec => ({
  layout: "plein-ecran",
  items: [],
  ...partiel,
});

describe("usageDesMedias", () => {
  it("compte les écrans où un média tourne", () => {
    const screens = [ecran("e1", "Hall"), ecran("e2", "CDI")];
    const usage = usageDesMedias(screens, {
      e1: spec({ items: [{ assetId: "a" }, { assetId: "b" }] }),
      e2: spec({ items: [{ assetId: "a" }] }),
    });
    expect(usage.get("a")?.map((s) => s.label)).toEqual(["Hall", "CDI"]);
    expect(usage.get("b")?.map((s) => s.label)).toEqual(["Hall"]);
  });

  it("compte aussi le contenu par défaut", () => {
    // Un média qui ne sert que de repli passe quand même dans le couloir.
    const usage = usageDesMedias([ecran("e1", "Hall")], {
      e1: spec({ parDefaut: { assetId: "repli" } }),
    });
    expect(usage.get("repli")?.map((s) => s.label)).toEqual(["Hall"]);
  });

  it("ne compte qu'une fois un média posé deux fois sur le même écran", () => {
    const usage = usageDesMedias([ecran("e1", "Hall")], {
      e1: spec({ items: [{ assetId: "a" }, { assetId: "a" }], parDefaut: { assetId: "a" } }),
    });
    expect(usage.get("a")).toHaveLength(1);
  });

  it("ignore un écran jamais publié", () => {
    const usage = usageDesMedias([ecran("e1", "Hall"), ecran("e2", "CDI")], {
      e1: null,
      e2: spec({ items: [{ assetId: "a" }] }),
    });
    expect(usage.get("a")?.map((s) => s.label)).toEqual(["CDI"]);
  });

  it("ignore une diapositive sans média — un texte n'en a pas", () => {
    const usage = usageDesMedias([ecran("e1", "Hall")], {
      e1: spec({ items: [{ text: { titre: "Bonne rentrée" } }, { assetId: "a" }] }),
    });
    expect([...usage.keys()]).toEqual(["a"]);
  });

  it("rend une carte vide sans compositions", () => {
    expect(usageDesMedias([ecran("e1", "Hall")], undefined).size).toBe(0);
  });
});

describe("phraseDUsage", () => {
  it("dit où ça passe, au singulier comme au pluriel", () => {
    expect(phraseDUsage(0)).toBe("nulle part");
    expect(phraseDUsage(1)).toBe("sur 1 écran");
    expect(phraseDUsage(5)).toBe("sur 5 écrans");
  });
});
