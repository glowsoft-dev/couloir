import { useState } from "react";
import { type Emergency, api } from "./api.js";

/**
 * Le mode urgence.
 *
 * Accessible depuis n'importe quel onglet, parce qu'on ne l'atteint jamais
 * par un parcours prévu : quelqu'un entre en courant et il faut que ça parte.
 * Des modèles pré-rédigés évitent d'avoir à composer une phrase dans ce
 * moment-là.
 *
 * Le message ne disparaît jamais tout seul. Le retirer est une action
 * explicite — un écran qui se remettrait à afficher des actualités pendant
 * une évacuation serait pire que tout.
 */

const TEMPLATES = [
  {
    title: "Évacuation immédiate",
    body: "Rejoignez le point de rassemblement. N'utilisez pas les ascenseurs.",
  },
  {
    title: "Confinement",
    body: "Restez dans les salles. N'ouvrez ni portes ni fenêtres. Attendez les consignes.",
  },
  {
    title: "Fermeture exceptionnelle",
    body: "L'établissement ferme ses portes. Rejoignez la sortie principale.",
  },
] as const;

/**
 * Le bandeau d'une urgence en cours, en haut du rail.
 *
 * Il dit qui l'a déclenchée, quand, et sur combien d'écrans. Le « qui » n'est
 * pas décoratif : on cherche à qui demander avant de lever une évacuation. Le
 * compte non plus — un écran posé après le déclenchement, ou sans rien de
 * publié, ne l'a jamais reçue, et le silence sur ce point laisserait croire
 * que tout le parc l'affiche.
 */
export function UrgenceEnCours({
  urgence,
  ecrans,
  parc,
  onLevee,
}: {
  urgence: Emergency;
  ecrans: number;
  parc: number;
  onLevee: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function lever() {
    setBusy(true);
    try {
      await api.emergency.clear();
      onLevee();
    } finally {
      setBusy(false);
    }
  }

  const heure = new Date(urgence.issuedAt).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="urgence-bandeau">
      <span className="urgence-mention">Urgence en cours</span>
      <span className="urgence-titre">{urgence.title}</span>
      <span className="urgence-detail">
        déclenchée à {heure}
        {urgence.parQui ? ` par ${urgence.parQui}` : ""} ·{" "}
        {ecrans === parc
          ? `${ecrans} écran${ecrans > 1 ? "s" : ""}`
          : `${ecrans} écran${ecrans > 1 ? "s" : ""} sur ${parc}`}
      </span>
      <button type="button" className="urgence-lever" onClick={() => void lever()} disabled={busy}>
        {busy ? "Retrait…" : "Retirer le message"}
      </button>
    </div>
  );
}

export function EmergencyBar({
  active,
  onChanged,
}: {
  active: Emergency | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function clear() {
    setBusy(true);
    try {
      await api.emergency.clear();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="emergency-trigger" onClick={() => setOpen(true)}>
        Urgence
      </button>
      {open && (
        <EmergencyForm
          onCancel={() => setOpen(false)}
          onSent={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function EmergencyForm({ onCancel, onSent }: { onCancel: () => void; onSent: () => void }) {
  const [title, setTitle] = useState<string>(TEMPLATES[0].title);
  const [body, setBody] = useState<string>(TEMPLATES[0].body);
  const [result, setResult] = useState<{ applied: string[]; skipped: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const sent = await api.emergency.raise({ title: title.trim(), body: body.trim() });
      setResult({ applied: sent.applied, skipped: sent.skipped });
      onSent();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Message d'urgence">
      <div className="overlay-card">
        <h2>Message d'urgence</h2>
        <p className="hint">
          Il prendra tous les écrans en plein écran et n'en partira que sur votre action.
        </p>

        {error && <p className="notice error">{error}</p>}
        {result && (
          <p className="notice">
            Envoyé sur {result.applied.length} écran{result.applied.length > 1 ? "s" : ""}.
            {result.skipped.length > 0 &&
              ` ${result.skipped.length} sans contenu publié n'ont rien reçu : ${result.skipped.join(", ")}.`}
          </p>
        )}

        <div className="field">
          <label>Modèles</label>
          <div className="day-picker">
            {TEMPLATES.map((template) => (
              <button
                key={template.title}
                type="button"
                className="day-chip"
                aria-pressed={title === template.title}
                onClick={() => {
                  setTitle(template.title);
                  setBody(template.body);
                }}
              >
                {template.title}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="em-title">Titre</label>
          <input id="em-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="em-body">Consigne</label>
          <textarea id="em-body" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="danger" onClick={() => void send()} disabled={!title.trim() || busy}>
            {busy ? "Envoi…" : "Envoyer sur tous les écrans"}
          </button>
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
        </div>

        <p className="hint" style={{ marginTop: 12 }}>
          Les écrans l'appliqueront à leur prochaine synchronisation, dans la minute. Le canal temps
          réel, qui ramènerait ce délai à quelques secondes, reste à brancher.
        </p>
      </div>
    </div>
  );
}
