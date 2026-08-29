import { describe, expect, it } from "vitest";
import { ecransQuiUtilisent, mediasDeLaComposition } from "./usage-des-medias.js";

const ECRAN = { id: "e1", code: "A·0·01", label: "Couloir A" };
const AUTRE = { id: "e2", code: "B·1·04", label: "Hall B" };

describe("mediasDeLaComposition", () => {
  it("relève les affiches de la rotation", () => {
    const trouves = mediasDeLaComposition({ items: [{ assetId: "m1" }, { assetId: "m2" }] });
    expect([...trouves].sort()).toEqual(["m1", "m2"]);
  });

  it("compte aussi le contenu par défaut", () => {
    // Il s'affiche dès que rien n'est programmé — la nuit, le week-end.
    // L'oublier ferait disparaître une image d'un écran sans prévenir.
    expect(mediasDeLaComposition({ items: [], parDefaut: { assetId: "m9" } }).has("m9")).toBe(true);
  });

  it("ignore une diapositive sans image", () => {
    expect(mediasDeLaComposition({ items: [{ text: { titre: "Bonjour" } }] }).size).toBe(0);
  });

  it("ne se casse pas sur une composition illisible", () => {
    // Le magasin rend du `unknown` : une composition ancienne ou tronquée ne
    // doit pas faire échouer une suppression, ni en autoriser une à tort.
    expect(mediasDeLaComposition(null).size).toBe(0);
    expect(mediasDeLaComposition({ items: "pas une liste" }).size).toBe(0);
    expect(mediasDeLaComposition({ items: [null, 3] }).size).toBe(0);
  });
});

describe("ecransQuiUtilisent", () => {
  it("nomme les écrans concernés", () => {
    const concernes = ecransQuiUtilisent(
      [
        { ecran: ECRAN, spec: { items: [{ assetId: "m1" }] } },
        { ecran: AUTRE, spec: { items: [{ assetId: "m2" }] } },
      ],
      "m1",
    );
    expect(concernes).toEqual([ECRAN]);
  });

  it("ne rend rien quand le média ne sert plus", () => {
    expect(
      ecransQuiUtilisent([{ ecran: ECRAN, spec: { items: [{ assetId: "m2" }] } }], "m1"),
    ).toEqual([]);
  });

  it("compte un écran sans composition comme libre", () => {
    expect(ecransQuiUtilisent([{ ecran: ECRAN, spec: null }], "m1")).toEqual([]);
  });
});
