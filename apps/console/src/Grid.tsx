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

export function GridView({ setup, onChanged }: { setup: TimetableSetup; onChanged: () => void }) {
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
      <section className="panel">
        <header>
          <h2>Grille</h2>
        </header>
        <p className="empty">
          Définissez d'abord la grille horaire dans l'onglet Réglages : sans créneaux, il n'y a
          nulle part où poser un cours.
        </p>
      </section>
    );
  }

  return (
    <div className="split">
      <section className="panel">
        <header>
          <h2>Grille hebdomadaire</h2>
          <span className="spacer" />
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            style={{ width: 180 }}
            aria-label="Classe"
          >
            {setup.classes.map((schoolClass) => (
              <option key={schoolClass.id} value={schoolClass.id}>
                {schoolClass.label}
              </option>
            ))}
          </select>
        </header>

        <div className="body">
          {error && <p className="notice error">{error}</p>}

          <div className="grid-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th />
                  {days.map((day) => (
                    <th key={day.value}>{day.short}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {setup.periods.map((period) => (
                  <tr key={period.id}>
                    <th className="grid-period">
                      {period.label}
                      <br />
                      <span className="mono">{period.startsAt}</span>
                    </th>
                    {days.map((day) => {
                      const lesson = at(day.value, period.id);
                      return (
                        <td key={day.value}>
                          <button
                            type="button"
                            className={lesson ? "cell filled" : "cell"}
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
                                <span className="cell-subject">{lesson.subjectLabel}</span>
                                <span className="cell-room">{lesson.roomCode}</span>
                                {lesson.weekParity !== "all" && (
                                  <span className="cell-parity">{lesson.weekParity}</span>
                                )}
                              </>
                            ) : (
                              <span className="cell-empty">+</span>
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

          <p className="hint">
            {lessons.length} cours saisis pour cette classe.
          </p>
        </div>
      </section>

      <div>
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
          <section className="panel">
            <header>
              <h2>Saisie</h2>
            </header>
            <p className="empty">Cliquez sur une case de la grille.</p>
          </section>
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

  return (
    <section className="panel">
      <header>
        <h2>
          {dayLabel} · {period.label}
        </h2>
        <span className="spacer" />
        <span className="pill mono">
          {period.startsAt}–{period.endsAt}
        </span>
      </header>

      <form className="body" onSubmit={submit}>
        {error && <p className="notice error">{error}</p>}

        <div className="field">
          <label htmlFor="subject">Matière</label>
          <input
            id="subject"
            value={subject}
            placeholder="Mathématiques"
            onChange={(e) => setSubject(e.target.value)}
            autoFocus
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="teacher">Enseignant</label>
            <input
              id="teacher"
              value={teacher}
              placeholder="M. Dupont"
              onChange={(e) => setTeacher(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="room">Salle</label>
            <input id="room" value={room} placeholder="B 204" onChange={(e) => setRoom(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="parity">Fréquence</label>
          <select id="parity" value={parity} onChange={(e) => setParity(e.target.value as typeof parity)}>
            <option value="all">Toutes les semaines</option>
            <option value="A">Semaine A seulement</option>
            <option value="B">Semaine B seulement</option>
          </select>
        </div>

        {!lesson && (
          <div className="field">
            <label>Aussi ces jours-là</label>
            <div className="day-picker">
              {days
                .filter((day) => day !== dayOfWeek)
                .map((day) => {
                  const info = DAYS.find((d) => d.value === day)!;
                  const selected = alsoOn.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      className="day-chip"
                      aria-pressed={selected}
                      onClick={() =>
                        setAlsoOn((current) =>
                          selected ? current.filter((d) => d !== day) : [...current, day],
                        )
                      }
                    >
                      {info.short}
                    </button>
                  );
                })}
            </div>
            <p className="hint">Même créneau, même matière. Les cases déjà prises sont laissées telles quelles.</p>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="primary" disabled={!subject.trim() || busy}>
            {busy ? "Enregistrement…" : lesson ? "Modifier" : "Ajouter"}
          </button>
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          {lesson && (
            <button type="button" className="ghost" style={{ marginLeft: "auto" }} onClick={() => void remove()}>
              Supprimer
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
