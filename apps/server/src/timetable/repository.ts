import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import type { TimetableDay } from "@couloir/protocol";
import { resolveDay, todayIn } from "./engine.js";
import type { Exception, Holiday, Lesson, Period, SchoolClass, SchoolYear } from "./model.js";

/**
 * L'accès aux données d'emploi du temps.
 *
 * Le calcul reste dans `engine.ts` : ce dépôt ne fait que charger ce qu'il
 * faut et le lui passer. Une journée se calcule à partir de très peu de
 * lignes — la grille d'une classe tient en une trentaine de cours — donc on
 * charge et on calcule en mémoire plutôt que d'écrire une requête retorse
 * qui appliquerait les exceptions en SQL.
 */

export interface TimetableRepository {
  listClasses(): Promise<SchoolClass[]>;
  listPeriods(): Promise<Period[]>;
  currentYear(): Promise<SchoolYear | null>;

  listLessons(classId?: string): Promise<Lesson[]>;
  upsertLesson(lesson: Omit<Lesson, "id"> & { id?: string }): Promise<Lesson>;
  deleteLesson(lessonId: string): Promise<void>;

  listExceptions(date: string): Promise<Exception[]>;
  upsertException(exception: Omit<Exception, "id"> & { id?: string }): Promise<Exception>;
  deleteException(exceptionId: string): Promise<void>;

  listHolidays(): Promise<Holiday[]>;

  /** La journée d'une classe, prête à afficher. */
  dayFor(classId: string, date?: string, timezone?: string): Promise<TimetableDay | null>;
  /** Toutes les classes, dans l'ordre d'affichage. */
  allDays(date?: string, timezone?: string): Promise<TimetableDay[]>;

  upsertClass(input: Omit<SchoolClass, "id"> & { id?: string; position?: number }): Promise<SchoolClass>;
  replacePeriods(periods: Omit<Period, "id">[]): Promise<Period[]>;
  replaceHolidays(holidays: Omit<Holiday, "id">[]): Promise<Holiday[]>;
  setCurrentYear(input: Omit<SchoolYear, "id"> & { id?: string }): Promise<SchoolYear>;
}

export class PostgresTimetable implements TimetableRepository {
  constructor(private readonly sql: Sql) {}

  async listClasses(): Promise<SchoolClass[]> {
    const rows = await this.sql<
      { id: string; code: string; label: string; level: string | null }[]
    >`SELECT id, code, label, level FROM classes ORDER BY position, code`;
    return rows.map((row) => ({ id: row.id, code: row.code, label: row.label, level: row.level }));
  }

  async listPeriods(): Promise<Period[]> {
    const rows = await this.sql<
      { id: string; label: string; starts_at: string; ends_at: string; position: number }[]
    >`SELECT id, label, starts_at, ends_at, position FROM periods ORDER BY position`;
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      position: row.position,
    }));
  }

  async currentYear(): Promise<SchoolYear | null> {
    const rows = await this.sql<
      { id: string; label: string; starts_on: Date; ends_on: Date; parity_anchor: Date | null }[]
    >`SELECT id, label, starts_on, ends_on, parity_anchor FROM school_years WHERE is_current LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      label: row.label,
      startsOn: isoDate(row.starts_on),
      endsOn: isoDate(row.ends_on),
      parityAnchor: row.parity_anchor ? isoDate(row.parity_anchor) : null,
    };
  }

  async listLessons(classId?: string): Promise<Lesson[]> {
    const rows = classId
      ? await this.sql<LessonRow[]>`SELECT * FROM lessons WHERE class_id = ${classId}`
      : await this.sql<LessonRow[]>`SELECT * FROM lessons`;
    return rows.map(toLesson);
  }

  async upsertLesson(input: Omit<Lesson, "id"> & { id?: string }): Promise<Lesson> {
    const id = input.id ?? randomUUID();
    const rows = await this.sql<LessonRow[]>`
      INSERT INTO lessons (id, class_id, subject_label, teacher_name, room_code,
                           day_of_week, period_id, week_parity, starts_on, ends_on)
      VALUES (${id}, ${input.classId}, ${input.subjectLabel}, ${input.teacherName},
              ${input.roomCode}, ${input.dayOfWeek}, ${input.periodId}, ${input.weekParity},
              ${input.startsOn}, ${input.endsOn})
      ON CONFLICT (id) DO UPDATE SET
        subject_label = EXCLUDED.subject_label,
        teacher_name  = EXCLUDED.teacher_name,
        room_code     = EXCLUDED.room_code,
        day_of_week   = EXCLUDED.day_of_week,
        period_id     = EXCLUDED.period_id,
        week_parity   = EXCLUDED.week_parity,
        starts_on     = EXCLUDED.starts_on,
        ends_on       = EXCLUDED.ends_on
      RETURNING *
    `;
    return toLesson(rows[0]!);
  }

  async deleteLesson(lessonId: string): Promise<void> {
    await this.sql`DELETE FROM lessons WHERE id = ${lessonId}`;
  }

  async listExceptions(date: string): Promise<Exception[]> {
    const rows = await this.sql<ExceptionRow[]>`
      SELECT * FROM timetable_exceptions WHERE date = ${date}
    `;
    return rows.map(toException);
  }

  async upsertException(input: Omit<Exception, "id"> & { id?: string }): Promise<Exception> {
    const id = input.id ?? randomUUID();
    // Une seule exception par cours et par jour : la dernière saisie
    // remplace la précédente plutôt que de s'empiler.
    const rows = await this.sql<ExceptionRow[]>`
      INSERT INTO timetable_exceptions (id, date, kind, lesson_id, class_id, period_id,
                                        subject_label, teacher_name, room_code, note)
      VALUES (${id}, ${input.date}, ${input.kind}, ${input.lessonId}, ${input.classId},
              ${input.periodId}, ${input.subjectLabel}, ${input.teacherName},
              ${input.roomCode}, ${input.note})
      ON CONFLICT (date, lesson_id) WHERE lesson_id IS NOT NULL DO UPDATE SET
        kind = EXCLUDED.kind,
        period_id = EXCLUDED.period_id,
        subject_label = EXCLUDED.subject_label,
        teacher_name = EXCLUDED.teacher_name,
        room_code = EXCLUDED.room_code,
        note = EXCLUDED.note
      RETURNING *
    `;
    return toException(rows[0]!);
  }

  async deleteException(exceptionId: string): Promise<void> {
    await this.sql`DELETE FROM timetable_exceptions WHERE id = ${exceptionId}`;
  }

  async listHolidays(): Promise<Holiday[]> {
    const rows = await this.sql<{ id: string; label: string; starts_on: Date; ends_on: Date }[]>`
      SELECT id, label, starts_on, ends_on FROM holidays ORDER BY starts_on
    `;
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      startsOn: isoDate(row.starts_on),
      endsOn: isoDate(row.ends_on),
    }));
  }

  async dayFor(classId: string, date?: string, timezone = "Europe/Paris"): Promise<TimetableDay | null> {
    const classes = await this.listClasses();
    const schoolClass = classes.find((c) => c.id === classId);
    if (!schoolClass) return null;

    const target = date ?? todayIn(timezone);
    const [periods, lessons, exceptions, holidays, year] = await Promise.all([
      this.listPeriods(),
      this.listLessons(classId),
      this.listExceptions(target),
      this.listHolidays(),
      this.currentYear(),
    ]);

    return resolveDay({ date: target, schoolClass, periods, lessons, exceptions, holidays, year });
  }

  /**
   * Toutes les classes d'un coup.
   *
   * Un seul chargement pour tout le parc : un écran qui fait défiler trente
   * classes ne doit pas déclencher trente allers-retours en base.
   */
  async allDays(date?: string, timezone = "Europe/Paris"): Promise<TimetableDay[]> {
    const target = date ?? todayIn(timezone);
    const [classes, periods, lessons, exceptions, holidays, year] = await Promise.all([
      this.listClasses(),
      this.listPeriods(),
      this.listLessons(),
      this.listExceptions(target),
      this.listHolidays(),
      this.currentYear(),
    ]);

    return classes.map((schoolClass) =>
      resolveDay({ date: target, schoolClass, periods, lessons, exceptions, holidays, year }),
    );
  }

  async upsertClass(
    input: Omit<SchoolClass, "id"> & { id?: string; position?: number },
  ): Promise<SchoolClass> {
    const id = input.id ?? randomUUID();
    const rows = await this.sql<{ id: string; code: string; label: string; level: string | null }[]>`
      INSERT INTO classes (id, code, label, level, position)
      VALUES (${id}, ${input.code}, ${input.label}, ${input.level}, ${input.position ?? 0})
      ON CONFLICT (id) DO UPDATE SET
        code = EXCLUDED.code, label = EXCLUDED.label,
        level = EXCLUDED.level, position = EXCLUDED.position
      RETURNING id, code, label, level
    `;
    const row = rows[0]!;
    return { id: row.id, code: row.code, label: row.label, level: row.level };
  }

  /** La grille horaire se remplace en bloc : on ne la modifie pas au détail. */
  async replacePeriods(periods: Omit<Period, "id">[]): Promise<Period[]> {
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM periods`;
      for (const period of periods) {
        await tx`
          INSERT INTO periods (id, label, starts_at, ends_at, position)
          VALUES (${randomUUID()}, ${period.label}, ${period.startsAt}, ${period.endsAt}, ${period.position})
        `;
      }
    });
    return this.listPeriods();
  }

  async replaceHolidays(holidays: Omit<Holiday, "id">[]): Promise<Holiday[]> {
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM holidays`;
      for (const holiday of holidays) {
        await tx`
          INSERT INTO holidays (id, label, starts_on, ends_on)
          VALUES (${randomUUID()}, ${holiday.label}, ${holiday.startsOn}, ${holiday.endsOn})
        `;
      }
    });
    return this.listHolidays();
  }

  async setCurrentYear(input: Omit<SchoolYear, "id"> & { id?: string }): Promise<SchoolYear> {
    const id = input.id ?? randomUUID();
    await this.sql.begin(async (tx) => {
      await tx`UPDATE school_years SET is_current = false WHERE is_current`;
      await tx`
        INSERT INTO school_years (id, label, starts_on, ends_on, parity_anchor, is_current)
        VALUES (${id}, ${input.label}, ${input.startsOn}, ${input.endsOn}, ${input.parityAnchor}, true)
        ON CONFLICT (id) DO UPDATE SET
          label = EXCLUDED.label, starts_on = EXCLUDED.starts_on,
          ends_on = EXCLUDED.ends_on, parity_anchor = EXCLUDED.parity_anchor,
          is_current = true
      `;
    });
    return (await this.currentYear())!;
  }
}

interface LessonRow {
  id: string;
  class_id: string;
  subject_label: string;
  teacher_name: string | null;
  room_code: string;
  day_of_week: number;
  period_id: string;
  week_parity: "all" | "A" | "B";
  starts_on: Date | null;
  ends_on: Date | null;
}

interface ExceptionRow {
  id: string;
  date: Date;
  kind: Exception["kind"];
  lesson_id: string | null;
  class_id: string;
  period_id: string | null;
  subject_label: string | null;
  teacher_name: string | null;
  room_code: string | null;
  note: string | null;
}

function toLesson(row: LessonRow): Lesson {
  return {
    id: row.id,
    classId: row.class_id,
    subjectLabel: row.subject_label,
    teacherName: row.teacher_name,
    roomCode: row.room_code,
    dayOfWeek: row.day_of_week,
    periodId: row.period_id,
    weekParity: row.week_parity,
    startsOn: row.starts_on ? isoDate(row.starts_on) : null,
    endsOn: row.ends_on ? isoDate(row.ends_on) : null,
  };
}

function toException(row: ExceptionRow): Exception {
  return {
    id: row.id,
    date: isoDate(row.date),
    kind: row.kind,
    lessonId: row.lesson_id,
    classId: row.class_id,
    periodId: row.period_id,
    subjectLabel: row.subject_label,
    teacherName: row.teacher_name,
    roomCode: row.room_code,
    note: row.note,
  };
}

/** PostgreSQL rend un `Date` pour une colonne DATE : on reste en date civile. */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
