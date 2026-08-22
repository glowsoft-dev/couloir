-- L'emploi du temps.
--
-- Une grille qui se répète, corrigée au jour le jour. C'est ainsi que
-- fonctionne un établissement : l'ossature bouge deux fois par an, les
-- exceptions tombent tous les matins.

CREATE TABLE school_years (
  id             UUID PRIMARY KEY,
  label          TEXT NOT NULL,
  starts_on      DATE NOT NULL,
  ends_on        DATE NOT NULL,
  -- Lundi de la première semaine A. Nul si l'établissement ne fonctionne
  -- pas en quinzaine.
  parity_anchor  DATE,
  is_current     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Une seule année courante à la fois : sans ça, l'écran ne saurait pas
-- laquelle appliquer.
CREATE UNIQUE INDEX school_years_current_key ON school_years (is_current) WHERE is_current;

-- La grille horaire. « M1 », 8 h 00 – 8 h 55.
CREATE TABLE periods (
  id         UUID PRIMARY KEY,
  label      TEXT NOT NULL,
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  position   INTEGER NOT NULL
);
CREATE UNIQUE INDEX periods_position_key ON periods (position);

CREATE TABLE classes (
  id     UUID PRIMARY KEY,
  code   TEXT NOT NULL UNIQUE,
  label  TEXT NOT NULL,
  level  TEXT,
  -- Ordre d'affichage quand un écran fait défiler toutes les classes.
  position INTEGER NOT NULL DEFAULT 0
);

-- Matières, enseignants et salles sont dénormalisés dans `lessons` : la
-- saisie se fait au clavier, en texte libre, et imposer des référentiels
-- avant d'avoir la moindre grille ferait abandonner la personne qui saisit.
-- On les normalisera le jour où on en aura besoin, pas avant.

CREATE TABLE lessons (
  id             UUID PRIMARY KEY,
  class_id       UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_label  TEXT NOT NULL,
  teacher_name   TEXT,
  room_code      TEXT NOT NULL DEFAULT '',
  day_of_week    INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  period_id      UUID NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  week_parity    TEXT NOT NULL DEFAULT 'all' CHECK (week_parity IN ('all','A','B')),
  starts_on      DATE,
  ends_on        DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lessons_class_day_idx ON lessons (class_id, day_of_week);
-- Deux cours sur le même créneau pour la même classe, c'est une erreur de
-- saisie. La quinzaine reste permise : A et B ne se chevauchent pas.
CREATE UNIQUE INDEX lessons_slot_key ON lessons (class_id, day_of_week, period_id, week_parity);

CREATE TABLE timetable_exceptions (
  id             UUID PRIMARY KEY,
  date           DATE NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('cancelled','room','teacher','added')),
  -- Nul pour un cours ajouté : il n'a pas de ligne dans la grille.
  lesson_id      UUID REFERENCES lessons(id) ON DELETE CASCADE,
  class_id       UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  period_id      UUID REFERENCES periods(id) ON DELETE SET NULL,
  subject_label  TEXT,
  teacher_name   TEXT,
  room_code      TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX timetable_exceptions_lookup_idx ON timetable_exceptions (date, class_id);
-- Une seule exception par cours et par jour : la dernière saisie remplace
-- la précédente plutôt que de s'empiler.
CREATE UNIQUE INDEX timetable_exceptions_lesson_key
  ON timetable_exceptions (date, lesson_id) WHERE lesson_id IS NOT NULL;

-- Vacances et jours fériés. Bornes incluses.
CREATE TABLE holidays (
  id         UUID PRIMARY KEY,
  label      TEXT NOT NULL,
  starts_on  DATE NOT NULL,
  ends_on    DATE NOT NULL
);
CREATE INDEX holidays_range_idx ON holidays (starts_on, ends_on);
