import { useCallback, useEffect, useMemo, useState } from "react";
import { DAYS, type Lesson, type Period, type TimetableSetup, api } from "./api.js";

/**
 * L'éditeur de grille.
 *
 * Une année scolaire se saisit à la main : plusieurs centaines de cours. Tout
 * ici est réglé pour que ça reste supportable — on clique une case, on tape
 * trois champs, on valide, et la case suivante est déjà prête. Aucune boîte
 * de dialogue, aucun aller-retour de page.
 *
 * Le raccourci qui change tout : **dupliquer un cours sur les autres jours**.
 * Une matière revient rarement une seule fois par semaine.
 */

export function GridView({
  setup,
  externe = false,
  onChanged,
}: {
  setup: TimetableSetup;
  /** Vrai quand les écrans lisent un logiciel externe, pas cette grille. */
  externe?: boolean;
  onChanged: () => void;
}) {
  const [classId, setClassId] = useState(setup.classes[0]?.id ?? "");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [editing, setEditing] = useState<{ dayOfWeek: number; period: Period; lesson?: Lesson } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!classId) return;
    try {
      setLessons((await api.timetable.lessons(classId)).lessons);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Les jours affichés suivent la grille : pas de colonne samedi si personne
  // n'y a jamais mis un cours.
  const days = useMemo(() => {
    const used = new Set(lessons.map((l) => l.dayOfWeek));
    return DAYS.filter((day) => day.value <= 5 || used.has(day.value));
  }, [lessons]);

  const at = (dayOfWeek: number, periodId: string) =>
    lessons.find((l) => l.dayOfWeek === dayOfWeek && l.periodId === periodId);

  if (setup.periods.length === 0) {
    return (
      <div className="grille">
        <header className="grille-tete">
          <div>
            <h1>Emploi du temps</h1>
            <p>Aucun créneau : il n'y a nulle part où poser un cours.</p>
          </div>
        </header>
        <p className="grille-amorce">
          Définissez d'abord la grille horaire dans <strong>Réglages</strong> — les heures de début
          et de fin de chaque créneau. Toute la semaine s'y accroche.
        </p>
      </div>
    );
  }

  const aujourdHui = new Date(`${setup.today}T12:00:00`).getDay() || 7;

  return (
    <div className="grille">
      <header className="grille-tete">
        <div>
          <h1>Emploi du temps</h1>
          <p>
            Grille hebdomadaire · {lessons.length} cours saisis pour cette classe
          </p>
        </div>
        <div className="grille-source">
          <select
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setEditing(null);
            }}
            aria-label="Classe"
          >
            {setup.classes.map((schoolClass) => (
              <option key={schoolClass.id} value={schoolClass.id}>
                {schoolClass.label}
              </option>
            ))}
          </select>
          {/* D'où vient ce que les écrans affichent. Quand un logiciel externe
              alimente les couloirs, cette grille ne les atteint pas — le dire
              ici évite d'y saisir une année pour rien. */}
          <span className={externe ? "grille-origine grille-origine--externe" : "grille-origine"}>
            {externe ? "alimenté par NetYPareo" : "alimenté à la main"}
          </span>
        </div>
      </header>

      {error && <p className="notice error">{error}</p>}

      <div className="grille-corps">
        <div className="grille-cadre">
          <table className="grille-semaine">
            <thead>
              <tr>
                <th />
                {days.map((day) => (
                  <th
                    key={day.value}
                    scope="col"
                    className={day.value === aujourdHui ? "grille-jour grille-jour--aujourdhui" : "grille-jour"}
                  >
                    {day.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {setup.periods.map((period) => (
                <tr key={period.id}>
                  <th scope="row" className="grille-creneau">
                    {period.label}
                    <span>{period.startsAt}</span>
                  </th>
                  {days.map((day) => {
                    const lesson = at(day.value, period.id);
                    const ouvert =
                      editing?.dayOfWeek === day.value && editing.period.id === period.id;
                    return (
                      <td key={day.value}>
                        <button
                          type="button"
                          className={[
                            "case",
                            lesson ? "case--pleine" : "case--libre",
                            ouvert ? "case--ouverte" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          // Sans nom explicite, une case n'est qu'un bouton
                          // vide : impossible à situer autrement qu'à l'œil.
                          aria-label={
                            lesson
                              ? `${day.label} ${period.label}, ${lesson.subjectLabel} en ${lesson.roomCode}`
                              : `${day.label} ${period.label}, libre`
                          }
                          onClick={() =>
                            setEditing({ dayOfWeek: day.value, period, ...(lesson ? { lesson } : {}) })
                          }
                        >
                          {lesson ? (
                            <>
                              <span className="case-matiere">{lesson.subjectLabel}</span>
                              <span className="case-salle">{lesson.roomCode}</span>
                              {lesson.weekParity !== "all" && (
                                <span className="case-quinzaine">{lesson.weekParity}</span>
                              )}
                            </>
                          ) : (
                            <span className="case-plus">+</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editing ? (
          <LessonForm
            key={`${editing.dayOfWeek}-${editing.period.id}`}
            classId={classId}
            dayOfWeek={editing.dayOfWeek}
            period={editing.period}
            {...(editing.lesson ? { lesson: editing.lesson } : {})}
            days={days.map((d) => d.value)}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await load();
              onChanged();
            }}
          />
        ) : (
          <aside className="saisie saisie--vide">
            <p>Cliquez sur une case de la grille.</p>
            <p className="saisie-astuce">
              Une case pleine s'ouvre pour être corrigée, une case vide pour recevoir un cours.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

function LessonForm({
  classId,
  dayOfWeek,
  period,
  lesson,
  days,
  onCancel,
  onSaved,
}: {
  classId: string;
  dayOfWeek: number;
  period: Period;
  lesson?: Lesson;
  days: number[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [subject, setSubject] = useState(lesson?.subjectLabel ?? "");
  const [teacher, setTeacher] = useState(lesson?.teacherName ?? "");
  const [room, setRoom] = useState(lesson?.roomCode ?? "");
  const [parity, setParity] = useState<"all" | "A" | "B">(lesson?.weekParity ?? "all");
  const [alsoOn, setAlsoOn] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dayLabel = DAYS.find((d) => d.value === dayOfWeek)?.label ?? "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const shared = {
        classId,
        subjectLabel: subject.trim(),
        teacherName: teacher.trim() || null,
        roomCode: room.trim(),
        periodId: period.id,
        weekParity: parity,
      };
      await api.timetable.saveLesson({ ...shared, ...(lesson ? { id: lesson.id } : {}), dayOfWeek });

      // Le raccourci qui rend la saisie d'une année supportable : une matière
      // revient rarement une seule fois par semaine.
      for (const otherDay of alsoOn) {
        await api.timetable.saveLesson({ ...shared, dayOfWeek: otherDay }).catch(() => {
          // Créneau déjà pris ce jour-là : on n'écrase pas, on continue.
        });
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!lesson) return;
    setBusy(true);
    try {
      await api.timetable.deleteLesson(lesson.id);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const jours = days.filter((day) => day !== dayOfWeek);

  return (
    <aside className="saisie">
      <div className="saisie-tete">
        <span className="saisie-quand">
          {dayLabel} · {period.label}
        </span>
        <span className="saisie-heures">
          {period.startsAt} – {period.endsAt}
        </span>
      </div>

      <form className="saisie-forme" onSubmit={submit}>
        {error && <p className="notice error">{error}</p>}

        <div>
          <label htmlFor="subject">Matière</label>
          <input
            id="subject"
            className="saisie-vedette"
            value={subject}
            placeholder="Mathématiques"
            onChange={(e) => setSubject(e.target.value)}
            autoFocus
          />
        </div>

        <div className="saisie-paire">
          <div>
            <label htmlFor="teacher">Enseignant</label>
            <input
              id="teacher"
              value={teacher}
              placeholder="M. Dupont"
              onChange={(e) => setTeacher(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="room">Salle</label>
            <input id="room" value={room} placeholder="B 204" onChange={(e) => setRoom(e.target.value)} />
          </div>
        </div>

        <div>
          {/* Trois boutons plutôt qu'une liste déroulante : la quinzaine se
              lit d'un coup d'œil, et c'est ce qu'on relit en corrigeant. */}
          <label>Fréquence</label>
          <div className="saisie-frequence">
            {(
              [
                ["all", "Chaque semaine"],
                ["A", "A"],
                ["B", "B"],
              ] as const
            ).map(([valeur, libelle]) => (
              <button
                type="button"
                key={valeur}
                className={[
                  "frequence",
                  valeur === "all" ? "frequence--large" : "",
                  parity === valeur ? "frequence--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={parity === valeur}
                onClick={() => setParity(valeur)}
              >
                {libelle}
              </button>
            ))}
          </div>
        </div>

        {!lesson && jours.length > 0 && (
          <div>
            <label>Aussi ces jours-là</label>
            <div className="saisie-jours">
              {jours.map((day) => {
                const info = DAYS.find((d) => d.value === day)!;
                const selected = alsoOn.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    className={selected ? "jour-chip jour-chip--actif" : "jour-chip"}
                    aria-pressed={selected}
                    onClick={() =>
                      setAlsoOn((current) =>
                        current.includes(day)
                          ? current.filter((d) => d !== day)
                          : [...current, day],
                      )
                    }
                  >
                    {info.short}
                  </button>
                );
              })}
            </div>
            <p className="saisie-note">
              Même créneau, même matière. Les cases déjà prises sont laissées telles quelles.
            </p>
          </div>
        )}

        <div className="saisie-pied">
          <button type="submit" className="primary" disabled={!subject.trim() || busy}>
            {busy ? "Enregistrement…" : lesson ? "Modifier" : "Ajouter"}
          </button>
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          {lesson && (
            <button type="button" className="saisie-supprimer" onClick={() => void remove()}>
              Supprimer
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
