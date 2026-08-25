import { useCallback, useEffect, useState } from "react";
import { ScreenActions } from "./Actions.js";
import { EmergencyBar } from "./Emergency.js";
import { GridView } from "./Grid.js";
import { PageBibliotheque } from "./PageBibliotheque.js";
import { DiffusionGroupee } from "./DiffusionGroupee.js";
import { MurDEcrans } from "./MurDEcrans.js";
import { NouvelEcran } from "./NouvelEcran.js";
import { HistoryPanel } from "./History.js";
import { PublishPanel } from "./Publish.js";
import { PendingPanel, ScreenList } from "./Screens.js";
import { SettingsView } from "./Settings.js";
import { TodayView } from "./Today.js";
import { Comptes } from "./Comptes.js";
import { Entree } from "./Entree.js";
import {
  ApiError,
  relativeTime,
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

type Tab = "today" | "screens" | "grid" | "biblio" | "settings" | "comptes";

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
  { id: "biblio", label: "Bibliothèque" },
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
  /**
   * Compte les retours en arrière sur l'écran ouvert.
   *
   * Il sert deux fois : à remonter l'éditeur pour qu'il relise la
   * composition, et à rouvrir l'historique sur la version qui vient d'être
   * créée. Remis à zéro en changeant d'écran — un retour fait sur le hall ne
   * doit pas déplier l'historique du CDI.
   */
  const [restored, setRestored] = useState(0);
  const choisirEcran = (id: string | null) => {
    setSelectedId(id);
    setRestored(0);
  };
  /** L'assistant de pose d'un nouveau boîtier. */
  const [poseEnCours, setPoseEnCours] = useState(false);
  /** Les écrans cochés sur le mur, pour agir sur plusieurs d'un geste. */
  const [selection, setSelection] = useState<string[]>([]);
  /** La fenêtre de diffusion groupée. */
  const [diffusion, setDiffusion] = useState(false);
  /** Le nom de l'établissement, affiché dans la barre. */
  const [etablissement, setEtablissement] = useState<string | null>(null);
  /** Vrai quand l'emploi du temps vient d'un logiciel externe. */
  const [emploiDuTempsExterne, setEmploiDuTempsExterne] = useState(false);
  /** Combien de changements du jour restent à signaler. */
  const [changementsEnAttente] = useState(0);
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
  }, []);

  /**
   * Les réglages, une fois connecté.
   *
   * Ils étaient demandés au chargement, donc avant la connexion : le serveur
   * répondait 401, l'erreur était avalée, et plus rien ne les redemandait.
   * Le nom de l'établissement retombait alors sur celui du logiciel, et
   * personne ne comprenait pourquoi il revenait après un rechargement.
   */
  useEffect(() => {
    if (!moi) return;
    void api.identite
      .lire()
      .then((r) => setEtablissement(r.identite.nom))
      .catch(() => {});
    void api.netypareo
      .lire()
      .then((r) => setEmploiDuTempsExterne(r.reglages.actif && r.reglages.afficheurs.length > 0))
      .catch(() => {});
  }, [moi]);

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

  /**
   * Les compteurs du rail.
   *
   * Ce sont eux qui justifient la navigation latérale : la barre
   * horizontale ne pouvait pas les porter sans se remplir, et savoir qu'il
   * reste trois changements à saisir vaut mieux que de devoir aller voir.
   */
  const compteurs: Partial<Record<Tab, number>> = {
    screens: screens.length,
    ...(changementsEnAttente > 0 ? { today: changementsEnAttente } : {}),
  };

  const selected = screens.find((screen) => screen.id === selectedId) ?? null;

  const muets = screens.filter((s) => !s.online);
  const offline = muets.length;

  return (
    <div className="app">
      {/*
        Navigation latérale plutôt qu'une barre d'onglets. Elle porte les
        compteurs — combien d'écrans, combien de changements en attente — que
        la barre horizontale ne pouvait pas montrer sans se remplir. Et elle
        laisse le haut de page au titre et aux actions de l'écran courant.
      */}
      <nav className="rail">
        <div className="rail-entete">
          <span className="rail-marque">{etablissement ?? "Couloir"}</span>
          <span className="rail-produit">écrans</span>
        </div>

        <div className="rail-entrees">
          {TABS.filter((entry) => !entry.administrateur || administrateur)
            .filter((entry) => publie || entry.id === "screens" || entry.id === "grid")
            .map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="rail-entree"
                aria-current={tab === entry.id}
                onClick={() => {
                  setTab(entry.id);
                  choisirEcran(null);
                  setPoseEnCours(false);
                }}
              >
                <span className="rail-carre" aria-hidden="true" />
                <span className="rail-libelle">{entry.label}</span>
                {compteurs[entry.id] !== undefined && (
                  <span className={`rail-compteur ${entry.id === "today" ? "attention" : ""}`}>
                    {compteurs[entry.id]}
                  </span>
                )}
              </button>
            ))}
        </div>

        <div className="rail-pied">
          {/* Un lecteur ne déclenche pas d'urgence : le serveur le refuserait,
              et un bouton qui refuse est pire qu'un bouton absent. */}
          {publie && <EmergencyBar active={emergency} onChanged={() => void refreshScreens()} />}

          <div className="rail-moi">
            <span className="rail-initiales" aria-hidden="true">
              {initiales(moi.nom)}
            </span>
            <span className="rail-identite">
              <span className="rail-nom">{moi.nom}</span>
              <span className="rail-role">
                {publie ? libelléDuRole(moi.role) : "Lecture seule"}
              </span>
            </span>
            <button
              type="button"
              className="ghost"
              title="Se déconnecter"
              aria-label="Se déconnecter"
              onClick={() => {
                void api.deconnexion().finally(() => setMoi(null));
              }}
            >
              ⏻
            </button>
          </div>
        </div>
      </nav>

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
        {tab === "screens" && poseEnCours && (
          <NouvelEcran
            pending={pending}
            screens={screens}
            onTermine={() => {
              setPoseEnCours(false);
              void refreshScreens();
            }}
            onAnnuler={() => setPoseEnCours(false)}
          />
        )}

        {tab === "screens" && !selected && !poseEnCours && (
          <>
            <div className="mur-entete">
              <div className="mur-titre">
                <h1>Mes écrans</h1>
                <p>Voici ce qui est affiché en ce moment dans les couloirs.</p>
              </div>

              <span className="mur-etat">
                <span className="etat-ligne">
                  <span className="dot online" />
                  {screens.length - offline} en ligne
                </span>
                {offline > 0 && (
                  <span className="etat-ligne muet">
                    <span className="dot offline" />
                    {offline} ne répond{offline > 1 ? "ent" : ""} pas
                  </span>
                )}
              </span>

              {publie && (
                <button type="button" className="primary" onClick={() => setPoseEnCours(true)}>
                  Poser un écran
                </button>
              )}
            </div>

            {/* Une panne se raconte en une phrase, en haut du mur. Une
                pastille dans un coin ne dit ni lequel, ni depuis quand, ni
                ce qu'il reste affiché là-bas. */}
            {muets.map((ecran) => (
              <div className="bandeau-panne" key={ecran.id}>
                <span className="dot offline" />
                <p>
                  <b>{ecran.label}</b> ne répond plus depuis{" "}
                  {relativeTime(ecran.lastHeartbeatAtMs)}.{" "}
                  {ecran.manifestVersion > 0
                    ? "Il affiche encore son dernier contenu."
                    : "Il n'avait rien reçu."}
                </p>
                <button type="button" onClick={() => choisirEcran(ecran.id)}>
                  Diagnostiquer
                </button>
              </div>
            ))}

            <PendingPanel pending={pending} onPaired={() => void refreshScreens()} />
            <MurDEcrans
              screens={screens}
              manifestes={manifestes}
              onChoisir={(s) => choisirEcran(s.id)}
              {...(publie
                ? {
                    selection,
                    // Mise à jour fonctionnelle : deux coches cliquées coup
                    // sur coup doivent toutes deux compter.
                    onBasculer: (id: string) =>
                      setSelection((actuels) =>
                        actuels.includes(id)
                          ? actuels.filter((x) => x !== id)
                          : [...actuels, id],
                      ),
                  }
                : {})}
            />

            {diffusion && (
              <DiffusionGroupee
                ecrans={screens.filter((e) => selection.includes(e.id))}
                onFait={() => {
                  setSelection([]);
                  void refreshScreens();
                }}
                onFermer={() => setDiffusion(false)}
              />
            )}

            {publie && selection.length > 0 && !diffusion && (
              <div className="barre-selection">
                <span className="barre-compte">
                  {selection.length} écran{selection.length > 1 ? "s" : ""} sélectionné
                  {selection.length > 1 ? "s" : ""}
                </span>
                <span className="barre-trait" aria-hidden="true" />
                <button
                  type="button"
                  className="barre-action-forte"
                  onClick={() => setDiffusion(true)}
                >
                  Publier un contenu
                </button>
                <button type="button" className="barre-action" onClick={() => setSelection([])}>
                  Désélectionner
                </button>
              </div>
            )}
          </>
        )}

        {tab === "screens" && selected && !poseEnCours && (
          <>
            <button type="button" className="retour" onClick={() => choisirEcran(null)}>
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

            <PublishPanel
              key={`${selected.id}:${restored}`}
              screen={selected}
              classes={setup?.classes ?? []}
              parc={screens}
              manifestes={manifestes}
              onPublished={() => void refreshScreens()}
              secondaire={
                <>
                  <HistoryPanel
                    screen={selected}
                    ouvertParDefaut={restored > 0}
                    onRestored={() => {
                      setRestored((n) => n + 1);
                      void refreshScreens();
                    }}
                  />
                  <ScreenActions screen={selected} />
                </>
              }
            />
          </>
        )}

        {tab === "comptes" && administrateur && <Comptes moi={moi} />}

        {/* La bibliothèque ne dépend pas de l'emploi du temps : elle
            s'affiche même sans base de données côté horaires. */}
        {tab === "biblio" && <PageBibliotheque />}

        {tab !== "screens" &&
          tab !== "comptes" &&
          tab !== "biblio" &&
          (setup ? (
            <>
              {tab === "today" && <TodayView setup={setup} onChanged={() => void refreshSetup()} />}
              {tab === "grid" && (
                <GridView
                  setup={setup}
                  externe={emploiDuTempsExterne}
                  onChanged={() => void refreshSetup()}
                />
              )}
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
/** « Jérémy Macadré » → « JM ». Deux lettres suffisent à se reconnaître. */
function initiales(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]?.toUpperCase() ?? "")
    .join("");
}

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
