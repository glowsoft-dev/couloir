import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { API_PREFIX } from "@couloir/protocol";
import { todayIn } from "./engine.js";
import type { TimetableRepository } from "./repository.js";

/**
 * Les routes d'emploi du temps.
 *
 * Deux familles, et la distinction compte :
 *
 *   - sous `/v1/console/timetable`, la saisie. Protégée par le jeton de la
 *     console, comme le reste du pilotage.
 *   - sous `/v1/timetable`, la lecture par les écrans. C'est une source de
 *     données du manifeste : elle doit être joignable par un player, donc
 *     elle n'exige pas le jeton de la console.
 *
 * Ce qui sort par la seconde ne contient ni nom d'élève, ni information
 * personnelle : des matières, des salles, et le nom d'usage d'un enseignant
 * — exactement ce qui était déjà affiché sur les panneaux papier.
 */

const CONSOLE = `${API_PREFIX}/console/timetable` as const;
const PUBLIC = `${API_PREFIX}/timetable` as const;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Clock = z.string().regex(/^\d{2}:\d{2}$/);

const LessonBody = z.object({
  id: z.string().uuid().optional(),
  classId: z.string().uuid(),
  subjectLabel: z.string().min(1),
  teacherName: z.string().nullable().default(null),
  roomCode: z.string().default(""),
  dayOfWeek: z.number().int().min(1).max(7),
  periodId: z.string().uuid(),
  weekParity: z.enum(["all", "A", "B"]).default("all"),
  startsOn: IsoDate.nullable().default(null),
  endsOn: IsoDate.nullable().default(null),
});

const ExceptionBody = z.object({
  id: z.string().uuid().optional(),
  date: IsoDate,
  kind: z.enum(["cancelled", "room", "teacher", "added"]),
  lessonId: z.string().uuid().nullable().default(null),
  classId: z.string().uuid(),
  periodId: z.string().uuid().nullable().default(null),
  subjectLabel: z.string().nullable().default(null),
  teacherName: z.string().nullable().default(null),
  roomCode: z.string().nullable().default(null),
  note: z.string().max(120).nullable().default(null),
});

const ClassBody = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1).max(16),
  label: z.string().min(1),
  level: z.string().nullable().default(null),
  position: z.number().int().default(0),
});

const PeriodsBody = z.object({
  periods: z
    .array(z.object({ label: z.string().min(1), startsAt: Clock, endsAt: Clock }))
    .min(1)
    .max(20),
});

const HolidaysBody = z.object({
  holidays: z.array(z.object({ label: z.string().min(1), startsOn: IsoDate, endsOn: IsoDate })),
});

const YearBody = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1),
  startsOn: IsoDate,
  endsOn: IsoDate,
  parityAnchor: IsoDate.nullable().default(null),
});

export interface TimetableRoutesOptions {
  timetable: TimetableRepository;
  timezone?: string;
}

export function registerTimetableRoutes(app: FastifyInstance, options: TimetableRoutesOptions): void {
  const { timetable } = options;
  const timezone = options.timezone ?? "Europe/Paris";

  const invalid = (reply: FastifyReply, error: z.ZodError) =>
    reply.code(400).send({
      code: "invalid-body",
      message: "Saisie incomplète ou invalide.",
      retryable: false,
      details: error.flatten(),
    });

  // --- Lecture par les écrans -----------------------------------------

  /** La journée d'une classe. Source de données d'un écran « fixe ». */
  app.get<{ Params: { classId: string }; Querystring: { date?: string } }>(
    `${PUBLIC}/classes/:classId/day`,
    async (request, reply) => {
      const day = await timetable.dayFor(request.params.classId, request.query.date, timezone);
      if (!day) {
        return reply.code(404).send({ code: "unknown-class", message: "Classe inconnue.", retryable: false });
      }
      return day;
    },
  );

  /** Toutes les classes. Source d'un écran qui les fait défiler. */
  app.get<{ Querystring: { date?: string } }>(`${PUBLIC}/day`, async (request) => ({
    days: await timetable.allDays(request.query.date, timezone),
  }));

  // --- Saisie depuis la console ---------------------------------------

  app.get(`${CONSOLE}/setup`, async () => ({
    classes: await timetable.listClasses(),
    periods: await timetable.listPeriods(),
    holidays: await timetable.listHolidays(),
    year: await timetable.currentYear(),
    today: todayIn(timezone),
  }));

  app.get<{ Querystring: { classId?: string } }>(`${CONSOLE}/lessons`, async (request) => ({
    lessons: await timetable.listLessons(request.query.classId),
  }));

  app.post(`${CONSOLE}/lessons`, async (request, reply) => {
    const parsed = LessonBody.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      return { lesson: await timetable.upsertLesson(parsed.data) };
    } catch (error) {
      // Le cas courant : deux cours sur le même créneau pour une classe.
      return reply.code(409).send({
        code: "slot-taken",
        message: "Cette classe a déjà un cours sur ce créneau.",
        retryable: false,
        details: { error: String(error) },
      });
    }
  });

  app.delete<{ Params: { lessonId: string } }>(`${CONSOLE}/lessons/:lessonId`, async (request, reply) => {
    await timetable.deleteLesson(request.params.lessonId);
    return reply.code(204).send();
  });

  app.get<{ Querystring: { date?: string } }>(`${CONSOLE}/exceptions`, async (request) => ({
    date: request.query.date ?? todayIn(timezone),
    exceptions: await timetable.listExceptions(request.query.date ?? todayIn(timezone)),
  }));

  app.post(`${CONSOLE}/exceptions`, async (request, reply) => {
    const parsed = ExceptionBody.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);

    // Un ajout sans créneau n'a nulle part où s'afficher.
    if (parsed.data.kind === "added" && !parsed.data.periodId) {
      return reply.code(400).send({
        code: "missing-period",
        message: "Un cours ajouté doit indiquer son créneau.",
        retryable: false,
      });
    }
    if (parsed.data.kind !== "added" && !parsed.data.lessonId) {
      return reply.code(400).send({
        code: "missing-lesson",
        message: "Indiquez le cours concerné par ce changement.",
        retryable: false,
      });
    }

    return { exception: await timetable.upsertException(parsed.data) };
  });

  app.delete<{ Params: { exceptionId: string } }>(
    `${CONSOLE}/exceptions/:exceptionId`,
    async (request, reply) => {
      await timetable.deleteException(request.params.exceptionId);
      return reply.code(204).send();
    },
  );

  app.post(`${CONSOLE}/classes`, async (request, reply) => {
    const parsed = ClassBody.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      return { schoolClass: await timetable.upsertClass(parsed.data) };
    } catch (error) {
      return reply.code(409).send({
        code: "class-conflict",
        message: `Le code « ${parsed.data.code} » est déjà pris par une autre classe.`,
        retryable: false,
        details: { error: String(error) },
      });
    }
  });

  app.put(`${CONSOLE}/periods`, async (request, reply) => {
    const parsed = PeriodsBody.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const periods = parsed.data.periods.map((period, index) => ({ ...period, position: index + 1 }));
    return { periods: await timetable.replacePeriods(periods) };
  });

  app.put(`${CONSOLE}/holidays`, async (request, reply) => {
    const parsed = HolidaysBody.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    return { holidays: await timetable.replaceHolidays(parsed.data.holidays) };
  });

  app.put(`${CONSOLE}/year`, async (request, reply) => {
    const parsed = YearBody.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    return { year: await timetable.setCurrentYear(parsed.data) };
  });
}
