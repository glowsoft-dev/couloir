import { useCallback, useEffect, useState } from "react";
import { PublishPanel } from "./Publish.js";
import { PendingPanel, ScreenList } from "./Screens.js";
import {
  ApiError,
  type PendingDevice,
  type ScreenStatus,
  api,
  forgetToken,
  storeToken,
  storedToken,
} from "./api.js";

/**
 * La console.
 *
 * Deux colonnes : le parc à gauche, ce qu'on lui envoie à droite. Le parc se
 * rafraîchit tout seul — un écran qui tombe doit se voir sans qu'on pense à
 * recharger la page.
 */
export function App() {
  const [authenticated, setAuthenticated] = useState(storedToken() !== null);
  const [screens, setScreens] = useState<ScreenStatus[]>([]);
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await api.screens();
      setScreens(result.screens);
      setPending(result.pending);
      setError(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        forgetToken();
        setAuthenticated(false);
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void refresh();
    // Cinq secondes : un écran qui tombe se voit dans la foulée sans que la
    // page ait besoin d'être rechargée.
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  }, [authenticated, refresh]);

  if (!authenticated) return <Gate onAuthenticated={() => setAuthenticated(true)} />;

  const selected = screens.find((screen) => screen.id === selectedId) ?? null;

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">
          Couloir <span>console</span>
        </span>
        <span className="pill">{screens.filter((s) => s.online).length} en ligne</span>
        {screens.some((s) => !s.online) && (
          <span className="pill warn">{screens.filter((s) => !s.online).length} muets</span>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="ghost"
          onClick={() => {
            forgetToken();
            setAuthenticated(false);
          }}
        >
          Se déconnecter
        </button>
      </div>

      <div className="layout">
        <div>
          {error && <p className="notice error">{error}</p>}
          <ScreenList screens={screens} selectedId={selectedId} onSelect={(s) => setSelectedId(s.id)} />
          <PendingPanel pending={pending} onPaired={() => void refresh()} />
        </div>

        <div>
          {selected ? (
            <PublishPanel screen={selected} onPublished={() => void refresh()} />
          ) : (
            <section className="panel">
              <header>
                <h2>Publication</h2>
              </header>
              <p className="empty">Choisissez un écran à gauche.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Gate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    storeToken(token.trim());
    try {
      // On vérifie tout de suite plutôt que de laisser découvrir l'erreur
      // au premier clic utile.
      await api.screens();
      onAuthenticated();
    } catch (cause) {
      forgetToken();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="gate" onSubmit={submit}>
      <h1>Couloir</h1>
      <p>Console de pilotage des écrans.</p>

      {error && <p className="notice error">{error}</p>}

      <div className="field">
        <label htmlFor="token">Jeton d'accès</label>
        <input
          id="token"
          type="password"
          value={token}
          autoComplete="off"
          onChange={(e) => setToken(e.target.value)}
        />
      </div>

      <button type="submit" className="primary" disabled={!token.trim() || busy}>
        {busy ? "Vérification…" : "Entrer"}
      </button>

      <p className="hint">
        Jeton partagé, défini par <span className="mono">COULOIR_CONSOLE_TOKEN</span> sur le serveur.
        Les comptes nominatifs viendront.
      </p>
    </form>
  );
}
