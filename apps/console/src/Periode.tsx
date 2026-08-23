import { useState } from "react";
import type { Visibility } from "./api.js";

/**
 * La période d'affichage d'un contenu.
 *
 * « Cette affiche du 1er au 15 septembre », « celle-là le matin seulement ».
 * L'affiche rejoint la rotation le temps voulu puis en sort d'elle-même :
 * personne n'a à penser à la retirer trois semaines après les portes
 * ouvertes.
 *
 * Repliée par défaut, et c'est délibéré : la plupart des contenus n'ont
 * aucune période, et le cas courant ne doit pas payer pour le cas rare. Un
 * résumé en toutes lettres remplace le formulaire quand il est fermé.
 */

const JOURS = [
  { valeur: 1, court: "L", nom: "lundi" },
  { valeur: 2, court: "M", nom: "mardi" },
  { valeur: 3, court: "M", nom: "mercredi" },
  { valeur: 4, court: "J", nom: "jeudi" },
  { valeur: 5, court: "V", nom: "vendredi" },
  { valeur: 6, court: "S", nom: "samedi" },
  { valeur: 7, court: "D", nom: "dimanche" },
] as const;

/**
 * Une date saisie devient un instant absolu.
 *
 * `<input type="date">` rend « 2026-09-15 », que `new Date()` interprète en
 * UTC. Un établissement qui écrit « jusqu'au 15 » veut dire jusqu'à la fin du
 * 15 chez lui : sans cette conversion, tout se décale de deux heures en été,
 * et l'affiche disparaît la veille au soir.
 */
export function débutDeJournée(date: string): string {
  const [a, m, j] = date.split("-").map(Number);
  return new Date(a!, m! - 1, j!, 0, 0, 0, 0).toISOString();
}

export function finDeJournée(date: string): string {
  const [a, m, j] = date.split("-").map(Number);
  // Minuit le lendemain : « jusqu'au 15 » inclut le 15 en entier.
  return new Date(a!, m! - 1, j! + 1, 0, 0, 0, 0).toISOString();
}

/** L'inverse, pour réafficher une période rouverte depuis le serveur. */
export function versDateLocale(iso: string, finDePériode = false): string {
  const d = new Date(iso);
  if (finDePériode) d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function joliJour(iso: string, finDePériode = false): string {
  const d = new Date(iso);
  if (finDePériode) d.setDate(d.getDate() - 1);
  const mois = d.toLocaleDateString("fr-FR", { month: "long" });
  // « le 1er septembre », pas « le 1 septembre ». Le détail qui distingue une
  // phrase écrite d'une phrase produite par une machine.
  return `${d.getDate() === 1 ? "1er" : d.getDate()} ${mois}`;
}

/** « du 1er au 15 septembre, en semaine, de 08:00 à 18:00 » */
export function résumé(v: Visibility | undefined): string | null {
  if (!v) return null;
  const morceaux: string[] = [];

  if (v.startsAt && v.endsAt) morceaux.push(`du ${joliJour(v.startsAt)} au ${joliJour(v.endsAt, true)}`);
  else if (v.startsAt) morceaux.push(`à partir du ${joliJour(v.startsAt)}`);
  else if (v.endsAt) morceaux.push(`jusqu'au ${joliJour(v.endsAt, true)}`);

  if (v.daysOfWeek?.length) {
    const noms = JOURS.filter((j) => v.daysOfWeek!.includes(j.valeur)).map((j) => j.nom);
    const enSemaine = v.daysOfWeek.length === 5 && v.daysOfWeek.every((d) => d <= 5);
    morceaux.push(
      enSemaine
        ? "en semaine"
        : noms.length === 1
          ? `le ${noms[0]}`
          : `les ${noms.slice(0, -1).join(", ")} et ${noms.at(-1)}`,
    );
  }

  if (v.dailyStart && v.dailyEnd) morceaux.push(`de ${v.dailyStart} à ${v.dailyEnd}`);

  return morceaux.length > 0 ? morceaux.join(", ") : null;
}

export function Periode({
  valeur,
  onChange,
  libellé,
}: {
  valeur: Visibility | undefined;
  onChange: (v: Visibility | undefined) => void;
  libellé: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const texte = résumé(valeur);

  function modifier(patch: Partial<Visibility>) {
    const suivant = { ...valeur, ...patch };
    // Un objet vide veut dire « aucune période » : on le rend indéfini plutôt
    // que de laisser un réglage fantôme dans la publication.
    const nonVide = Object.entries(suivant).some(([, v]) =>
      Array.isArray(v) ? v.length > 0 : Boolean(v),
    );
    onChange(nonVide ? suivant : undefined);
  }

  if (!ouvert) {
    return (
      <button
        type="button"
        className={texte ? "periode-resume" : "link periode-vide"}
        onClick={() => setOuvert(true)}
        title={texte ? `${libellé} : ${texte}` : "Limiter dans le temps"}
      >
        {texte ?? "Toujours"}
      </button>
    );
  }

  const heures = Boolean(valeur?.dailyStart && valeur?.dailyEnd);

  return (
    <div className="periode-editeur">
      <div className="periode-ligne">
        <label className="inline">
          du
          <input
            type="date"
            value={valeur?.startsAt ? versDateLocale(valeur.startsAt) : ""}
            aria-label={`${libellé} — à partir du`}
            onChange={(e) =>
              modifier({ startsAt: e.target.value ? débutDeJournée(e.target.value) : undefined })
            }
          />
        </label>
        <label className="inline">
          au
          <input
            type="date"
            value={valeur?.endsAt ? versDateLocale(valeur.endsAt, true) : ""}
            aria-label={`${libellé} — jusqu'au`}
            onChange={(e) =>
              modifier({ endsAt: e.target.value ? finDeJournée(e.target.value) : undefined })
            }
          />
        </label>
        <span className="hint">inclus</span>
      </div>

      <div className="periode-ligne">
        <div className="day-picker">
          {JOURS.map((jour) => {
            const choisi = valeur?.daysOfWeek?.includes(jour.valeur) ?? false;
            return (
              <button
                key={jour.valeur}
                type="button"
                className="day-chip"
                aria-pressed={choisi}
                aria-label={`${libellé} — ${jour.nom}`}
                onClick={() => {
                  const actuels = valeur?.daysOfWeek ?? [];
                  const suivants = choisi
                    ? actuels.filter((d) => d !== jour.valeur)
                    : [...actuels, jour.valeur].sort((a, b) => a - b);
                  modifier({ daysOfWeek: suivants.length > 0 ? suivants : undefined });
                }}
              >
                {jour.court}
              </button>
            );
          })}
        </div>
        <span className="hint">
          {valeur?.daysOfWeek?.length ? "" : "tous les jours"}
        </span>
      </div>

      <div className="periode-ligne">
        <label className="inline">
          <input
            type="checkbox"
            checked={heures}
            aria-label={`${libellé} — limiter à une plage horaire`}
            onChange={(e) =>
              modifier(
                e.target.checked
                  ? { dailyStart: "08:00", dailyEnd: "18:00" }
                  : { dailyStart: undefined, dailyEnd: undefined },
              )
            }
          />
          seulement de
        </label>
        <input
          type="time"
          value={valeur?.dailyStart ?? "08:00"}
          disabled={!heures}
          aria-label={`${libellé} — à partir de`}
          onChange={(e) => modifier({ dailyStart: e.target.value })}
        />
        <label className="inline">
          à
          <input
            type="time"
            value={valeur?.dailyEnd ?? "18:00"}
            disabled={!heures}
            aria-label={`${libellé} — jusqu'à`}
            onChange={(e) => modifier({ dailyEnd: e.target.value })}
          />
        </label>
      </div>

      <div className="periode-ligne">
        <span className="hint periode-phrase">
          {texte ? `Affichée ${texte}.` : "Affichée en permanence."}
        </span>
        <span className="spacer" />
        {texte && (
          <button type="button" className="link" onClick={() => onChange(undefined)}>
            Retirer la période
          </button>
        )}
        <button type="button" className="ghost" onClick={() => setOuvert(false)}>
          Fermer
        </button>
      </div>
    </div>
  );
}
