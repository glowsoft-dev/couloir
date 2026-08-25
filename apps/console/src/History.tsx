import { useCallback, useEffect, useState } from "react";
import { type ManifestVersion, type ScreenStatus, api } from "./api.js";

/**
 * L'historique des publications d'un écran.
 *
 * Revenir en arrière ne réécrit rien : on republie l'ancien contenu sous une
 * nouvelle version. L'historique reste une suite de faits — « on est revenu
 * à ce contenu tel jour » — plutôt qu'un état qu'on remonterait en effaçant
 * ce qui s'est passé. C'est ce qui permet d'annuler une annulation.
 *
 * Replié par défaut : on ne consulte l'historique que lorsqu'on a un doute.
 */

function whenLabel(iso: string): string {
  const at = new Date(iso);
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const sameDay = at.toDateString() === new Date().toDateString();
  const heure = at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `aujourd'hui à ${heure}`;
  return `${at.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${heure}`;
}

/**
 * Qui a posé cette version, et ce qu'elle contenait.
 *
 * C'est ce qui permet de choisir entre trois versions d'une même journée.
 * Une version d'avant qu'on retienne l'auteur ne prétend pas en avoir un :
 * elle dit seulement ce qu'elle montrait.
 */
function détail(entry: ManifestVersion): string {
  return [entry.auteur, entry.contenu].filter(Boolean).join(" · ") || "contenu inconnu";
}

export function HistoryPanel({
  screen,
  ouvertParDefaut = false,
  onRestored,
}: {
  screen: ScreenStatus;
  /**
   * Ouvert d'emblée après un retour en arrière.
   *
   * Republier remonte l'éditeur tout entier, et l'historique s'y refermait
   * avec lui : on cliquait « Remettre en ligne » et le panneau disparaissait
   * sans rien confirmer. Il se rouvre donc sur la version qui vient d'être
   * créée — c'est exactement ce qu'on voulait vérifier.
   */
  ouvertParDefaut?: boolean;
  onRestored: () => void;
}) {
  const [open, setOpen] = useState(ouvertParDefaut);
  const [versions, setVersions] = useState<ManifestVersion[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setVersions((await api.history(screen.id)).versions);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [screen.id]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function restore(version: number) {
    if (!globalThis.confirm(`Remettre en ligne la version ${version} sur ${screen.code} ?`)) return;
    setBusy(version);
    try {
      await api.restore(screen.id, version);
      await load();
      onRestored();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const [current, ...past] = versions;

  return (
    <section className="panel">
      <header>
        <button
          type="button"
          className="disclosure"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          Historique des publications
        </button>
        <span className="spacer" />
        <span className="pill">{screen.label}</span>
      </header>

      {open && (
        <div className="body">
          {error && <p className="notice error">{error}</p>}

          {versions.length === 0 && !error && (
            <p className="hint">Rien n'a encore été publié sur cet écran.</p>
          )}

          {/* L'avertissement AVANT la liste : il lève l'hésitation au moment
              où on hésite, et non après avoir cliqué. */}
          {past.length > 0 && (
            <p className="hint histo-avant">
              Remettre une version en ligne en crée une nouvelle. Rien n'est effacé, et
              l'opération s'annule elle-même.
            </p>
          )}

          {current && (
            <ul className="history">
              <li className="history-row current">
                <span className="index">v{current.version}</span>
                <span className="title">
                  {whenLabel(current.issuedAt)}
                  <span className="histo-detail">{détail(current)}</span>
                </span>
                <span className="pill accent">en ligne</span>
              </li>
              {past.map((entry) => (
                <li className="history-row" key={entry.version}>
                  <span className="index">v{entry.version}</span>
                  <span className="title">
                    {whenLabel(entry.issuedAt)}
                    <span className="histo-detail">{détail(entry)}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void restore(entry.version)}
                  >
                    {busy === entry.version ? "…" : "Remettre en ligne"}
                  </button>
                </li>
              ))}
            </ul>
          )}

        </div>
      )}
    </section>
  );
}
