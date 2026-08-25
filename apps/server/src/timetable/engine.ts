import type { TimetableChange, TimetableDay, TimetableEntry } from "@couloir/protocol";
import { changeLabel } from "@couloir/protocol";
import type {
  Exception,
  Holiday,
  Lesson,
  Period,
  SchoolClass,
  SchoolYear,
  WeekParity,
} from "./model.js";

/**
 * Le calcul de la journée d'une classe.
 *
 * Logique pure : on lui donne la grille, les exceptions et le calendrier, il
 * renvoie ce qui doit s'afficher. Aucune base, aucune horloge implicite —
 * c'est ce qui permet de rejouer une année scolaire entière dans un test,
 * vacances et quinzaines comprises, plutôt que d'attendre le bon jour pour
 * vérifier un comportement.
 *
 * Une décision structurante : **un cours annulé reste affiché**, barré. Le
 * faire disparaître priverait l'élève de l'information qui l'intéresse le
 * plus — il se déplacerait pour rien. C'est l'inverse de ce que font la
 * plupart des exports d'emploi du temps.
 */

export interface ResolveInput {
  /** AAAA-MM-JJ, heure locale de l'école. */
  date: string;
  schoolClass: SchoolClass;
  periods: readonly Period[];
  lessons: readonly Lesson[];
  exceptions: readonly Exception[];
  holidays: readonly Holiday[];
  year?: SchoolYear | null;
}

export function resolveDay(input: ResolveInput): TimetableDay {
  const base: Pick<TimetableDay, "classId" | "classLabel" | "date"> = {
    classId: input.schoolClass.id,
    classLabel: input.schoolClass.label,
    date: input.date,
  };

  // Vacances et jours fériés d'abord : ce jour-là il n'y a pas de cours, et
  // le dire explicitement vaut mieux qu'une liste vide qui ressemble à une
  // panne de chargement.
  const holiday = input.holidays.find((h) => input.date >= h.startsOn && input.date <= h.endsOn);
  if (holiday) return { ...base, entries: [], notice: holiday.label };

  const dayOfWeek = isoDayOfWeek(input.date);

  const parity = weekParityOn(input.date, input.year ?? null);
  const periodsById = new Map(input.periods.map((p) => [p.id, p]));

  const dayExceptions = input.exceptions.filter(
    (e) => e.date === input.date && e.classId === input.schoolClass.id,
  );
  const byLesson = new Map(dayExceptions.filter((e) => e.lessonId).map((e) => [e.lessonId!, e]));

  const entries: TimetableEntry[] = [];

  for (const lesson of input.lessons) {
    if (lesson.classId !== input.schoolClass.id) continue;
    if (lesson.dayOfWeek !== dayOfWeek) continue;
    if (lesson.startsOn && input.date < lesson.startsOn) continue;
    if (lesson.endsOn && input.date > lesson.endsOn) continue;
    if (!matchesParity(lesson.weekParity, parity)) continue;

    const period = periodsById.get(lesson.periodId);
    if (!period) continue;

    const exception = byLesson.get(lesson.id);
    entries.push(applyException(lesson, period, exception));
  }

  // Les cours ajoutés ou déplacés n'ont pas de ligne de grille : on les
  // insère, puis on retrie sur l'horaire.
  for (const exception of dayExceptions) {
    if (exception.kind !== "added") continue;
    const period = exception.periodId ? periodsById.get(exception.periodId) : undefined;
    if (!period) continue;

    entries.push({
      time: period.startsAt,
      endTime: period.endsAt,
      subject: exception.subjectLabel ?? "Cours",
      room: exception.roomCode ?? "",
      ...(exception.teacherName ? { teacher: exception.teacherName } : {}),
      change: "added",
      note: exception.note ?? changeLabel("added") ?? undefined,
    });
  }

  entries.sort((a, b) => a.time.localeCompare(b.time));

  // Le week-end n'est PAS décrété : beaucoup d'établissements ont cours le
  // samedi matin. On ne l'annonce que si la grille est effectivement vide.
  if (entries.length === 0 && dayOfWeek >= 6) {
    return { ...base, entries, notice: dayOfWeek === 6 ? "Samedi" : "Dimanche" };
  }
  return { ...base, entries };
}

function applyException(
  lesson: Lesson,
  period: Period,
  exception: Exception | undefined,
): TimetableEntry {
  const entry: TimetableEntry = {
    time: period.startsAt,
    endTime: period.endsAt,
    subject: lesson.subjectLabel,
    room: lesson.roomCode,
    ...(lesson.teacherName ? { teacher: lesson.teacherName } : {}),
    change: "none",
  };

  if (!exception) return entry;

  const change: TimetableChange = exception.kind === "added" ? "added" : exception.kind;
  /*
   * La mention par défaut dit ce qui change vraiment.
   *
   * `changeLabel` la tire du genre, qui n'en désigne qu'un : « remplacé »
   * seul tairait le changement de salle posé en même temps, et l'élève
   * irait à l'ancienne porte.
   */
  const deuxChangements = Boolean(exception.roomCode) && Boolean(exception.teacherName);
  const note =
    exception.note ??
    (deuxChangements && exception.kind !== "added" && exception.kind !== "cancelled"
      ? "salle et enseignant changés"
      : (changeLabel(change) ?? undefined));

  if (exception.kind === "cancelled") {
    // Gardé à l'écran, signalé : c'est l'information la plus utile de la
    // journée pour l'élève qui allait s'y rendre.
    return { ...entry, change: "cancelled", ...(note ? { note } : {}) };
  }
  if (exception.kind === "added") return entry;

  /*
   * Ce qui est renseigné s'applique, quel que soit le genre.
   *
   * Le genre décidait seul du champ retenu : « salle changée » écrasait la
   * salle et jetait l'enseignant, « remplacé » faisait l'inverse. Une
   * absence se règle pourtant souvent des deux côtés — quelqu'un remplace,
   * et pas dans la même salle — et la base n'accepte qu'une exception par
   * cours et par jour. Le cas était donc inexprimable, et le second
   * changement partait en silence.
   *
   * Le genre ne dit plus que la mention à afficher.
   */
  return {
    ...entry,
    ...(exception.roomCode ? { room: exception.roomCode } : {}),
    ...(exception.teacherName ? { teacher: exception.teacherName } : {}),
    change,
    ...(note ? { note } : {}),
  };
}

/** Jour ISO à partir d'une date civile, sans passer par un fuseau. */
export function isoDayOfWeek(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  // On construit la date en UTC : on ne veut ni décalage ni heure d'été,
  // c'est une date civile, pas un instant.
  const utc = Date.UTC(year!, month! - 1, day!);
  const jsDay = new Date(utc).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Semaine A ou B, comptée depuis l'ancrage de l'année scolaire.
 *
 * Renvoie `null` quand l'établissement ne fonctionne pas en quinzaine — et
 * dans ce cas les cours marqués A ou B s'affichent tous, faute de mieux : un
 * réglage manquant ne doit pas vider un écran.
 */
export function weekParityOn(date: string, year: SchoolYear | null): "A" | "B" | null {
  if (!year?.parityAnchor) return null;
  const weeks = Math.floor(daysBetween(year.parityAnchor, date) / 7);
  return weeks % 2 === 0 ? "A" : "B";
}

function matchesParity(lessonParity: WeekParity, dayParity: "A" | "B" | null): boolean {
  if (lessonParity === "all") return true;
  if (dayParity === null) return true;
  return lessonParity === dayParity;
}

function daysBetween(from: string, to: string): number {
  const parse = (value: string) => {
    const [y, m, d] = value.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.floor((parse(to) - parse(from)) / 86_400_000);
}

/** Date du jour dans le fuseau de l'école, au format AAAA-MM-JJ. */
export function todayIn(timezone: string, nowMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
  return parts;
}
