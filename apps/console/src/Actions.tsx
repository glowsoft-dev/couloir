import { useState } from "react";
import { type CommandKind, type ScreenStatus, api } from "./api.js";

/**
 * Les actions sur un écran.
 *
 * Chaque bouton passe par le canal de commandes et attend le compte rendu :
 * cliquer « Identifier » sans retour laisserait l'opérateur devant un écran
 * qui n'a peut-être rien fait.
 *
 * Un écran muet voit tous ses boutons grisés — inutile de faire patienter
 * quinze secondes pour une commande qui ne partira jamais.
 */

const ACTIONS: { kind: CommandKind; label: string; params?: Record<string, unknown>; danger?: boolean }[] = [
  { kind: "identify", label: "Identifier", params: { durationSec: 30 } },
  { kind: "screenshot", label: "Capturer" },
  { kind: "sync-now", label: "Synchroniser" },
  { kind: "display-power", label: "Éteindre la dalle", params: { on: false } },
  { kind: "clear-cache", label: "Vider le cache" },
  { kind: "restart-app", label: "Relancer", danger: true },
  { kind: "reboot", label: "Redémarrer", danger: true },
];

export function ScreenActions({ screen }: { screen: ScreenStatus }) {
  const [busy, setBusy] = useState<CommandKind | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const [shot, setShot] = useState<string | null>(null);

  async function run(kind: CommandKind, params?: Record<string, unknown>) {
    setBusy(kind);
    setFeedback(null);
    try {
      const { result } = await api.command(screen.id, kind, params);

      if (result.outcome === "unsupported") {
        // Pas une panne : cette plateforme ne sait pas faire, et on le dit.
        setFeedback({ text: result.message ?? "Non disponible sur ce boîtier.", error: true });
      } else if (result.outcome === "failed") {
        setFeedback({ text: result.message ?? "La commande a échoué.", error: true });
      } else {
        setFeedback({ text: result.message ?? "Fait." });
      }

      if (kind === "screenshot" && result.payload) setShot(result.payload);
    } catch (cause) {
      setFeedback({ text: cause instanceof Error ? cause.message : String(cause), error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <header>
        <h2>Actions sur {screen.code}</h2>
        <span className="spacer" />
        <span className={`pill ${screen.online ? "accent" : "warn"}`}>
          {screen.online ? "joignable" : "muet"}
        </span>
      </header>

      <div className="body">
        {feedback && <p className={`notice ${feedback.error ? "error" : ""}`}>{feedback.text}</p>}

        {!screen.online && (
          <p className="hint" style={{ marginBottom: 10 }}>
            Cet écran ne répond pas : aucune action ne peut lui parvenir.
          </p>
        )}

        <div className="actions">
          {ACTIONS.map((action) => (
            <button
              key={action.kind}
              type="button"
              className={action.danger ? "ghost" : ""}
              disabled={!screen.online || busy !== null}
              onClick={() => void run(action.kind, action.params)}
            >
              {busy === action.kind ? "…" : action.label}
            </button>
          ))}
        </div>

        {shot && (
          <div style={{ marginTop: 14 }}>
            <p className="hint" style={{ marginBottom: 6 }}>
              Ce que l'écran affiche réellement en ce moment.
            </p>
            <img className="shot" src={`data:image/png;base64,${shot}`} alt={`Écran ${screen.code}`} />
          </div>
        )}
      </div>
    </section>
  );
}
