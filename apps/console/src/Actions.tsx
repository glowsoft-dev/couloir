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
 *
 * On ne confirme QUE ce qui est irréversible et coûteux : couper une dalle
 * ou redémarrer un boîtier laisse un couloir noir plusieurs minutes, et
 * personne n'est devant pour constater l'erreur. Le reste part sans
 * dialogue — une confirmation posée partout ne se lit plus nulle part.
 */

interface Action {
  kind: CommandKind;
  label: string;
  params?: Record<string, unknown>;
  danger?: boolean;
  /** Ce qu'on demande de confirmer, à la première personne du singulier. */
  confirm?: (screen: ScreenStatus) => string;
  /** Ce que fait le bouton, en clair, au survol comme au clavier. */
  hint: string;
}

const ACTIONS: Action[] = [
  {
    kind: "identify",
    label: "Identifier",
    params: { durationSec: 30 },
    hint: "Affiche le code et l'adresse de l'écran en grand pendant 30 secondes.",
  },
  {
    kind: "screenshot",
    label: "Capturer",
    hint: "Renvoie une image de ce que l'écran affiche réellement.",
  },
  {
    kind: "sync-now",
    label: "Synchroniser",
    hint: "Demande à l'écran d'aller chercher son contenu tout de suite.",
  },
  {
    kind: "display-power",
    label: "Éteindre la dalle",
    params: { on: false },
    danger: true,
    confirm: (screen) =>
      `Éteindre la dalle de ${screen.code} ? Le couloir restera noir jusqu'au prochain rallumage.`,
    hint: "Coupe l'affichage. Un message d'urgence le rallume.",
  },
  {
    kind: "clear-cache",
    label: "Vider le cache",
    hint: "Efface les médias téléchargés et les reprend depuis le serveur.",
  },
  {
    kind: "restart-app",
    label: "Relancer",
    danger: true,
    confirm: (screen) => `Relancer l'application de ${screen.code} ? L'écran sera noir quelques secondes.`,
    hint: "Redémarre le logiciel sans redémarrer la machine.",
  },
  {
    kind: "reboot",
    label: "Redémarrer",
    danger: true,
    confirm: (screen) =>
      `Redémarrer le boîtier de ${screen.code} ? Il sera injoignable une à deux minutes, et personne n'est sur place pour vérifier qu'il revient.`,
    hint: "Redémarre la machine entière.",
  },
];

export function ScreenActions({ screen }: { screen: ScreenStatus }) {
  const [busy, setBusy] = useState<CommandKind | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const [shot, setShot] = useState<string | null>(null);

  async function run(action: Action) {
    if (action.confirm && !globalThis.confirm(action.confirm(screen))) return;
    const { kind, params } = action;
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
              className={action.danger ? "ghost danger" : ""}
              title={action.hint}
              disabled={!screen.online || busy !== null}
              onClick={() => void run(action)}
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
