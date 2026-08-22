import { useCallback, useEffect, useState } from "react";
import { ScreenActions } from "./Actions.js";
import { EmergencyBar } from "./Emergency.js";
import { GridView } from "./Grid.js";
import { PublishPanel } from "./Publish.js";
import { PendingPanel, ScreenList } from "./Screens.js";
import { SettingsView } from "./Settings.js";
import { TodayView } from "./Today.js";
import {
  ApiError,
  type Emergency,
  type PendingDevice,
  type ScreenStatus,
  type TimetableSetup,
  api,
  forgetToken,
  storeToken,
  storedToken,
} from "./api.js";

/**
 * La console d'administration.
 *
 * Un seul endroit pour tout piloter : les écrans, ce qu'ils affichent, et
 * l'emploi du temps qui les alimente. Servie par le serveur lui-même, donc
 * une seule adresse à retenir et un seul certificat à gérer.
 *
 * L'onglet par défaut est « Aujourd'hui » : c'est celui qu'on ouvre tous les
 * matins pour signaler trois absences, pas la configuration annuelle.
 */

type Tab = "today" | "screens" | "grid" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Aujourd'hui" },
  { id: "screens", label: "Écrans" },
  { id: "grid", label: "Grille" },
  { id: "settings", label: "Réglages" },
];

export function App() {
  const [authenticated, setAuthenticated] = useState(storedToken() !== null);
  const [tab, setTab] = useState<Tab>("today");
  const [screens, setScreens] = useState<ScreenStatus[]>([]);
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [setup, setSetup] = useState<TimetableSetup | null>(null);
  const [emergency, setEmergency] = useState<Emergency | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshScreens = useCallback(async () => {
    try {
      const result = await api.screens();
      setScreens(result.screens);
      setPending(result.pending);
      setEmergency((await api.emergency.current()).emergency);
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

  const refreshSetup = useCallback(async () => {
    try {
      setSetup(await api.timetable.setup());
    } catch {
      // L'emploi du temps n'est monté que si le serveur a une base : la
      // console reste utilisable pour les écrans sans lui.
      setSetup(null);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void refreshScreens();
    void refreshSetup();
    // Cinq secondes : un écran qui tombe se voit dans la foulée sans que la
    // page ait besoin d'être rechargée.
    const timer = setInterval(() => void refreshScreens(), 5_000);
    return () => clearInterval(timer);
  }, [authenticated, refreshScreens, refreshSetup]);

  if (!authenticated) return <Gate onAuthenticated={() => setAuthenticated(true)} />;

  const selected = screens.find((screen) => screen.id === selectedId) ?? null;
  const offline = screens.filter((s) => !s.online).length;

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">
          Couloir <span>console</span>
        </span>

        <nav className="tabs">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="tab"
              aria-current={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <span className="spacer" />
        <EmergencyBar active={emergency} onChanged={() => void refreshScreens()} />
        <span className="pill">{screens.length - offline} en ligne</span>
        {offline > 0 && <span className="pill warn">{offline} muets</span>}
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

      <div className="page">
        {error && <p className="notice error">{error}</p>}

        {tab === "screens" && (
          <div className="split">
            <div>
              <ScreenList screens={screens} selectedId={selectedId} onSelect={(s) => setSelectedId(s.id)} />
              <PendingPanel pending={pending} onPaired={() => void refreshScreens()} />
            </div>
            <div>
              {selected ? (
                <>
                  <ScreenActions screen={selected} />
                  <div style={{ marginTop: 20 }}>
                    <PublishPanel
                      screen={selected}
                      classes={setup?.classes ?? []}
                      onPublished={() => void refreshScreens()}
                    />
                  </div>
                </>
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
        )}

        {tab !== "screens" &&
          (setup ? (
            <>
              {tab === "today" && <TodayView setup={setup} onChanged={() => void refreshSetup()} />}
              {tab === "grid" && <GridView setup={setup} onChanged={() => void refreshSetup()} />}
              {tab === "settings" && <SettingsView setup={setup} onChanged={() => void refreshSetup()} />}
            </>
          ) : (
            <section className="panel">
              <header>
                <h2>Emploi du temps</h2>
              </header>
              <p className="empty">
                Indisponible : le serveur tourne sans base de données. Lancez-le avec PostgreSQL.
              </p>
            </section>
          ))}
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
