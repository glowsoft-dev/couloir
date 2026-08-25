import { describe, expect, it } from "vitest";
import {
  DEMARRAGES_RATES_AVANT_RETOUR,
  delaiDeBascule,
  doitRevenirEnArriere,
  doitSeMettreAJour,
} from "./mise-a-jour.js";

describe("doitSeMettreAJour", () => {
  it("va chercher une version différente", () => {
    expect(doitSeMettreAJour("0.1.0", "0.2.0")).toBe(true);
  });

  it("ne bouge pas sur la même version", () => {
    expect(doitSeMettreAJour("0.1.0", "0.1.0")).toBe(false);
  });

  it("accepte de redescendre", () => {
    // Revenir en arrière est légitime : on republie la version d'avant quand
    // la nouvelle s'avère mauvaise. « Strictement supérieur » refuserait
    // précisément le retour qu'on cherche à faire.
    expect(doitSeMettreAJour("0.2.0", "0.1.0")).toBe(true);
  });

  it("ne bouge pas quand le serveur ne dit rien", () => {
    // Un serveur qui n'annonce pas de version n'est pas un serveur qui
    // annonce la version zéro.
    expect(doitSeMettreAJour("0.1.0", null)).toBe(false);
  });
});

describe("delaiDeBascule", () => {
  it("reste dans la fenêtre", () => {
    for (const id of ["a", "boitier-hall", "6f624474-c988-4d51-b4a0-e2ae26dd4a42"]) {
      const delai = delaiDeBascule(id, 600_000);
      expect(delai).toBeGreaterThanOrEqual(0);
      expect(delai).toBeLessThan(600_000);
    }
  });

  it("donne toujours le même rang au même boîtier", () => {
    // Sinon un boîtier repasserait devant les autres à chaque tentative, et
    // l'étalement ne servirait à rien.
    expect(delaiDeBascule("hall", 600_000)).toBe(delaiDeBascule("hall", 600_000));
  });

  it("étale des boîtiers différents", () => {
    const delais = ["hall", "cdi", "atelier", "accueil", "b012"].map((id) =>
      delaiDeBascule(id, 600_000),
    );
    expect(new Set(delais).size).toBeGreaterThan(1);
  });

  it("ne retarde personne sans fenêtre", () => {
    expect(delaiDeBascule("hall", 0)).toBe(0);
  });
});

describe("doitRevenirEnArriere", () => {
  it("laisse passer un premier démarrage raté", () => {
    // Une coupure de courant pendant l'écriture n'est pas une mauvaise
    // version : revenir dès le premier raté ferait rejeter des versions
    // saines.
    expect(doitRevenirEnArriere(1, true)).toBe(false);
  });

  it("revient au deuxième", () => {
    expect(doitRevenirEnArriere(DEMARRAGES_RATES_AVANT_RETOUR, true)).toBe(true);
  });

  it("ne revient nulle part sans version précédente", () => {
    // Le premier boîtier posé n'a rien où retomber : mieux vaut un écran qui
    // redémarre en boucle et qu'on voit, qu'un retour vers du vide.
    expect(doitRevenirEnArriere(5, false)).toBe(false);
  });
});
