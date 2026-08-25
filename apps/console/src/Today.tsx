import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type ExceptionKind,
  type Lesson,
  type Period,
  type PublishSpec,
  type ScreenStatus,
  type TimetableException,
  type TimetableSetup,
  api,
  humanDate,
} from "./api.js";
import { champsCommuns, ouCaSAffiche } from "./ouEdt.js";
import { manifesteApercuEdt, midiDe } from "./apercuEdt.js";
import { Vignette } from "./Vignette.js";

/**
 * Les changements du jour.
 *
 * C'est l'écran du quotidien : tous les matins, quelqu'un ouvre ça, signale
 * trois absences et deux changements de salle, et repart. Tout y est réglé
 * pour la vitesse — la journée du jour est ouverte d'emblée, les classes
 * sont des puces qu'on frappe au lieu d'une liste déroulante, et le
 * formulaire s'ouvre DANS la ligne du cours, jamais ailleurs.
 *
 * À droite, ce que les élèves liront, rendu par le vrai noyau d'affichage,
 * et la liste des écrans où ça paraîtra. Sans elle on signale une absence
 * sans savoir où elle va — et surtout sans savoir quand elle ne va nulle
 * part.
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

/**
 * Deux cas, pas trois.
 *
 * « La salle change » et « L'enseignant est remplacé » s'excluaient, alors
 * qu'une absence se règle souvent des deux côtés — quelqu'un remplace, et pas
 * dans la même salle. La base n'accepte qu'une exception par cours et par
 * jour : il fallait choisir lequel des deux changements on renonçait à dire.
 *
 * Le second choix ouvre donc les deux champs. On remplit ce qui change.
 */
const KINDS: { value: "cancelled" | "modifie"; label: string }[] = [
  { value: "cancelled", label: "Le cours est annulé" },
  { value: "modifie", label: "Le cours a lieu autrement" },
];

/** Le jour d'à côté, sans passer par un sélecteur de date. */
function decale(date: string, jours: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + jours);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TodayView({ setup, onChanged }: { setup: TimetableSetup; onChanged: () => void }) {
  const [date, setDate] = useState(setup.today);
  const [classId, setClassId] = useState(setup.classes[0]?.id ?? "");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  /** Toutes classes confondues : c'est ce qui alimente les compteurs. */
  const [exceptions, setExceptions] = useState<TimetableException[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parc, setParc] = useState<{
    screens: ScreenStatus[];
    compositions: Record<string, PublishSpec | null>;
  } | null>(null);
  const [identite, setIdentite] = useState<{ nom: string; accent: string | null } | null>(null);
  /** Bougé à chaque saisie : c'est ce qui fait relire la journée à l'aperçu. */
  const [version, setVersion] = useState(0);

  const periodsById = useMemo(() => new Map(setup.periods.map((p) => [p.id, p])), [setup.periods]);

  const load = useCallback(async () => {
    if (!classId) return;
    try {
      const [lessonList, exceptionList, day] = await Promise.all([
        api.timetable.lessons(classId),
        api.timetable.exceptions(date),
        api.preview(classId, date),
      ]);
      setLessons(lessonList.lessons);
      setExceptions(exceptionList.exceptions);
      setNotice(day.notice ?? null);
      setError(null);
      setVersion((n) => n + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [classId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Le parc, chargé une fois.
   *
   * Il ne change pas d'une minute à l'autre, et la page se recharge à chaque
   * saisie : le relire à chaque fois ferait deux requêtes de plus pour une
   * réponse identique.
   */
  useEffect(() => {
    void api
      .screens(false, true)
      .then((r) => setParc({ screens: r.screens, compositions: r.compositions ?? {} }))
      .catch(() => {});
    void api.identite
      .lire()
      .then((r) => setIdentite(r.identite))
      .catch(() => {});
  }, []);

  const dayOfWeek = new Date(`${date}T12:00:00`).getDay() || 7;
  const todaysLessons = lessons
    .filter((lesson) => lesson.dayOfWeek === dayOfWeek)
    .sort(
      (a, b) =>
        (periodsById.get(a.periodId)?.position ?? 0) - (periodsById.get(b.periodId)?.position ?? 0),
    );

  const parClasse = useMemo(() => {
    const compte = new Map<string, number>();
    for (const e of exceptions) compte.set(e.classId, (compte.get(e.classId) ?? 0) + 1);
    return compte;
  }, [exceptions]);

  const mesExceptions = exceptions.filter((e) => e.classId === classId);
  const ou = ouCaSAffiche(parc?.screens ?? [], parc?.compositions, classId);
  const champs = champsCommuns(ou.affiche.map((s) => parc?.compositions[s.id]));
  const classe = setup.classes.find((c) => c.id === classId);

  const manifeste = useMemo(
    () =>
      classId
        ? manifesteApercuEdt({
            classId,
            date,
            ...(identite?.nom ? { nom: identite.nom } : {}),
            ...(identite?.accent ? { accent: identite.accent } : {}),
            ...(champs ? { champs } : {}),
          })
        : null,
    [classId, date, identite, champs?.join(",")],
  );

  async function removeException(exception: TimetableException) {
    await api.timetable.deleteException(exception.id);
    await load();
    onChanged();
  }

  return (
    <div className="changements">
      <header className="changements-tete">
        <div>
          <h1>Changements du jour</h1>
          <p>{humanDate(date)} — cliquez sur un cours pour signaler ce qui change.</p>
        </div>
        <div className="changements-nav">
          {/* Forme fonctionnelle : deux clics rapprochés liraient sinon la
              même date, et n'avanceraient que d'un jour. */}
          <button type="button" onClick={() => setDate((d) => decale(d, -1))} aria-label="Jour précédent">
            ←
          </button>
          <button
            type="button"
            className={date === setup.today ? "changements-nav-actif" : ""}
            onClick={() => setDate(setup.today)}
          >
            Aujourd'hui
          </button>
          <button type="button" onClick={() => setDate((d) => decale(d, 1))} aria-label="Jour suivant">
            →
          </button>
        </div>
      </header>

      {error && <p className="notice error">{error}</p>}

      <div className="changements-classes">
        {setup.classes.map((schoolClass) => {
          const n = parClasse.get(schoolClass.id) ?? 0;
          const actif = schoolClass.id === classId;
          return (
            <button
              type="button"
              key={schoolClass.id}
              className={`puce-classe${actif ? " puce-classe--active" : ""}`}
              aria-pressed={actif}
              onClick={() => {
                setClassId(schoolClass.id);
                setEditing(null);
              }}
            >
              {schoolClass.label}
              {n > 0 && <span className="puce-compte">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="changements-grille">
        <div className="changements-cours">
          {notice ? (
            <p className="changements-vide">{notice}</p>
          ) : todaysLessons.length === 0 ? (
            <p className="changements-vide">Aucun cours ce jour-là pour cette classe.</p>
          ) : (
            todaysLessons.map((lesson) => {
              const period = periodsById.get(lesson.periodId);
              const exception = mesExceptions.find((e) => e.lessonId === lesson.id);
              const annule = exception?.kind === "cancelled";
              const ouvert = editing === lesson.id;

              return (
                <div
                  className={`ligne-cours${annule ? " ligne-cours--annule" : ""}${
                    ouvert ? " ligne-cours--ouvert" : ""
                  }${exception && !annule ? " ligne-cours--change" : ""}`}
                  key={lesson.id}
                >
                  <span className="ligne-heure">
                    {period?.startsAt ?? "--:--"}
                    <span>{period?.endsAt ?? ""}</span>
                  </span>

                  {ouvert ? (
                    <FormulaireChangement
                      date={date}
                      lesson={lesson}
                      classId={classId}
                      onCancel={() => setEditing(null)}
                      onSaved={async () => {
                        setEditing(null);
                        await load();
                        onChanged();
                      }}
                    />
                  ) : (
                    <span className="ligne-intitule">
                      <span className="ligne-matiere">{lesson.subjectLabel}</span>
                      <span className="ligne-lieu">
                        {/* Ce qui aura lieu, pas l'étiquette du changement :
                            la pastille dit déjà « remplacé », et la ligne
                            doit dire OÙ et AVEC QUI, comme sur l'écran. */}
                        {annule
                          ? (exception!.note ?? KIND_LABELS.cancelled)
                          : exception
                            ? [
                                exception.roomCode || lesson.roomCode,
                                exception.teacherName || lesson.teacherName,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : [lesson.roomCode, lesson.teacherName].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  )}

                  {ouvert ? (
                    <span />
                  ) : exception ? (
                    <span className="ligne-pose">
                      <span className={`etiquette${annule ? " etiquette--annule" : " etiquette--change"}`}>
                        {KIND_LABELS[exception.kind].toLowerCase()}
                      </span>
                      <button
                        type="button"
                        className="ligne-retirer"
                        aria-label="Retirer ce changement"
                        onClick={() => void removeException(exception)}
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="ligne-signaler" onClick={() => setEditing(lesson.id)}>
                      Signaler
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        <aside className="changements-apercu">
          <div className="changements-apercu-tete">
            <span>Ce que liront les élèves</span>
            <span className="changements-compte">
              {ou.affiche.length === 0
                ? "aucun écran"
                : `${ou.affiche.length} écran${ou.affiche.length > 1 ? "s" : ""} concerné${
                    ou.affiche.length > 1 ? "s" : ""
                  }`}
            </span>
          </div>

          <div className="changements-dalle">
            <Vignette
              manifest={manifeste}
              screenCode={classe?.code ?? ""}
              instantMs={midiDe(date)}
              sourcesVersion={version}
              vide="Rien à afficher ce jour-là"
            />
          </div>

          <div className="changements-ou">
            <span className="changements-ou-titre">Où ça s'affiche</span>
            {ou.affiche.length > 0 ? (
              <span className="changements-ou-liste">{ou.affiche.map((s) => s.label).join(" · ")}</span>
            ) : (
              <span className="changements-ou-liste changements-ou-liste--vide">
                Aucun écran ne montre l'emploi du temps de {classe?.label ?? "cette classe"}.
              </span>
            )}
            {ou.netypareo.length > 0 && (
              <p className="changements-ou-alerte">
                {ou.netypareo.length === 1 ? "Un écran lit" : `${ou.netypareo.length} écrans lisent`} leur
                colonne dans NetYPareo ({ou.netypareo.map((s) => s.label).join(", ")}) : ce changement ne
                les atteindra pas. Il faut le saisir dans NetYPareo.
              </p>
            )}
            <p className="changements-ou-note">
              Un changement part tout seul : les écrans relisent l'emploi du temps sans qu'on republie.
              Un cours annulé reste affiché, barré — c'est l'information qui intéresse le plus les élèves.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Le formulaire, posé dans la ligne du cours.
 *
 * Il remplace l'intitulé au lieu de s'ouvrir dans un panneau à côté : on
 * garde sous les yeux l'heure et les cours voisins, et on ne perd jamais de
 * vue lequel on est en train de modifier.
 */
function FormulaireChangement({
  date,
  lesson,
  classId,
  onCancel,
  onSaved,
}: {
  date: string;
  lesson: Lesson;
  classId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<"cancelled" | "modifie">("cancelled");
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
        kind: genreEnvoyé,
        classId,
        lessonId: lesson.id,
        // Les deux champs partent tels quels. Le genre ne sert plus qu'à
        // choisir la mention par défaut affichée sur les écrans.
        roomCode: kind === "cancelled" ? null : room.trim() || null,
        teacherName: kind === "cancelled" ? null : teacher.trim() || null,
        note: note.trim() || null,
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Le genre transmis, déduit de ce qui a été rempli.
   *
   * Il ne commande plus rien du rendu — le serveur applique tout ce qui est
   * renseigné — mais il choisit la mention par défaut, et l'enseignant
   * remplacé est ce qu'un élève cherche en premier quand les deux changent.
   */
  const genreEnvoyé: ExceptionKind =
    kind === "cancelled" ? "cancelled" : teacher.trim() ? "teacher" : "room";

  const ready = kind === "cancelled" || Boolean(room.trim() || teacher.trim());

  return (
    <form className="ligne-forme" onSubmit={submit}>
      <span className="ligne-matiere">
        {lesson.subjectLabel}
        <span className="ligne-lieu-inline">
          {[lesson.roomCode, lesson.teacherName].filter(Boolean).join(" · ")}
        </span>
      </span>

      <div className="ligne-choix">
        {KINDS.map((k) => (
          <button
            type="button"
            key={k.value}
            className={kind === k.value ? "choix choix--actif" : "choix"}
            aria-pressed={kind === k.value}
            onClick={() => setKind(k.value)}
          >
            {k.label}
          </button>
        ))}
      </div>

      {error && <p className="notice error">{error}</p>}

      <div className="ligne-champs">
        {kind === "modifie" && (
          <>
            <label className="champ-court">
              <span>Nouvelle salle</span>
              <input
                value={room}
                placeholder="C 018"
                onChange={(e) => setRoom(e.target.value)}
                autoFocus
              />
            </label>
            <label className="champ-court">
              <span>Qui remplace</span>
              <input
                value={teacher}
                placeholder="Mme Martin"
                onChange={(e) => setTeacher(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="champ-long">
          <span>Mention affichée à l'écran</span>
          <input
            value={note}
            // La mention proposée dit ce qui change réellement : « remplacé »
            // seul tairait un changement de salle posé en même temps.
            placeholder={
              kind === "cancelled"
                ? "annulé"
                : room.trim() && teacher.trim()
                  ? "salle et enseignant changés"
                  : KIND_LABELS[genreEnvoyé].toLowerCase()
            }
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
