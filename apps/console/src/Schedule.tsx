import { useState } from "react";
import type { DisplayOffWindow } from "./api.js";

/**
 * Les plages d'extinction de la dalle.
 *
 * Une dalle allumée la nuit et le week-end s'use et consomme pour personne.
 * Le rendu s'en charge côté écran, et un message d'urgence la rallume — on
 * n'éteint donc pas au risque de rater une alerte.
 *
 * Replié par défaut : c'est un réglage qu'on pose une fois par écran, pas
 * une décision de tous les jours. L'afficher en permanence encombrerait le
 * parcours quotidien.
 */

const DAYS = [
  { value: 1, label: "L" },
  { value: 2, label: "M" },
  { value: 3, label: "M" },
  { value: 4, label: "J" },
  { value: 5, label: "V" },
  { value: 6, label: "S" },
  { value: 7, label: "D" },
] as const;

const NOMS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** « L, M, M, J et V » plutôt que « 1,2,3,4,5 ». */
function describeDays(days: number[]): string {
  if (days.length === 0) return "aucun jour";
  if (days.length === 7) return "tous les jours";
  const sorted = [...days].sort((a, b) => a - b).map((d) => NOMS[d]);
  if (sorted.length === 1) return `le ${sorted[0]}`;
  return `les ${sorted.slice(0, -1).join(", ")} et ${sorted.at(-1)}`;
}

export function Schedule({
  windows,
  onChange,
}: {
  windows: DisplayOffWindow[];
  onChange: (next: DisplayOffWindow[]) => void;
}) {
  /**
   * `null` tant que personne n'a cliqué : la section suit alors le contenu.
   *
   * Un simple `useState(windows.length > 0)` se figerait sur la valeur du
   * premier rendu — et comme la composition arrive du serveur APRÈS le
   * montage, un écran qui s'éteint tous les soirs se présenterait replié,
   * sans rien laisser voir de sa programmation.
   */
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? windows.length > 0;

  function update(index: number, patch: Partial<DisplayOffWindow>) {
    onChange(windows.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  return (
    <div className="reglage">
      <button
        type="button"
        className="reglage-depliant"
        aria-expanded={open}
        onClick={() => setManual(!open)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        Extinction automatique
        {windows.length > 0 && (
          <span className="reglage-compte">
            {windows.length === 1
              ? `${windows[0]!.from} – ${windows[0]!.to}`
              : `${windows.length} plages`}
          </span>
        )}
      </button>

      {open && (
        <div className="reglage-corps">
          {windows.length === 0 ? (
            <p className="reglage-note">
              La dalle reste allumée en permanence. Ajoutez une plage pour l'éteindre la nuit ou le
              week-end.
            </p>
          ) : (
            windows.map((window, index) => (
              <div className="plage" key={index}>
                <div className="jours-semaine">
                  {DAYS.map((day) => {
                    const selected = window.daysOfWeek.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        className={selected ? "jour-carre jour-carre--actif" : "jour-carre"}
                        aria-pressed={selected}
                        aria-label={NOMS[day.value]}
                        onClick={() =>
                          update(index, {
                            daysOfWeek: selected
                              ? window.daysOfWeek.filter((d) => d !== day.value)
                              : [...window.daysOfWeek, day.value],
                          })
                        }
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>

                <label className="inline">
                  de
                  <input
                    type="time"
                    value={window.from}
                    aria-label="Éteindre à partir de"
                    onChange={(e) => update(index, { from: e.target.value })}
                  />
                </label>
                <label className="inline">
                  à
                  <input
                    type="time"
                    value={window.to}
                    aria-label="Rallumer à"
                    onChange={(e) => update(index, { to: e.target.value })}
                  />
                </label>

                <button
                  type="button"
                  className="plage-retirer"
                  aria-label={`Retirer la plage ${index + 1}`}
                  onClick={() => onChange(windows.filter((_, i) => i !== index))}
                >
                  ✕
                </button>

                <p className="plage-resume">
                  {/* Les jours désignent le soir où la plage commence : une
                      extinction du vendredi soir court jusqu'au samedi matin.
                      Le dire évite de faire chercher pourquoi un écran est
                      noir un samedi à 7 h. */}
                  Éteint {describeDays(window.daysOfWeek)} à partir de {window.from}, jusqu'à{" "}
                  {window.to}
                  {window.to < window.from ? " le lendemain matin" : ""}.
                </p>
              </div>
            ))
          )}

          <div className="plage-actions">
            <button
              type="button"
              onClick={() =>
                onChange([...windows, { daysOfWeek: [1, 2, 3, 4, 5], from: "19:00", to: "07:30" }])
              }
            >
              Ajouter une plage
            </button>
          </div>

          {windows.length > 0 && (
            <span className="reglage-note">
              Un message d'urgence rallume l'écran, même pendant une plage.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
