import { describe, expect, it } from "vitest";
import {
  heureLisible,
  lieuLisible,
  repartirAutourDeMaintenant,
  salleCourte,
} from "./maintenant.js";

const h = (hhmm: string) => {
  const [a, b] = hhmm.split(":").map(Number);
  return a! * 60 + b!;
};

const JOURNEE = [
  { id: "matin", time: "08:30", endTime: "12:00" },
  { id: "court", time: "11:00", endTime: "12:00" },
  { id: "aprem", time: "13:30", endTime: "17:00" },
  { id: "soir", time: "17:30", endTime: "19:00" },
];

const ids = (liste: { id: string }[]) => liste.map((s) => s.id);

describe("repartirAutourDeMaintenant", () => {
  it("sépare ce qui se passe de ce qui vient", () => {
    const r = repartirAutourDeMaintenant(JOURNEE, h("11:30"));
    expect(ids(r.enCours)).toEqual(["matin", "court"]);
    expect(ids(r.aSuivre)).toEqual(["aprem"]);
    expect(r.prochain?.id).toBe("soir");
  });

  it("n'annonce rien au-delà de deux heures", () => {
    // À 9 h, le cours de 13 h 30 n'oriente personne : il ne fait qu'ajouter
    // une ligne et rapetisser les autres.
    const r = repartirAutourDeMaintenant(JOURNEE, h("09:00"));
    expect(ids(r.enCours)).toEqual(["matin"]);
    expect(ids(r.aSuivre)).toEqual(["court"]);
    expect(r.prochain?.id).toBe("aprem");
  });

  it("dit quand la pause de midi se termine", () => {
    const r = repartirAutourDeMaintenant(JOURNEE, h("12:15"));
    expect(r.enCours).toEqual([]);
    expect(ids(r.aSuivre)).toEqual(["aprem"]);
  });

  it("garde les cours annulés : c'est ce que cherche celui qui allait y aller", () => {
    const r = repartirAutourDeMaintenant(
      [{ id: "annule", time: "10:00", endTime: "12:00", change: "cancelled" }],
      h("09:00"),
    );
    expect(ids(r.aSuivre)).toEqual(["annule"]);
  });

  it("considère un cours fini à son heure de fin, pas une minute après", () => {
    const r = repartirAutourDeMaintenant(JOURNEE, h("12:00"));
    expect(ids(r.enCours)).toEqual([]);
  });

  it("suppose une heure quand la fin manque", () => {
    const r = repartirAutourDeMaintenant([{ id: "sans-fin", time: "10:00" }], h("10:45"));
    expect(ids(r.enCours)).toEqual(["sans-fin"]);
  });

  it("sait que la journée est finie", () => {
    const r = repartirAutourDeMaintenant(JOURNEE, h("19:30"));
    expect(r.journeeTerminee).toBe(true);
  });

  it("trie, quel que soit l'ordre reçu", () => {
    const r = repartirAutourDeMaintenant([...JOURNEE].reverse(), h("11:30"));
    expect(ids(r.enCours)).toEqual(["matin", "court"]);
  });
});

describe("salleCourte", () => {
  it("ne garde que ce qu'on lit sur la porte", () => {
    expect(salleCourte("CCI SALLE A14")).toBe("A14");
    expect(salleCourte("cci salle c03")).toBe("c03");
  });

  it("laisse tel quel ce qui ne suit pas ce modèle", () => {
    expect(salleCourte("A distance")).toBe("A distance");
    expect(salleCourte("Gymnase")).toBe("Gymnase");
  });
});

describe("lieuLisible", () => {
  it("écrit le bâtiment en toutes lettres", () => {
    expect(lieuLisible("Campus by CCI Nievre Bat A")).toBe("Bâtiment A");
    expect(lieuLisible("CAMPUS BY CCI NIEVRE BAT C")).toBe("Bâtiment C");
  });

  it("garde un libellé qui ne nomme pas de bâtiment", () => {
    expect(lieuLisible("Hall d'accueil")).toBe("Hall d'accueil");
  });
});

describe("heureLisible", () => {
  it("écrit l'heure comme on la dit", () => {
    expect(heureLisible("08:30")).toBe("8 h 30");
    expect(heureLisible("14:00")).toBe("14 h");
    expect(heureLisible("13:05")).toBe("13 h 05");
  });
});
