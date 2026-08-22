/**
 * Le modèle d'emploi du temps.
 *
 * On saisit une grille qui se répète, puis on la corrige au jour le jour.
 * C'est ainsi que fonctionne un établissement : l'ossature bouge deux fois
 * par an, les exceptions tombent tous les matins.
 *
 * Ce paquet ne calcule rien — il décrit. Le calcul est dans `engine.ts`, et
 * il est pur : c'est ce qui permet de rejouer une année scolaire entière
 * dans un test.
 */

/** Un créneau de la grille horaire. « M1 », 8 h 00 – 8 h 55. */
export interface Period {
  id: string;
  label: string;
  startsAt: string;
  endsAt: string;
  /** Ordre d'affichage dans la journée. */
  position: number;
}

export interface SchoolClass {
  id: string;
  /** Code court, celui qu'on tape : « TG1 ». */
  code: string;
  /** Libellé affiché à l'écran : « Terminale G1 ». */
  label: string;
  level: string | null;
}

export interface Subject {
  id: string;
  code: string;
  label: string;
}

export interface Teacher {
  id: string;
  /** Tel qu'affiché en public : « M. Dupont », jamais le nom complet. */
  displayName: string;
}

export interface Room {
  id: string;
  code: string;
  label: string | null;
}

/**
 * Quinzaine : certaines matières n'ont lieu qu'une semaine sur deux.
 *
 * `all` couvre le cas courant. Traiter la quinzaine dès le modèle coûte un
 * champ ; l'ajouter après coup demanderait de reprendre chaque cours saisi.
 */
export type WeekParity = "all" | "A" | "B";

/** Un cours récurrent de la grille. */
export interface Lesson {
  id: string;
  classId: string;
  subjectLabel: string;
  teacherName: string | null;
  roomCode: string;
  /** 1 = lundi … 7 = dimanche. */
  dayOfWeek: number;
  periodId: string;
  weekParity: WeekParity;
  /** Bornes de validité : un cours peut s'arrêter en cours d'année. */
  startsOn: string | null;
  endsOn: string | null;
}

export type ExceptionKind = "cancelled" | "room" | "teacher" | "added";

/**
 * Un changement daté.
 *
 * C'est la partie qui a le plus de valeur sur un écran de couloir, et celle
 * que les logiciels d'emploi du temps exportent le plus mal. La saisie doit
 * tenir en dix secondes.
 */
export interface Exception {
  id: string;
  /** AAAA-MM-JJ, heure locale de l'école. */
  date: string;
  kind: ExceptionKind;
  /** Le cours visé. Absent pour un cours ajouté. */
  lessonId: string | null;
  /** Toujours renseigné : c'est ce qui rattache l'exception à une classe. */
  classId: string;
  /** Pour un ajout ou un déplacement. */
  periodId: string | null;
  subjectLabel: string | null;
  teacherName: string | null;
  roomCode: string | null;
  note: string | null;
}

/** Vacances et jours fériés. Bornes incluses. */
export interface Holiday {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
}

/**
 * Le point de référence des semaines A et B.
 *
 * La parité se compte à partir d'une date d'ancrage plutôt que du numéro de
 * semaine ISO : les établissements ne s'accordent pas sur le point de départ,
 * et une année qui commence en semaine B n'a rien d'exceptionnel.
 */
export interface SchoolYear {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  /** Lundi de la première semaine A. */
  parityAnchor: string | null;
}
