import { useCallback, useEffect, useMemo, useState } from "react";
import type { Draft } from "./brouillon.js";
import type { Manifest } from "@couloir/protocol";
import { ScreenPreview } from "./Preview.js";
import { Bibliotheque } from "./Bibliotheque.js";
import { OuCaPart } from "./OuCaPart.js";
import { VueJour } from "./VueJour.js";
import { VueMois } from "./VueMois.js";
import { ReglagesDeLEcran } from "./ReglagesDeLEcran.js";
import { VoletContenu } from "./VoletContenu.js";
import {
  type ChampEdt,
  type DisplayOffWindow,
  type Media,
  type PublishItem,
  type PublishSpec,
  type SchoolClass,
  type ScreenStatus,
  api,
} from "./api.js";

/**
 * Le panneau de publication.
 *
 * Volontairement pauvre en options : on choisit une mise en page, on empile
 * des contenus, on publie. Les playlists nommées, la programmation calendaire
 * et les gabarits viendront — mais ce parcours-là doit rester faisable en
 * moins d'une minute, parce que c'est celui de tous les jours.
 *
 * Deux partis pris d'ergonomie :
 *
 * 1. L'éditeur s'ouvre sur ce qui est DÉJÀ diffusé, jamais sur du vide. Un
 *    écran qui affiche quelque chose se corrige ; il ne se remplace pas à
 *    l'aveugle.
 * 2. Publier ne demande pas confirmation. On propose le retour arrière juste
 *    après, au moment où on s'aperçoit de l'erreur. Une boîte de dialogue de
 *    plus se clique sans la lire au bout de trois jours ; un bouton
 *    « Revenir en arrière » se lit quand on en a besoin.
 */


/** Ce qu'on relit depuis le serveur, transformé en brouillon éditable. */
function toDrafts(spec: PublishSpec, media: Media[]): Draft[] {
  return spec.items.map((item, index) => ({
    ...item,
    key: `${item.assetId ?? "texte"}-${index}`,
    title: item.assetId
      ? (media.find((m) => m.id === item.assetId)?.filename ?? item.assetId)
      : "Texte",
  }));
}

export function PublishPanel({
  screen,
  classes,
  onPublished,
  secondaire,
  parc = [],
  manifestes = {},
  urgenceEnCours = false,
}: {
  screen: ScreenStatus;
  classes: SchoolClass[];
  onPublished: () => void;
  /**
   * Vrai tant qu'un message d'urgence est en ligne.
   *
   * Publier reste sans danger — le serveur reporte le message sur la nouvelle
   * version — mais reste sans effet visible : l'alerte couvre tout. Un bouton
   * qui ne change rien à ce qu'affichent les couloirs vaut mieux grisé, avec
   * la raison écrite, que cliquable et muet.
   */
  urgenceEnCours?: boolean;
  /** Ce dont on se sert rarement : historique, actions sur le boîtier. */
  secondaire?: React.ReactNode;
  /** Les autres écrans, pour étendre la publication sans changer de page. */
  parc?: ScreenStatus[];
  /** Ce que chaque écran diffuse, pour dire où passe chaque média. */
  manifestes?: Record<string, unknown | null>;
}) {
  const [media, setMedia] = useState<Media[]>([]);
  const [items, setItems] = useState<Draft[]>([]);
  const [layout, setLayout] = useState<PublishSpec["layout"]>("plein-ecran");
  const [ticker, setTicker] = useState("");
  /** Vide = toutes les classes défilent. Une seule = écran fixe. */
  const [classIds, setClassIds] = useState<string[]>([]);
  const [displayOff, setDisplayOff] = useState<DisplayOffWindow[]>([]);
  /** Combien d'actualités du site tournent avec le reste. 0 = aucune. */
  const [actualites, setActualites] = useState(0);
  /** La source est-elle configurée ? Sans elle, le réglage n'a aucun sens. */
  const [sourceActive, setSourceActive] = useState<boolean | null>(null);
  /** Les afficheurs NetYPareo disponibles, et ceux retenus pour cet écran. */
  const [afficheurs, setAfficheurs] = useState<
    { afficheur: string; batiment: string | null; libelle: string }[]
  >([]);
  const [afficheursChoisis, setAfficheursChoisis] = useState<string[]>([]);
  /**
   * Les colonnes montrées dans l'emploi du temps.
   *
   * `null` = réglage jamais touché, donc tout. On distingue de la liste vide,
   * qui veut dire « seulement l'heure et l'intitulé » — un choix délibéré.
   */
  const [champsEdt, setChampsEdt] = useState<ChampEdt[] | null>(null);
  /** Ce que l'écran montre quand rien n'est programmé pour maintenant. */
  const [parDefaut, setParDefaut] = useState<{ assetId?: string; emploiDuTemps?: boolean }>({});
  /** L'onglet ouvert dans l'éditeur. */
  const [volet, setVolet] = useState<"contenu" | "journee" | "mois" | "reglages">("contenu");
  /** Les autres écrans qui recevront aussi cette composition. */
  const [aussi, setAussi] = useState<string[]>([]);
  /**
   * L'instant depuis lequel on regarde l'aperçu.
   *
   * `null` = maintenant. Sinon, on voit ce que l'écran affichera ce jour-là :
   * c'est la seule façon de vérifier une programmation sans attendre la date.
   */
  const [instantSimulé, setInstantSimulé] = useState<number | null>(null);
  /** La version en ligne, et sa composition telle que rouverte. */
  const [live, setLive] = useState<{ version: number | null; loaded: boolean; reopenable: boolean }>(
    { version: null, loaded: false, reopenable: true },
  );
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  /** La version à laquelle « Revenir en arrière » ramènerait. */
  const [undoTo, setUndoTo] = useState<number | null>(null);
  const [preview, setPreview] = useState<Manifest | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.media().then((r) => setMedia(r.media)).catch(() => {});
    void api.actualites
      .lire()
      .then((r) => setSourceActive(r.reglages.actif && Boolean(r.reglages.url)))
      .catch(() => setSourceActive(false));
    void api.netypareo
      .lire()
      .then((r) => setAfficheurs(r.reglages.actif ? r.reglages.afficheurs : []))
      .catch(() => setAfficheurs([]));
  }, []);

  /**
   * Rouvre la composition en ligne.
   *
   * On attend la bibliothèque : sans elle, les contenus s'afficheraient
   * sous leur identifiant technique au lieu de leur nom de fichier.
   */
  const reopen = useCallback(async () => {
    setLive({ version: null, loaded: false, reopenable: false });
    setMessage(null);
    setUndoTo(null);
    try {
      const [{ version, spec }, { media: library }] = await Promise.all([
        api.composition(screen.id),
        api.media(),
      ]);
      setMedia(library);
      if (spec) {
        setLayout(spec.layout);
        setItems(toDrafts(spec, library));
        setTicker(spec.ticker ?? "");
        setClassIds(spec.timetableClassIds ?? []);
        setDisplayOff(spec.displayOff ?? []);
        setActualites(spec.actualites ?? 0);
        setAfficheursChoisis(spec.timetableAfficheurs ?? []);
        setChampsEdt(spec.timetableChamps ?? null);
        setParDefaut(spec.parDefaut ?? {});
      } else {
        setLayout("plein-ecran");
        setItems([]);
        setTicker("");
        setClassIds([]);
        setDisplayOff([]);
        setActualites(0);
        setAfficheursChoisis([]);
        setChampsEdt(null);
        setParDefaut({});
      }
      setLive({ version, loaded: true, reopenable: spec !== null });
      setDirty(false);
    } catch {
      setLive({ version: null, loaded: true, reopenable: true });
    }
  }, [screen.id]);

  useEffect(() => {
    void reopen();
  }, [reopen]);

  function currentSpec(): PublishSpec {
    return {
      layout,
      items: items.map(({ key, title, ...item }) => item),
      ...(ticker.trim() ? { ticker: ticker.trim() } : {}),
      ...(layout === "principal-et-cours" && classIds.length > 0
        ? { timetableClassIds: classIds }
        : {}),
      ...(displayOff.length > 0 ? { displayOff } : {}),
      ...(actualites > 0 ? { actualites } : {}),
      ...(afficheursChoisis.length > 0 ? { timetableAfficheurs: afficheursChoisis } : {}),
      ...(champsEdt !== null ? { timetableChamps: champsEdt } : {}),
      ...(parDefaut.assetId || parDefaut.emploiDuTemps ? { parDefaut } : {}),
    };
  }

  /**
   * L'aperçu se recompose à chaque modification, avec un léger délai : on
   * ne demande pas un manifeste au serveur à chaque frappe dans un titre.
   */
  useEffect(() => {
    if (!live.loaded) return;
    if (items.length === 0 || items.some((item) => item.text && !item.text.titre.trim())) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    const timer = setTimeout(() => {
      void api
        .previewSpec(screen.id, currentSpec())
        .then((result) => {
          setPreview(result.manifest as Manifest);
          setPreviewError(null);
        })
        .catch((cause) => {
          setPreview(null);
          setPreviewError(cause instanceof Error ? cause.message : String(cause));
        });
    }, 400);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    screen.id,
    layout,
    items,
    ticker,
    classIds,
    displayOff,
    actualites,
    afficheursChoisis,
    champsEdt,
    parDefaut,
    live.loaded,
  ]);

  /** Toute modification rend le brouillon différent de ce qui est diffusé. */
  function touch<T>(apply: () => T): T {
    setDirty(true);
    setUndoTo(null);
    return apply();
  }

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const { media: added } = await api.upload(file);
      setMedia((current) => [added, ...current]);
      addMedia(added);
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : String(cause), error: true });
    } finally {
      setBusy(false);
    }
  }

  function addMedia(item: Media) {
    touch(() =>
      setItems((current) => [
        ...current,
        {
          key: `${item.id}-${current.length}-${Math.random().toString(36).slice(2, 6)}`,
          assetId: item.id,
          title: item.filename ?? item.id,
          ...(item.mime.startsWith("video/") ? {} : { durationMs: 12_000 }),
        },
      ]),
    );
  }

  function addText() {
    touch(() =>
      setItems((current) => [
        ...current,
        { key: `texte-${current.length}`, text: { titre: "" }, title: "Texte", durationMs: 12_000 },
      ]),
    );
  }

  /** Déplace un contenu dans l'ordre de diffusion. */
  function move(key: string, direction: -1 | 1) {
    touch(() =>
      setItems((current) => {
        const index = current.findIndex((it) => it.key === key);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= current.length) return current;
        const next = [...current];
        const [moved] = next.splice(index, 1);
        next.splice(target, 0, moved!);
        return next;
      }),
    );
  }

  async function publish() {
    setBusy(true);
    setMessage(null);
    const previous = live.version;
    try {
      if (aussi.length > 0) {
        // Publication groupée : chaque écran garde ses propres réglages, et
        // un refus n'empêche pas les autres.
        const { resultats } = await api.publierGroupe([screen.id, ...aussi], currentSpec());
        const publies = resultats.filter((r) => r.version !== undefined);
        const refuses = resultats.filter((r) => r.erreur);
        setDirty(false);
        setUndoTo(null);
        await reopen();
        setMessage({
          text:
            refuses.length === 0
              ? `Diffusé sur ${publies.length} écran${publies.length > 1 ? "s" : ""} : ${publies.map((r) => r.code).join(", ")}.`
              : `${publies.length} écran${publies.length > 1 ? "s" : ""} servi${publies.length > 1 ? "s" : ""}. Refusé par ${refuses.map((r) => `${r.code} (${r.erreur})`).join(", ")}.`,
          ...(refuses.length > 0 ? { error: true } : {}),
        });
        onPublished();
        return;
      }

      const { version } = await api.publish(screen.id, currentSpec());
      setLive({ version, loaded: true, reopenable: true });
      setDirty(false);
      setUndoTo(previous);
      setMessage({
        text: screen.online
          ? `Version ${version} en ligne. L'écran l'affiche à l'instant.`
          : `Version ${version} enregistrée. L'écran l'affichera à son retour.`,
      });
      onPublished();
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : String(cause), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (undoTo === null) return;
    setBusy(true);
    try {
      await api.restore(screen.id, undoTo);
      await reopen();
      setMessage({ text: `Retour à la version ${undoTo}.` });
      onPublished();
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : String(cause), error: true });
    } finally {
      setBusy(false);
    }
  }

  /** Les deux mises en page qui portent une colonne de cours. */
  const avecCours = layout === "principal-et-cours" || layout === "emploi-du-temps";

  /**
   * Combien d'écrans diffusent chaque média.
   *
   * Calculé sur les manifestes déjà chargés pour le mur : aucune requête de
   * plus. C'est ce qui permet à la bibliothèque de dire « sur 5 écrans » ou
   * « nulle part » — sans quoi on ne sait pas si retirer une affiche va
   * vider un couloir.
   */
  const usageDesMedias = useMemo(() => {
    const compte: Record<string, number> = {};
    for (const manifeste of Object.values(manifestes)) {
      const assets = (manifeste as { assets?: { id: string }[] } | null)?.assets;
      if (!Array.isArray(assets)) continue;
      for (const id of new Set(assets.map((a) => a.id))) {
        compte[id] = (compte[id] ?? 0) + 1;
      }
    }
    return compte;
  }, [manifestes]);

  const autresEcrans = parc.filter((e) => e.id !== screen.id);

  const invalidText = items.some((item) => item.text && !item.text.titre.trim());
  // Un écran qui ne diffuse que les actualités du site est une configuration
  // parfaitement légitime : c'est même celle du hall d'accueil.
  // L'emploi du temps seul n'a besoin d'aucun contenu : c'est son objet.
  const ready =
    (layout === "emploi-du-temps" || items.length > 0 || actualites > 0) && !invalidText;
  const nothingLive = live.loaded && live.version === null;

  return (
    <div className={`editeur ${volet === "contenu" ? "avec-biblio" : ""}`}>
      {volet === "contenu" && (
        <Bibliotheque
          media={media}
          usage={usageDesMedias}
          onAjouter={addMedia}
          onAjouterTexte={addText}
          onImporter={(f) => void upload(f)}
        />
      )}

      {/*
        L'aperçu à gauche, collant : on ne compose pas à l'aveugle. Il était
        en bas d'un long formulaire, donc hors de vue pendant tout le travail
        — on découvrait le résultat après coup, et on remontait corriger.
      */}
      <aside className="editeur-apercu">
        <MachineÀRemonterLeTemps instant={instantSimulé} onChange={setInstantSimulé} items={items} />
        <ScreenPreview
          manifest={preview}
          screenCode={screen.code}
          error={previewError}
          {...(instantSimulé !== null ? { instant: instantSimulé } : {})}
        />

        {/* Publier reste sous les yeux : au bout du formulaire, il fallait
            dérouler toute la page pour agir. */}
        <div className="barre-publier">
          <span className="barre-etat">
            {dirty ? (
              <span className="pill brouillon">modifications non diffusées</span>
            ) : nothingLive ? (
              <span className="pill warn">rien de publié</span>
            ) : (
              <span className="pill">version {live.version} en ligne</span>
            )}
          </span>

          <button
            type="button"
            className="primary"
            onClick={publish}
            disabled={!ready || busy || urgenceEnCours}
          >
            {busy
              ? "Publication…"
              : aussi.length > 0
                ? `Diffuser sur ${aussi.length + 1} écrans`
                : dirty || nothingLive
                  ? "Publier"
                  : "Republier"}
          </button>
          {dirty && live.version !== null && (
            <button type="button" onClick={() => void reopen()} disabled={busy}>
              Annuler
            </button>
          )}
        </div>

        {message && (
          <p className={`notice ${message.error ? "error" : ""}`}>
            {message.text}
            {undoTo !== null && !message.error && (
              <button type="button" className="link" onClick={() => void undo()} disabled={busy}>
                Revenir à la version {undoTo}
              </button>
            )}
          </p>
        )}

        {/* Un bouton grisé sans explication laisse chercher. */}
        {urgenceEnCours && (
          <p className="hint">
            Un message d'urgence est en ligne : il couvre tout ce qui est publié. Retirez-le pour
            rendre les écrans à leur rotation.
          </p>
        )}
        {!urgenceEnCours && items.length === 0 && actualites === 0 && layout !== "emploi-du-temps" && (
          <p className="hint">
            Ajoutez au moins un contenu, ou des actualités du site, pour pouvoir publier.
          </p>
        )}
        {invalidText && <p className="hint">Un texte sans titre ne peut pas être publié.</p>}

        <OuCaPart
          ecranCourant={screen}
          autres={autresEcrans}
          choisis={aussi}
          onBasculer={(id) =>
            touch(() =>
              setAussi((actuels) =>
                actuels.includes(id) ? actuels.filter((x) => x !== id) : [...actuels, id],
              ),
            )
          }
        />
      </aside>

      <div className="editeur-travail">
        <div className="body">
          {!live.loaded && <p className="hint">Lecture de ce qui est diffusé…</p>}

          {nothingLive && (
            <p className="hint" style={{ marginBottom: 12 }}>
              Cet écran n'affiche encore rien. Il montre son code et son adresse en attendant.
            </p>
          )}

          {/* Publié avant que les compositions ne soient conservées. On le dit
              plutôt que de laisser croire à un écran vide : il diffuse bien
              quelque chose, on ne sait simplement plus le rouvrir. */}
          {live.loaded && !nothingLive && !live.reopenable && (
            <p className="notice" style={{ marginBottom: 12 }}>
              Cet écran diffuse la version {live.version}, publiée avant que les compositions ne
              soient conservées. Impossible de la rouvrir ici : ce que vous composez maintenant la
              remplacera.
            </p>
          )}

          {!screen.online && (
            <p className="hint" style={{ marginBottom: 12 }}>
              Cet écran ne répond pas. La publication est enregistrée : il l'appliquera à son retour.
            </p>
          )}


          {/* Trois volets plutôt qu'un long formulaire à dérouler. On ne
              cherche pas la même chose selon qu'on change une affiche, qu'on
              programme une journée ou qu'on règle l'écran une fois pour
              toutes. */}
          <div className="volets" role="tablist">
            {(
              [
                ["contenu", "Contenu"],
                ["journee", "Journée"],
                ["mois", "Mois"],
                ["reglages", "Réglages de l'écran"],
              ] as const
            ).map(([id, libelle]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="volet"
                aria-selected={volet === id}
                onClick={() => setVolet(id)}
              >
                {libelle}
              </button>
            ))}
          </div>

          <div className="volet-corps" hidden={volet !== "reglages"}>
            <ReglagesDeLEcran
              screen={screen}
              media={media}
              classes={classes}
              layout={layout}
              setLayout={setLayout}
              afficheurs={afficheurs}
              afficheursChoisis={afficheursChoisis}
              setAfficheursChoisis={setAfficheursChoisis}
              champsEdt={champsEdt}
              setChampsEdt={setChampsEdt}
              classIds={classIds}
              setClassIds={setClassIds}
              displayOff={displayOff}
              setDisplayOff={setDisplayOff}
              parDefaut={parDefaut}
              setParDefaut={setParDefaut}
              touch={touch}
            />
          </div>

          <div className="volet-corps" hidden={volet !== "contenu"}>
            <VoletContenu
              media={media}
              items={items}
              setItems={setItems}
              ticker={ticker}
              setTicker={setTicker}
              actualites={actualites}
              setActualites={setActualites}
              sourceActive={sourceActive}
              move={move}
              touch={touch}
            />
          </div>

          {/* Le mois répond à « quels jours », la journée à « à quelle
              heure ». Deux questions, deux vues. */}
          <div className="volet-corps" hidden={volet !== "mois"}>
            <VueMois items={items} media={media} />
          </div>

          <div className="volet-corps" hidden={volet !== "journee"}>
            <VueJour
              items={items}
              media={media}
              displayOff={displayOff}
              parDefaut={parDefaut}
              onChange={(suivants) => touch(() => setItems(suivants))}
            />
          </div>

          {!dirty && live.reopenable && live.version !== null && items.length > 0 && (
            <p className="hint">C'est exactement ce que l'écran diffuse en ce moment.</p>
          )}
        </div>

        {/* Historique et actions sur le boîtier : utiles, rarement. Repliés
            en bas plutôt qu'en colonne, où ils pesaient visuellement autant
            que le travail du jour. */}
        {secondaire && <div className="editeur-secondaire">{secondaire}</div>}
      </div>
    </div>
  );
}

/**
 * Voir l'écran à une autre date.
 *
 * Sans elle, on ne saurait ce qu'affichera l'écran le 12 septembre qu'en
 * attendant le 12 septembre — et une affiche programmée à tort ne se
 * découvrirait qu'en montant voir un couloir vide.
 *
 * N'apparaît que si au moins un contenu est programmé : sur une publication
 * sans période, elle ne montrerait jamais rien d'autre que le présent.
 */
function MachineÀRemonterLeTemps({
  instant,
  onChange,
  items,
}: {
  instant: number | null;
  onChange: (ms: number | null) => void;
  items: { visibility?: unknown }[];
}) {
  if (!items.some((item) => item.visibility)) return null;

  const date = new Date(instant ?? Date.now());
  const p = (n: number) => String(n).padStart(2, "0");
  const jour = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  const heure = `${p(date.getHours())}:${p(date.getMinutes())}`;

  function poser(nouveauJour: string, nouvelleHeure: string) {
    const [a, m, j] = nouveauJour.split("-").map(Number);
    const [h, mn] = nouvelleHeure.split(":").map(Number);
    onChange(new Date(a!, m! - 1, j!, h!, mn!).getTime());
  }

  return (
    <div className="voyage">
      <span className="voyage-mark" aria-hidden="true">
        🕐
      </span>
      <span>Voir l'écran le</span>
      <input
        type="date"
        value={jour}
        aria-label="Date simulée"
        onChange={(e) => poser(e.target.value, heure)}
      />
      <input
        type="time"
        value={heure}
        aria-label="Heure simulée"
        onChange={(e) => poser(jour, e.target.value)}
      />
      {instant !== null && (
        <button type="button" className="link" onClick={() => onChange(null)}>
          Revenir à maintenant
        </button>
      )}
      <span className="spacer" />
      <span className="hint">
        {instant === null
          ? "Vous regardez le présent."
          : "L'aperçu montre ce jour-là, pas aujourd'hui."}
      </span>
    </div>
  );
}
