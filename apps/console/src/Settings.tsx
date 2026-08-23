import { Actualites } from "./Actualites.js";
import { useState } from "react";
import { type TimetableSetup, api } from "./api.js";

/**
 * Les réglages de l'établissement.
 *
 * Tout ce qui se saisit une fois par an : la grille horaire, les classes,
 * les vacances, l'année scolaire. On les regroupe ici plutôt que de les
 * disperser dans les écrans du quotidien, où ils n'auraient fait qu'ajouter
 * du bruit.
 */

export function SettingsView({ setup, onChanged }: { setup: TimetableSetup; onChanged: () => void }) {
  return (
    <>
      <div className="split">
        <div>
          <PeriodsPanel setup={setup} onChanged={onChanged} />
          <YearPanel setup={setup} onChanged={onChanged} />
        </div>
        <div>
          <ClassesPanel setup={setup} onChanged={onChanged} />
          <HolidaysPanel setup={setup} onChanged={onChanged} />
        </div>
      </div>
      {/* Sous la grille et non dedans : l'aperçu des articles a besoin de
          toute la largeur pour montrer ce que les écrans afficheront. */}
      <div style={{ marginTop: 20 }}>
        <Actualites />
      </div>
    </>
  );
}

function PeriodsPanel({ setup, onChanged }: { setup: TimetableSetup; onChanged: () => void }) {
  const [rows, setRows] = useState(
    setup.periods.length > 0
      ? setup.periods.map((p) => ({ label: p.label, startsAt: p.startsAt, endsAt: p.endsAt }))
      : [{ label: "M1", startsAt: "08:00", endsAt: "08:55" }],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    try {
      await api.timetable.savePeriods(rows);
      setMessage(`${rows.length} créneaux enregistrés.`);
      onChanged();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <header>
        <h2>Grille horaire</h2>
        <span className="spacer" />
        <span className="pill">{rows.length}</span>
      </header>

      <div className="body">
        {message && <p className="notice">{message}</p>}
        <p className="hint" style={{ marginBottom: 10 }}>
          Les créneaux de la journée, dans l'ordre. Ils s'appliquent à toutes les classes.
        </p>

        {rows.map((row, index) => (
          <div className="period-row" key={index}>
            <input
              value={row.label}
              aria-label="Nom du créneau"
              onChange={(e) =>
                setRows((r) => r.map((it, i) => (i === index ? { ...it, label: e.target.value } : it)))
              }
            />
            <input
              type="time"
              value={row.startsAt}
              aria-label="Début"
              onChange={(e) =>
                setRows((r) => r.map((it, i) => (i === index ? { ...it, startsAt: e.target.value } : it)))
              }
            />
            <input
              type="time"
              value={row.endsAt}
              aria-label="Fin"
              onChange={(e) =>
                setRows((r) => r.map((it, i) => (i === index ? { ...it, endsAt: e.target.value } : it)))
              }
            />
            <button
              type="button"
              className="ghost"
              aria-label={`Retirer le créneau ${row.label}`}
              onClick={() => setRows((r) => r.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={() => {
              const last = rows[rows.length - 1];
              setRows((r) => [
                ...r,
                { label: `C${r.length + 1}`, startsAt: last?.endsAt ?? "09:00", endsAt: "10:00" },
              ]);
            }}
          >
            Ajouter un créneau
          </button>
          <button type="button" className="primary" onClick={() => void save()} disabled={busy}>
            Enregistrer
          </button>
        </div>
        <p className="hint">
          Remplacer la grille ne supprime pas les cours, mais ceux dont le créneau disparaît ne
          s'afficheront plus.
        </p>
      </div>
    </section>
  );
}

function ClassesPanel({ setup, onChanged }: { setup: TimetableSetup; onChanged: () => void }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.timetable.saveClass({
        code: code.trim(),
        label: label.trim() || code.trim(),
        position: setup.classes.length + 1,
      });
      setCode("");
      setLabel("");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <header>
        <h2>Classes</h2>
        <span className="spacer" />
        <span className="pill">{setup.classes.length}</span>
      </header>

      <div className="body">
        {error && <p className="notice error">{error}</p>}

        {setup.classes.length === 0 ? (
          <p className="hint">Aucune classe. Ajoutez-en une pour commencer la saisie.</p>
        ) : (
          <div className="chips">
            {setup.classes.map((schoolClass) => (
              <span className="pill" key={schoolClass.id} title={schoolClass.label}>
                {schoolClass.code}
              </span>
            ))}
          </div>
        )}

        <form onSubmit={add} style={{ marginTop: 14 }}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="class-code">Code</label>
              <input id="class-code" value={code} placeholder="TG1" onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="class-label">Nom affiché</label>
              <input
                id="class-label"
                value={label}
                placeholder="Terminale G1"
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" disabled={!code.trim() || busy}>
            Ajouter la classe
          </button>
        </form>
        <p className="hint">Le nom affiché est celui que les élèves liront sur l'écran.</p>
      </div>
    </section>
  );
}

function HolidaysPanel({ setup, onChanged }: { setup: TimetableSetup; onChanged: () => void }) {
  const [rows, setRows] = useState(
    setup.holidays.map((h) => ({ label: h.label, startsOn: h.startsOn, endsOn: h.endsOn })),
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.timetable.saveHolidays(rows);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <header>
        <h2>Vacances et jours fériés</h2>
        <span className="spacer" />
        <span className="pill">{rows.length}</span>
      </header>

      <div className="body">
        <p className="hint" style={{ marginBottom: 10 }}>
          Ces jours-là, l'écran annonce la période au lieu d'afficher une liste vide.
        </p>

        {rows.map((row, index) => (
          <div className="holiday-row" key={index}>
            <input
              value={row.label}
              placeholder="Vacances de la Toussaint"
              aria-label="Libellé"
              onChange={(e) =>
                setRows((r) => r.map((it, i) => (i === index ? { ...it, label: e.target.value } : it)))
              }
            />
            <input
              type="date"
              value={row.startsOn}
              aria-label="Du"
              onChange={(e) =>
                setRows((r) => r.map((it, i) => (i === index ? { ...it, startsOn: e.target.value } : it)))
              }
            />
            <input
              type="date"
              value={row.endsOn}
              aria-label="Au"
              onChange={(e) =>
                setRows((r) => r.map((it, i) => (i === index ? { ...it, endsOn: e.target.value } : it)))
              }
            />
            <button
              type="button"
              className="ghost"
              aria-label="Retirer"
              onClick={() => setRows((r) => r.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={() =>
              setRows((r) => [...r, { label: "", startsOn: setup.today, endsOn: setup.today }])
            }
          >
            Ajouter une période
          </button>
          <button type="button" className="primary" onClick={() => void save()} disabled={busy}>
            Enregistrer
          </button>
        </div>
      </div>
    </section>
  );
}

function YearPanel({ setup, onChanged }: { setup: TimetableSetup; onChanged: () => void }) {
  const [label, setLabel] = useState(setup.year?.label ?? "2026-2027");
  const [startsOn, setStartsOn] = useState(setup.year?.startsOn ?? "2026-09-01");
  const [endsOn, setEndsOn] = useState(setup.year?.endsOn ?? "2027-07-04");
  const [anchor, setAnchor] = useState(setup.year?.parityAnchor ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.timetable.saveYear({ label, startsOn, endsOn, parityAnchor: anchor || null });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <header>
        <h2>Année scolaire</h2>
      </header>

      <div className="body">
        <div className="field">
          <label htmlFor="year-label">Libellé</label>
          <input id="year-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="year-start">Début</label>
            <input id="year-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="year-end">Fin</label>
            <input id="year-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="anchor">Premier lundi de semaine A</label>
          <input id="anchor" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
          <p className="hint">
            Laissez vide si l'établissement ne fonctionne pas en quinzaine. Sans cette date, les cours
            marqués A ou B s'affichent toutes les semaines.
          </p>
        </div>

        <button type="button" className="primary" onClick={() => void save()} disabled={busy}>
          Enregistrer
        </button>
      </div>
    </section>
  );
}
