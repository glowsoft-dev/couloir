import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type ExceptionKind,
  type Lesson,
  type Period,
  type PreviewEntry,
  type SchoolClass,
  type TimetableException,
  type TimetableSetup,
  api,
  humanDate,
} from "./api.js";

/**
 * Les changements du jour.
 *
 * C'est l'écran du quotidien : tous les matins, quelqu'un ouvre ça, signale
 * trois absences et deux changements de salle, et repart. Tout y est réglé
 * pour la vitesse — la journée du jour est ouverte d'emblée, les cours sont
 * cliquables directement, et un changement se pose en deux clics.
 *
 * C'est aussi l'information qui a le plus de valeur dans un couloir : celle
 * que les logiciels d'emploi du temps exportent le plus mal.
 */

const KIND_LABELS: Record<ExceptionKind, string> = {
  cancelled: "Annulé",
  room: "Salle changée",
  teacher: "Remplacé",
  added: "Ajouté",
};

export function TodayView({ setup, onChanged }: { setup: TimetableSetup; onChanged: () => void }) {
  const [date, setDate] = useState(setup.today);
  const [classId, setClassId] = useState(setup.classes[0]?.id ?? "");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [exceptions, setExceptions] = useState<TimetableException[]>([]);
  const [preview, setPreview] = useState<PreviewEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ lesson: Lesson; period: Period } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const periodsById = useMemo(
    () => new Map(setup.periods.map((p) => [p.id, p])),
    [setup.periods],
  );

  const load = useCallback(async () => {
    if (!classId) return;
    try {
      const [lessonList, exceptionList, day] = await Promise.all([
        api.timetable.lessons(classId),
        api.timetable.exceptions(date),
        api.preview(classId, date),
      ]);
      setLessons(lessonList.lessons);
      setExceptions(exceptionList.exceptions.filter((e) => e.classId === classId));
      setPreview(day.entries);
      setNotice(day.notice ?? null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [classId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const dayOfWeek = new Date(`${date}T12:00:00`).getDay() || 7;
  const todaysLessons = lessons
    .filter((lesson) => lesson.dayOfWeek === dayOfWeek)
    .sort((a, b) => (periodsById.get(a.periodId)?.position ?? 0) - (periodsById.get(b.periodId)?.position ?? 0));

  async function removeException(exception: TimetableException) {
    await api.timetable.deleteException(exception.id);
    await load();
    onChanged();
  }

  return (
    <div className="split">
      <section className="panel">
        <header>
          <h2>Changements du jour</h2>
          <span className="spacer" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: 150 }}
            aria-label="Date"
          />
        </header>

        <div className="body">
          {error && <p className="notice error">{error}</p>}

          <div className="field">
            <label htmlFor="today-class">Classe</label>
            <select id="today-class" value={classId} onChange={(e) => setClassId(e.target.value)}>
              {setup.classes.map((schoolClass) => (
                <option key={schoolClass.id} value={schoolClass.id}>
                  {schoolClass.label}
                </option>
              ))}
            </select>
          </div>

          <p className="hint" style={{ marginBottom: 10 }}>
            {humanDate(date)} — cliquez sur un cours pour signaler un changement.
          </p>

          {todaysLessons.length === 0 ? (
            <p className="empty">Aucun cours ce jour-là pour cette classe.</p>
          ) : (
            todaysLessons.map((lesson) => {
              const period = periodsById.get(lesson.periodId);
              const exception = exceptions.find((e) => e.lessonId === lesson.id);
              return (
                <div className="lesson-row" key={lesson.id}>
                  <span className="mono time">{period?.startsAt ?? "--:--"}</span>
                  <span className="lesson-name">
                    {lesson.subjectLabel}
                    <br />
                    <span className="screen-label">
                      {lesson.roomCode}
                      {lesson.teacherName ? ` · ${lesson.teacherName}` : ""}
                    </span>
                  </span>

                  {exception ? (
                    <span className="applied">
                      <span className={`pill ${exception.kind === "cancelled" ? "signal" : "warn"}`}>
                        {exception.note ?? KIND_LABELS[exception.kind]}
                      </span>
                      <button
                        type="button"
                        className="ghost"
                        aria-label="Retirer ce changement"
                        onClick={() => void removeException(exception)}
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => period && setEditing({ lesson, period })}
                    >
                      Signaler
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      <div>
        {editing && (
          <ChangeForm
            date={date}
            lesson={editing.lesson}
            schoolClass={setup.classes.find((c) => c.id === classId)!}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await load();
              onChanged();
            }}
          />
        )}

        <ScreenPreview
          classLabel={setup.classes.find((c) => c.id === classId)?.label ?? ""}
          date={date}
          entries={preview}
          notice={notice}
        />
      </div>
    </div>
  );
}

function ChangeForm({
  date,
  lesson,
  schoolClass,
  onCancel,
  onSaved,
}: {
  date: string;
  lesson: Lesson;
  schoolClass: SchoolClass;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<ExceptionKind>("cancelled");
  const [room, setRoom] = useState("");
  const [teacher, setTeacher] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.timetable.saveException({
        date,
        kind,
        classId: schoolClass.id,
        lessonId: lesson.id,
        roomCode: kind === "room" ? room.trim() : null,
        teacherName: kind === "teacher" ? teacher.trim() : null,
        note: note.trim() || null,
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const ready =
    kind === "cancelled" ||
    kind === "added" ||
    (kind === "room" && room.trim()) ||
    (kind === "teacher" && teacher.trim());

  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <header>
        <h2>{lesson.subjectLabel}</h2>
        <span className="spacer" />
        <span className="pill">{schoolClass.code}</span>
      </header>

      <form className="body" onSubmit={submit}>
        {error && <p className="notice error">{error}</p>}

        <div className="field">
          <label htmlFor="kind">Que se passe-t-il ?</label>
          <select id="kind" value={kind} onChange={(e) => setKind(e.target.value as ExceptionKind)}>
            <option value="cancelled">Le cours est annulé</option>
            <option value="room">La salle change</option>
            <option value="teacher">L'enseignant est remplacé</option>
          </select>
        </div>

        {kind === "room" && (
          <div className="field">
            <label htmlFor="room">Nouvelle salle</label>
            <input id="room" value={room} placeholder="C 018" onChange={(e) => setRoom(e.target.value)} autoFocus />
          </div>
        )}

        {kind === "teacher" && (
          <div className="field">
            <label htmlFor="teacher">Qui remplace</label>
            <input
              id="teacher"
              value={teacher}
              placeholder="Mme Martin"
              onChange={(e) => setTeacher(e.target.value)}
              autoFocus
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="note">Mention affichée à l'écran</label>
          <input
            id="note"
            value={note}
            placeholder={KIND_LABELS[kind].toLowerCase()}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="hint">Laissez vide pour la mention par défaut.</p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="primary" disabled={!ready || busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * L'aperçu de ce que l'écran affichera.
 *
 * Volontairement dessiné comme le vrai rendu : on saisit un changement, on
 * le voit tout de suite tel que les élèves le verront. Sans ça il faudrait
 * aller dans un couloir pour vérifier une faute de frappe.
 */
function ScreenPreview({
  classLabel,
  date,
  entries,
  notice,
}: {
  classLabel: string;
  date: string;
  entries: PreviewEntry[];
  notice: string | null;
}) {
  return (
    <section className="panel">
      <header>
        <h2>Aperçu de l'écran</h2>
        <span className="spacer" />
        <span className="pill">{humanDate(date)}</span>
      </header>

      <div className="body">
        <div className="preview">
          <p className="preview-class">{classLabel}</p>
          {notice ? (
            <p className="preview-notice">{notice}</p>
          ) : (
            <ul className="preview-list">
              {entries.map((entry, index) => (
                <li
                  key={`${entry.time}-${index}`}
                  className={[
                    "preview-row",
                    entry.change !== "none" ? "preview-row--changed" : "",
                    entry.change === "cancelled" ? "preview-row--cancelled" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <time>{entry.time}</time>
                  <span>
                    {entry.subject}
                    {entry.note && <span className="preview-badge">{entry.note}</span>}
                  </span>
                  <span className="preview-room">{entry.room}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
