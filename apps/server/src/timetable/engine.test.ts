import { describe, expect, it } from "vitest";
import { isoDayOfWeek, resolveDay, todayIn, weekParityOn } from "./engine.js";
import type { Exception, Holiday, Lesson, Period, SchoolClass, SchoolYear } from "./model.js";

/**
 * Le moteur d'emploi du temps.
 *
 * Tout se joue ici : ce qui s'affiche dans un couloir vient de cette
 * fonction. Elle est pure, donc on peut rejouer une année entière — vacances,
 * quinzaines, changements de dernière minute — sans attendre le bon jour.
 */

const PERIODS: Period[] = [
  { id: "m1", label: "M1", startsAt: "08:00", endsAt: "08:55", position: 1 },
  { id: "m2", label: "M2", startsAt: "09:00", endsAt: "09:55", position: 2 },
  { id: "m3", label: "M3", startsAt: "10:15", endsAt: "11:10", position: 3 },
  { id: "s1", label: "S1", startsAt: "13:30", endsAt: "14:25", position: 4 },
];

const TG1: SchoolClass = { id: "tg1", code: "TG1", label: "Terminale G1", level: "Terminale" };
const TG2: SchoolClass = { id: "tg2", code: "TG2", label: "Terminale G2", level: "Terminale" };

/** Le mardi 15 septembre 2026. */
const MARDI = "2026-09-15";

function lesson(overrides: Partial<Lesson> & Pick<Lesson, "id" | "periodId">): Lesson {
  return {
    classId: "tg1",
    subjectLabel: "Mathématiques",
    teacherName: "M. Dupont",
    roomCode: "B 204",
    dayOfWeek: 2,
    weekParity: "all",
    startsOn: null,
    endsOn: null,
    ...overrides,
  };
}

function resolve(options: {
  date?: string;
  schoolClass?: SchoolClass;
  lessons?: Lesson[];
  exceptions?: Exception[];
  holidays?: Holiday[];
  year?: SchoolYear | null;
}) {
  return resolveDay({
    date: options.date ?? MARDI,
    schoolClass: options.schoolClass ?? TG1,
    periods: PERIODS,
    lessons: options.lessons ?? [],
    exceptions: options.exceptions ?? [],
    holidays: options.holidays ?? [],
    year: options.year ?? null,
  });
}

describe("grille de base", () => {
  it("rend les cours du jour, triés par horaire", () => {
    const day = resolve({
      lessons: [
        lesson({ id: "a", periodId: "m3", subjectLabel: "Anglais" }),
        lesson({ id: "b", periodId: "m1", subjectLabel: "Mathématiques" }),
      ],
    });

    expect(day.entries.map((e) => [e.time, e.subject])).toEqual([
      ["08:00", "Mathématiques"],
      ["10:15", "Anglais"],
    ]);
    expect(day.classLabel).toBe("Terminale G1");
  });

  it("ne mélange jamais deux classes", () => {
    const day = resolve({
      lessons: [
        lesson({ id: "a", periodId: "m1" }),
        lesson({ id: "b", periodId: "m2", classId: "tg2", subjectLabel: "Physique" }),
      ],
    });

    expect(day.entries).toHaveLength(1);
    expect(resolve({ schoolClass: TG2, lessons: [] }).entries).toEqual([]);
  });

  it("ignore un cours d'un autre jour de la semaine", () => {
    const day = resolve({ lessons: [lesson({ id: "a", periodId: "m1", dayOfWeek: 4 })] });
    expect(day.entries).toEqual([]);
  });

  it("respecte les bornes de validité d'un cours", () => {
    // Une option qui s'arrête aux vacances de février, par exemple.
    const stopped = lesson({ id: "a", periodId: "m1", endsOn: "2026-09-01" });
    const notYet = lesson({ id: "b", periodId: "m2", startsOn: "2026-10-01" });

    expect(resolve({ lessons: [stopped, notYet] }).entries).toEqual([]);
  });
});

describe("jours sans cours", () => {
  it("annonce les vacances plutôt que de rendre une liste vide", () => {
    // Une liste vide ressemble à un échec de chargement. On le dit.
    const day = resolve({
      lessons: [lesson({ id: "a", periodId: "m1" })],
      holidays: [
        { id: "h", label: "Vacances de la Toussaint", startsOn: "2026-09-14", endsOn: "2026-09-20" },
      ],
    });

    expect(day.entries).toEqual([]);
    expect(day.notice).toBe("Vacances de la Toussaint");
  });

  it("annonce le week-end quand il n'y a effectivement rien", () => {
    const samedi = resolve({ date: "2026-09-19", lessons: [lesson({ id: "a", periodId: "m1" })] });
    expect(samedi.notice).toBe("Samedi");
    expect(samedi.entries).toEqual([]);
  });

  it("affiche les cours du samedi matin quand il y en a", () => {
    // Le week-end ne se décrète pas : beaucoup d'établissements ont cours
    // le samedi. C'est la grille qui décide, pas une règle en dur.
    const samedi = resolve({
      date: "2026-09-19",
      lessons: [lesson({ id: "a", periodId: "m1", dayOfWeek: 6, subjectLabel: "Devoir surveillé" })],
    });

    expect(samedi.notice).toBeUndefined();
    expect(samedi.entries.map((e) => e.subject)).toEqual(["Devoir surveillé"]);
  });
});

describe("changements du jour", () => {
  const base = lesson({ id: "cours-1", periodId: "m1" });

  function exception(overrides: Partial<Exception> & Pick<Exception, "kind">): Exception {
    return {
      id: "e1",
      date: MARDI,
      lessonId: "cours-1",
      classId: "tg1",
      periodId: null,
      subjectLabel: null,
      teacherName: null,
      roomCode: null,
      note: null,
      ...overrides,
    };
  }

  it("garde un cours annulé à l'écran, signalé", () => {
    // Le faire disparaître priverait l'élève de l'information qui
    // l'intéresse le plus : il se déplacerait pour rien.
    const day = resolve({ lessons: [base], exceptions: [exception({ kind: "cancelled" })] });

    expect(day.entries).toHaveLength(1);
    expect(day.entries[0]).toMatchObject({ subject: "Mathématiques", change: "cancelled", note: "annulé" });
  });

  it("remplace la salle et le signale", () => {
    const day = resolve({
      lessons: [base],
      exceptions: [exception({ kind: "room", roomCode: "C 007" })],
    });

    expect(day.entries[0]).toMatchObject({ room: "C 007", change: "room", note: "salle changée" });
  });

  it("remplace l'enseignant et le signale", () => {
    const day = resolve({
      lessons: [base],
      exceptions: [exception({ kind: "teacher", teacherName: "Mme Martin" })],
    });

    expect(day.entries[0]).toMatchObject({ teacher: "Mme Martin", change: "teacher", note: "remplacé" });
  });

  it("insère un cours ajouté au bon horaire", () => {
    const day = resolve({
      lessons: [lesson({ id: "cours-1", periodId: "m3" })],
      exceptions: [
        exception({
          kind: "added",
          lessonId: null,
          periodId: "m1",
          subjectLabel: "Devoir surveillé",
          roomCode: "Gymnase",
        }),
      ],
    });

    expect(day.entries.map((e) => [e.time, e.subject])).toEqual([
      ["08:00", "Devoir surveillé"],
      ["10:15", "Mathématiques"],
    ]);
    expect(day.entries[0]!.change).toBe("added");
  });

  it("laisse la note saisie l'emporter sur le libellé générique", () => {
    const day = resolve({
      lessons: [base],
      exceptions: [exception({ kind: "cancelled", note: "prof en formation" })],
    });

    expect(day.entries[0]!.note).toBe("prof en formation");
  });

  it("n'applique pas une exception d'un autre jour ni d'une autre classe", () => {
    const day = resolve({
      lessons: [base],
      exceptions: [
        exception({ kind: "cancelled", date: "2026-09-16" }),
        exception({ kind: "cancelled", classId: "tg2" }),
      ],
    });

    expect(day.entries[0]!.change).toBe("none");
  });
});

describe("quinzaine", () => {
  const YEAR: SchoolYear = {
    id: "y",
    label: "2026-2027",
    startsOn: "2026-09-01",
    endsOn: "2027-07-04",
    // Lundi de la première semaine A.
    parityAnchor: "2026-09-07",
  };

  it("compte la parité depuis l'ancrage, pas depuis le numéro de semaine ISO", () => {
    // Les établissements ne s'accordent pas sur le point de départ.
    expect(weekParityOn("2026-09-07", YEAR)).toBe("A");
    expect(weekParityOn("2026-09-11", YEAR)).toBe("A");
    expect(weekParityOn("2026-09-14", YEAR)).toBe("B");
    expect(weekParityOn("2026-09-21", YEAR)).toBe("A");
  });

  it("n'affiche un cours de quinzaine que la bonne semaine", () => {
    const lessons = [
      lesson({ id: "a", periodId: "m1", weekParity: "A", subjectLabel: "TP Physique" }),
      lesson({ id: "b", periodId: "m2", weekParity: "B", subjectLabel: "TP Chimie" }),
    ];

    // Le 15 septembre tombe en semaine B.
    const semaineB = resolve({ date: "2026-09-15", lessons, year: YEAR });
    expect(semaineB.entries.map((e) => e.subject)).toEqual(["TP Chimie"]);

    const semaineA = resolve({ date: "2026-09-22", lessons, year: YEAR });
    expect(semaineA.entries.map((e) => e.subject)).toEqual(["TP Physique"]);
  });

  it("affiche tout quand l'établissement ne fonctionne pas en quinzaine", () => {
    // Un réglage manquant ne doit pas vider un écran.
    const day = resolve({
      lessons: [
        lesson({ id: "a", periodId: "m1", weekParity: "A" }),
        lesson({ id: "b", periodId: "m2", weekParity: "B" }),
      ],
      year: null,
    });

    expect(day.entries).toHaveLength(2);
  });
});

describe("dates civiles", () => {
  it("calcule le jour de la semaine sans dépendre du fuseau", () => {
    expect(isoDayOfWeek("2026-09-14")).toBe(1);
    expect(isoDayOfWeek("2026-09-15")).toBe(2);
    expect(isoDayOfWeek("2026-09-20")).toBe(7);
  });

  it("donne la date du jour dans le fuseau de l'école", () => {
    // Un écran allumé à 23 h 30 à Paris ne doit pas afficher la journée de
    // la veille parce que le serveur pense en UTC.
    const minuitTrenteParis = Date.parse("2026-06-15T22:30:00Z");
    expect(todayIn("Europe/Paris", minuitTrenteParis)).toBe("2026-06-16");
    expect(todayIn("UTC", minuitTrenteParis)).toBe("2026-06-15");
  });
});
