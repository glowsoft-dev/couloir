import { useCallback, useEffect, useState } from "react";
import { ScreenActions } from "./Actions.js";
import { EmergencyBar } from "./Emergency.js";
import { GridView } from "./Grid.js";
import { MurDEcrans } from "./MurDEcrans.js";
import { HistoryPanel } from "./History.js";
import { PublishPanel } from "./Publish.js";
import { PendingPanel, ScreenList } from "./Screens.js";
import { SettingsView } from "./Settings.js";
import { TodayView } from "./Today.js";
import { Comptes } from "./Comptes.js";
import { Entree } from "./Entree.js";
import {
  ApiError,
  type Emergency,
  type PendingDevice,
  type ScreenStatus,
  type TimetableSetup,
  type Utilisateur,
  api,
  libelléDuRole,
  peutAdministrer,
  peutPublier,
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

type Tab = "today" | "screens" | "grid" | "settings" | "comptes";

/**
 * L'ordre des onglets suit ce qu'on fait, du plus fréquent au plus rare.
 *
 * « Mes écrans » d'abord : c'est la question qu'on se pose en arrivant —
 * qu'est-ce qui est affiché en ce moment. Les réglages annuels ferment la
 * marche.
 */
const TABS: { id: Tab; label: string; administrateur?: boolean }[] = [
  { id: "screens", label: "Mes écrans" },
  { id: "today", label: "Changements du jour" },
  { id: "grid", label: "Emploi du temps" },
  { id: "settings", label: "Réglages" },
  { id: "comptes", label: "Comptes", administrateur: true },
];

export function App() {
  /**
   * Qui est connecté.
   *
   * `undefined` tant qu'on ne sait pas — la console demande au serveur au
   * chargement, parce que la session vit dans un cookie que le JavaScript de
   * la page ne peut pas lire. C'est justement ce qui la protège.
   */
  const [moi, setMoi] = useState<Utilisateur | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("screens");
  const [screens, setScreens] = useState<ScreenStatus[]>([]);
  /** Ce que chaque écran diffuse, pour dessiner le mur d'aperçus. */
  const [manifestes, setManifestes] = useState<Record<string, unknown | null>>({});
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [setup, setSetup] = useState<TimetableSetup | null>(null);
  const [emergency, setEmergency] = useState<Emergency | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * Incrémenté par un retour à une version passée.
   *
   * Il remonte l'éditeur, qui relit alors ce qui est réellement diffusé.
   * Sans ça, la console continuerait d'afficher l'ancienne composition en
   * annonçant l'ancienne version — elle mentirait sur l'état de l'écran, ce
   * qui est pire que de ne rien afficher.
   */
  const [restored, setRestored] = useState(0);
  /** Le nom de l'établissement, affiché dans la barre. */
  const [etablissement, setEtablissement] = useState<string | null>(null);
  /** Vrai quand l'emploi du temps vient d'un logiciel externe. */
  const [emploiDuTempsExterne, setEmploiDuTempsExterne] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshScreens = useCallback(async () => {
    try {
      const result = await api.screens(true);
      setScreens(result.screens);
      if (result.manifestes) setManifestes(result.manifestes);
      setPending(result.pending);
      setEmergency((await api.emergency.current()).emergency);
      setError(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        // Session expirée ou fermée ailleurs : on repasse par l'entrée.
        setMoi(null);
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

  /**
   * Un seul écran rattaché : on le sélectionne. Faire cliquer quelqu'un sur
   * l'unique élément d'une liste pour accéder à la seule chose qu'il peut
   * faire n'apprend rien à personne.
   */
  useEffect(() => {
    if (selectedId === null && screens.length === 1) setSelectedId(screens[0]!.id);
  }, [screens, selectedId]);

  useEffect(() => {
    void api
      .moi()
      .then((r) => setMoi(r.utilisateur))
      .catch(() => setMoi(null));
    void api.identite
      .lire()
      .then((r) => setEtablissement(r.identite.nom))
      .catch(() => {});
    void api.netypareo
      .lire()
      .then((r) => setEmploiDuTempsExterne(r.reglages.actif && r.reglages.afficheurs.length > 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!moi) return;
    void refreshScreens();
    void refreshSetup();
    // Cinq secondes : un écran qui tombe se voit dans la foulée sans que la
    // page ait besoin d'être rechargée.
    const timer = setInterval(() => void refreshScreens(), 5_000);
    return () => clearInterval(timer);
  }, [moi, refreshScreens, refreshSetup]);

  if (moi === undefined) return <div className="gate"><h1>Couloir</h1><p>Un instant…</p></div>;
  if (moi === null) return <Entree onEntré={setMoi} />;

  const administrateur = peutAdministrer(moi.role);
  const publie = peutPublier(moi.role);

  const selected = screens.find((screen) => screen.id === selectedId) ?? null;

  const offline = screens.filter((s) => !s.online).length;

  return (
    <div className="app">
      <div className="topbar">
        {/* Le nom de l'établissement, pas celui du logiciel : c'est chez
            eux qu'on est, et ça se voit dès la barre. */}
        <span className="brand">
          {etablissement ?? "Couloir"} <span>écrans</span>
        </span>

        <nav className="tabs">
          {TABS.filter((entry) => !entry.administrateur || administrateur).map((entry) => (
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
        {/* Un lecteur ne déclenche pas d'urgence : le serveur le refuserait,
            et un bouton qui refuse est pire qu'un bouton absent. */}
        {publie && <EmergencyBar active={emergency} onChanged={() => void refreshScreens()} />}
        <span className="pill">{screens.length - offline} en ligne</span>
        {offline > 0 && <span className="pill warn">{offline} muets</span>}

        <span className="moi" title={`${moi.courriel} · ${libelléDuRole(moi.role)}`}>
          {moi.nom}
          {!publie && <span className="pill">lecture seule</span>}
        </span>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            void api.deconnexion().finally(() => setMoi(null));
          }}
        >
          Se déconnecter
        </button>
      </div>

      <div className="page">
        {error && <p className="notice error">{error}</p>}

        <FirstRun
          screens={screens}
          pending={pending}
          classes={setup?.classes.length ?? 0}
          emploiDuTempsExterne={emploiDuTempsExterne}
          onGo={(destination) => setTab(destination)}
        />

        {/*
          Deux états, jamais les deux à la fois : le mur, ou un écran.
          Tout montrer d'un coup — la liste, l'éditeur, l'historique, les
          actions — donnait une page dont on ne savait par où l'attaquer.
        */}
        {tab === "screens" && !selected && (
          <>
            <PendingPanel pending={pending} onPaired={() => void refreshScreens()} />
            <MurDEcrans
              screens={screens}
              manifestes={manifestes}
              onChoisir={(s) => setSelectedId(s.id)}
            />
          </>
        )}

        {tab === "screens" && selected && (
          <>
            <button type="button" className="retour" onClick={() => setSelectedId(null)}>
              ← Tous les écrans
            </button>

            <header className="entete-ecran">
              <div>
                <h1>{selected.label}</h1>
                <p>
                  {selected.code} · bâtiment {selected.building} · {selected.area}
                </p>
              </div>
              <span className={`pill ${selected.online ? "accent" : "signal"}`}>
                {selected.online ? "en ligne" : "ne répond pas"}
              </span>
            </header>

            <div className="split">
              <div>
                <PublishPanel
                  key={`${selected.id}:${restored}`}
                  screen={selected}
                  classes={setup?.classes ?? []}
                  onPublished={() => void refreshScreens()}
                />
              </div>
              <div>
                <HistoryPanel
                  screen={selected}
                  onRestored={() => {
                    setRestored((n) => n + 1);
                    void refreshScreens();
                  }}
                />
                <ScreenActions screen={selected} />
              </div>
            </div>
          </>
        )}

        {tab === "comptes" && administrateur && <Comptes moi={moi} />}

        {tab !== "screens" &&
          tab !== "comptes" &&
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

/**
 * Le chemin du premier jour.
 *
 * Une console vide ne dit pas par quoi commencer, et l'ordre compte : sans
 * écran rattaché il n'y a rien à publier, sans classe la mise en page « cours »
 * ne compose pas. On montre donc l'étape suivante, une seule à la fois, et
 * le bandeau disparaît de lui-même dès que l'installation tient debout.
 */
function FirstRun({
  screens,
  pending,
  classes,
  emploiDuTempsExterne,
  onGo,
}: {
  screens: ScreenStatus[];
  pending: PendingDevice[];
  classes: number;
  emploiDuTempsExterne: boolean;
  onGo: (tab: Tab) => void;
}) {
  const published = screens.some((screen) => screen.manifestVersion > 0);
  // Les classes ne servent qu'à la grille saisie à la main. Quand l'emploi
  // du temps vient d'un logiciel externe, réclamer des classes enverrait
  // faire un travail que personne n'a à faire.
  const classesRequises = !emploiDuTempsExterne;
  if (screens.length > 0 && (!classesRequises || classes > 0) && published) return null;

  const step =
    screens.length === 0
      ? pending.length > 0
        ? {
            text: `${pending.length} boîtier${pending.length > 1 ? "s attendent" : " attend"} d'être rattaché${pending.length > 1 ? "s" : ""} à un emplacement.`,
            action: "Rattacher" as const,
            tab: "screens" as Tab,
          }
        : {
            text: "Branchez un boîtier sur un écran : il affichera un code d'appairage, et apparaîtra ici tout seul.",
            action: null,
            tab: "screens" as Tab,
          }
      : classesRequises && classes === 0
        ? {
            text: "Créez vos classes pour pouvoir afficher les cours à côté du contenu.",
            action: "Créer les classes" as const,
            tab: "settings" as Tab,
          }
        : {
            text: "Vos écrans sont rattachés mais n'affichent encore rien. Choisissez-en un et publiez.",
            action: "Publier" as const,
            tab: "screens" as Tab,
          };

  return (
    <div className="firstrun">
      <span className="firstrun-mark" aria-hidden="true">
        →
      </span>
      <p>{step.text}</p>
      {step.action && (
        <button type="button" className="primary" onClick={() => onGo(step.tab)}>
          {step.action}
        </button>
      )}
    </div>
  );
}
