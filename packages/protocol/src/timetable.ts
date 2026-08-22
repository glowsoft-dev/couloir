import { z } from "zod";

/**
 * L'emploi du temps, tel qu'il arrive à l'écran.
 *
 * C'est le contrat entre le serveur et le rendu, rien de plus : les classes,
 * les profs et les salles vivent côté serveur. L'écran ne reçoit que la
 * journée déjà calculée — vacances appliquées, semaine A ou B tranchée,
 * changements du jour intégrés.
 *
 * Ce découpage compte : un boîtier n'a pas à savoir ce qu'est une semaine
 * paire, et une règle de calendrier qui change ne demande aucune mise à jour
 * des écrans.
 */

/** Ce qui distingue une ligne des autres, et pourquoi elle est signalée. */
export const TimetableChange = z.enum([
  /** Rien de particulier. */
  "none",
  /** Le cours n'a pas lieu. On l'affiche quand même, barré : c'est l'information. */
  "cancelled",
  /** La salle a changé. */
  "room",
  /** L'enseignant est remplacé, ou absent. */
  "teacher",
  /** Cours ajouté ou déplacé sur ce créneau. */
  "added",
]);
export type TimetableChange = z.infer<typeof TimetableChange>;

export const TimetableEntry = z.object({
  /** Heure de début, en heure locale de l'école : « 08:00 ». */
  time: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  subject: z.string(),
  room: z.string(),
  teacher: z.string().optional(),
  change: TimetableChange.default("none"),
  /** Mention courte affichée en pastille : « salle changée », « annulé ». */
  note: z.string().optional(),
});
export type TimetableEntry = z.infer<typeof TimetableEntry>;

/**
 * La journée d'une classe.
 *
 * `notice` remplace la liste quand il n'y a rien à afficher — vacances, jour
 * férié, week-end. Un écran ne doit jamais laisser croire qu'il n'a pas
 * réussi à charger les cours alors qu'il n'y en a simplement pas.
 */
export const TimetableDay = z.object({
  classId: z.string(),
  classLabel: z.string(),
  /** Date résolue, en AAAA-MM-JJ, heure locale de l'école. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(TimetableEntry),
  notice: z.string().optional(),
});
export type TimetableDay = z.infer<typeof TimetableDay>;

/** Charge utile servie aux écrans qui font défiler plusieurs classes. */
export const TimetableFeed = z.object({
  days: z.array(TimetableDay),
});
export type TimetableFeed = z.infer<typeof TimetableFeed>;

/** Libellé lisible d'un changement, tel qu'il s'affiche en pastille. */
export function changeLabel(change: TimetableChange): string | null {
  switch (change) {
    case "none":
      return null;
    case "cancelled":
      return "annulé";
    case "room":
      return "salle changée";
    case "teacher":
      return "remplacé";
    case "added":
      return "ajouté";
  }
}
