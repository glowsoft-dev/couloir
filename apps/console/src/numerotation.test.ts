import { describe, expect, it } from "vitest";
import { prochainNumero } from "./NouvelEcran.js";
import type { ScreenStatus } from "./api.js";

/**
 * La numérotation d'un écran neuf.
 *
 * Le code d'étiquette se construit tout seul — « B·1·03 ». Le fixer à 01
 * faisait échouer la pose du deuxième écran d'un même palier, et l'erreur
 * parlait d'un code que personne n'avait choisi.
 */

const ecran = (code: string) => ({ code }) as ScreenStatus;

describe("le prochain numéro", () => {
  it("commence à 01 sur un palier vide", () => {
    expect(prochainNumero([], "B", 1)).toBe("01");
  });

  it("suit le plus grand déjà pris", () => {
    expect(prochainNumero([ecran("B·1·01"), ecran("B·1·02")], "B", 1)).toBe("03");
  });

  it("ne compte que le bâtiment et l'étage visés", () => {
    // Un écran du bâtiment A n'a rien à dire sur la numérotation du B.
    const parc = [ecran("A·1·07"), ecran("B·0·04"), ecran("B·1·01")];
    expect(prochainNumero(parc, "B", 1)).toBe("02");
  });

  it("comble un trou par le haut, pas par le milieu", () => {
    // Réutiliser un numéro libéré ferait réapparaître un code que quelqu'un
    // a peut-être noté sur un plan ou collé sur un boîtier.
    expect(prochainNumero([ecran("B·1·01"), ecran("B·1·03")], "B", 1)).toBe("04");
  });

  it("accepte un bâtiment saisi en minuscules", () => {
    expect(prochainNumero([ecran("B·1·01")], "b", 1)).toBe("02");
  });

  it("ignore un code qui ne suit pas la forme", () => {
    expect(prochainNumero([ecran("B·1·bis"), ecran("B·1·02")], "B", 1)).toBe("03");
  });

  it("gère un étage négatif", () => {
    expect(prochainNumero([ecran("C·-1·01")], "C", -1)).toBe("02");
  });
});
