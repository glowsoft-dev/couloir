import { useCallback, useEffect, useRef, useState } from "react";
import type { Manifest } from "@couloir/protocol";
import { ScreenPreview } from "./Preview.js";
import { Periode } from "./Periode.js";
import { Schedule } from "./Schedule.js";
import {
  type DisplayOffWindow,
  type Media,
  type PublishItem,
  type PublishSpec,
  type SchoolClass,
  type ScreenStatus,
  api,
  humanSize,
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

type Draft = PublishItem & { key: string; title: string };

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
}: {
  screen: ScreenStatus;
  classes: SchoolClass[];
  onPublished: () => void;
}) {
  const [media, setMedia] = useState<Media[]>([]);
  const [items, setItems] = useState<Draft[]>([]);
  const [layout, setLayout] = useState<"plein-ecran" | "principal-et-cours">("plein-ecran");
  const [ticker, setTicker] = useState("");
  /** Vide = toutes les classes défilent. Une seule = écran fixe. */
  const [classIds, setClassIds] = useState<string[]>([]);
  const [displayOff, setDisplayOff] = useState<DisplayOffWindow[]>([]);
  /** Combien d'actualités du site tournent avec le reste. 0 = aucune. */
  const [actualites, setActualites] = useState(0);
  /** La source est-elle configurée ? Sans elle, le réglage n'a aucun sens. */
  const [sourceActive, setSourceActive] = useState<boolean | null>(null);
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
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.media().then((r) => setMedia(r.media)).catch(() => {});
    void api.actualites
      .lire()
      .then((r) => setSourceActive(r.reglages.actif && Boolean(r.reglages.url)))
      .catch(() => setSourceActive(false));
  }, []);

  /**
   * Rouvre la composition en ligne.
   *
   * On attend la bibliothèque : sans elle, les contenus s'afficheraient
   * sous leur identifiant technique au lieu de leur nom de fichier.
   */
  const reopen = useCallback(async () => {
    setLive({ version: null, loaded: false });
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
      } else {
        setLayout("plein-ecran");
        setItems([]);
        setTicker("");
        setClassIds([]);
        setDisplayOff([]);
        setActualites(0);
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
  }, [screen.id, layout, items, ticker, classIds, displayOff, actualites, live.loaded]);

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
      if (fileInput.current) fileInput.current.value = "";
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

  const invalidText = items.some((item) => item.text && !item.text.titre.trim());
  // Un écran qui ne diffuse que les actualités du site est une configuration
  // parfaitement légitime : c'est même celle du hall d'accueil.
  const ready = (items.length > 0 || actualites > 0) && !invalidText;
  const nothingLive = live.loaded && live.version === null;

  return (
    <>
      <section className="panel">
        <header>
          <h2>Ce qu'affiche {screen.code}</h2>
          <span className="spacer" />
          {live.loaded && !nothingLive && (
            <span className="pill" title="Version actuellement diffusée">
              v{live.version}
            </span>
          )}
          {dirty && (
            <span className="pill brouillon" title="Ces changements ne sont pas encore diffusés">
              brouillon
            </span>
          )}
          <span className={`pill ${screen.online ? "accent" : "warn"}`}>
            {screen.online ? "en ligne" : "hors ligne"}
          </span>
        </header>

        <div className="body">
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

          <div className="field">
            <label htmlFor="layout">Mise en page</label>
            <select
              id="layout"
              value={layout}
              onChange={(e) => touch(() => setLayout(e.target.value as typeof layout))}
            >
              <option value="plein-ecran">Plein écran</option>
              <option value="principal-et-cours">Contenu + colonne des cours</option>
            </select>
          </div>

          {layout === "principal-et-cours" && (
            <div className="field">
              <label>Classes affichées dans la colonne</label>
              {classes.length === 0 ? (
                <p className="hint">Aucune classe. Créez-en dans l'onglet Réglages.</p>
              ) : (
                <>
                  <div className="day-picker">
                    {classes.map((schoolClass) => {
                      const selected = classIds.includes(schoolClass.id);
                      return (
                        <button
                          key={schoolClass.id}
                          type="button"
                          className="day-chip"
                          aria-pressed={selected}
                          title={schoolClass.label}
                          onClick={() =>
                            touch(() =>
                              setClassIds((current) =>
                                selected
                                  ? current.filter((id) => id !== schoolClass.id)
                                  : [...current, schoolClass.id],
                              ),
                            )
                          }
                        >
                          {schoolClass.code}
                        </button>
                      );
                    })}
                  </div>
                  <p className="hint">
                    {classIds.length === 0
                      ? "Aucune sélection : toutes les classes défilent."
                      : classIds.length === 1
                        ? "Une seule classe : l'écran l'affiche en permanence."
                        : `${classIds.length} classes, affichées à tour de rôle.`}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="field">
            <label>Bibliothèque</label>
            {media.length === 0 ? (
              <p className="hint">
                Aucun média pour l'instant. Importez une affiche ou une vidéo pour commencer.
              </p>
            ) : (
              <div className="media-grid">
                {media.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="media-tile"
                    title={`${item.filename ?? item.id} — ${humanSize(item.bytes)}. Cliquez pour l'ajouter.`}
                    onClick={() => addMedia(item)}
                  >
                    {item.mime.startsWith("image/") ? (
                      <img src={`/v1/assets/${item.id}`} alt="" />
                    ) : (
                      <span className="kind">{item.mime.split("/")[1] ?? "fichier"}</span>
                    )}
                    <span className="name">{item.filename ?? item.id}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="row-actions">
              <input
                ref={fileInput}
                type="file"
                accept="image/*,video/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
                Importer un fichier
              </button>
              <button type="button" onClick={addText} disabled={busy}>
                Ajouter un texte
              </button>
            </div>
          </div>

          <div className="field">
            <label>Contenus à diffuser</label>
            {items.length === 0 ? (
              <p className="hint">Cliquez sur un média ci-dessus, ou ajoutez un texte.</p>
            ) : (
              items.map((item, index) => (
                <div className="slide-row" key={item.key}>
                  <span className="index">{String(index + 1).padStart(2, "0")}</span>

                  {item.text ? (
                    <input
                      value={item.text.titre}
                      placeholder="Titre affiché à l'écran"
                      aria-label={`Titre du contenu ${index + 1}`}
                      aria-invalid={!item.text.titre.trim()}
                      onChange={(e) =>
                        touch(() =>
                          setItems((current) =>
                            current.map((it) =>
                              it.key === item.key ? { ...it, text: { titre: e.target.value } } : it,
                            ),
                          ),
                        )
                      }
                    />
                  ) : (
                    <span className="title">{item.title}</span>
                  )}

                  {item.durationMs === undefined ? (
                    <span className="hint" title="Une vidéo dure le temps qu'elle dure">
                      durée vidéo
                    </span>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={Math.round(item.durationMs / 1000)}
                      aria-label={`Durée du contenu ${index + 1}, en secondes`}
                      onChange={(e) =>
                        touch(() =>
                          setItems((current) =>
                            current.map((it) =>
                              it.key === item.key
                                ? { ...it, durationMs: Math.max(1, Number(e.target.value)) * 1000 }
                                : it,
                            ),
                          ),
                        )
                      }
                    />
                  )}

                  {/* Groupés : la grille de la rangée compte quatre colonnes,
                      pas six, et trois boutons à la suite la feraient passer
                      sur deux lignes. */}
                  <Periode
                    valeur={item.visibility}
                    libellé={`Contenu ${index + 1}`}
                    onChange={(v) =>
                      touch(() =>
                        setItems((current) =>
                          current.map((it) =>
                            it.key === item.key
                              ? ({ ...it, visibility: v } as Draft)
                              : it,
                          ),
                        ),
                      )
                    }
                  />

                  <span className="slide-controls">
                    <button
                      type="button"
                      className="ghost"
                      aria-label={`Monter le contenu ${index + 1}`}
                      title="Monter"
                      disabled={index === 0}
                      onClick={() => move(item.key, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      aria-label={`Descendre le contenu ${index + 1}`}
                      title="Descendre"
                      disabled={index === items.length - 1}
                      onClick={() => move(item.key, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      aria-label={`Retirer le contenu ${index + 1}`}
                      title="Retirer"
                      onClick={() =>
                        touch(() =>
                          setItems((current) => current.filter((it) => it.key !== item.key)),
                        )
                      }
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="field">
            <label htmlFor="ticker">Bandeau défilant</label>
            <textarea
              id="ticker"
              value={ticker}
              placeholder="Conseil de classe jeudi 17 · Inscriptions au voyage jusqu'au 30 septembre"
              onChange={(e) => touch(() => setTicker(e.target.value))}
            />
          </div>

          <div className="field">
            <label htmlFor="actus">Actualités du site</label>
            {sourceActive === false ? (
              <p className="hint">
                Aucune source configurée. Renseignez l'adresse du site dans l'onglet Réglages, et
                les articles rejoindront la rotation ici.
              </p>
            ) : (
              <>
                <input
                  id="actus"
                  type="number"
                  min={0}
                  max={10}
                  value={actualites}
                  onChange={(e) =>
                    touch(() => setActualites(Math.min(10, Math.max(0, Number(e.target.value)))))
                  }
                />
                <p className="hint">
                  {actualites === 0
                    ? "Aucune actualité dans la rotation."
                    : `${actualites} article${actualites > 1 ? "s" : ""} du site, ${actualites > 1 ? "affichés" : "affiché"} entre vos contenus. Ils se mettent à jour tout seuls.`}
                </p>
              </>
            )}
          </div>

          <Schedule windows={displayOff} onChange={(next) => touch(() => setDisplayOff(next))} />

          <div className="row-actions">
            <button type="button" className="primary" onClick={publish} disabled={!ready || busy}>
              {busy ? "Publication…" : dirty || nothingLive ? "Publier" : "Republier"}
            </button>
            {dirty && live.version !== null && (
              <button type="button" onClick={() => void reopen()} disabled={busy}>
                Annuler mes modifications
              </button>
            )}
          </div>

          {/* Un bouton grisé sans explication laisse chercher. */}
          {items.length === 0 && actualites === 0 && (
            <p className="hint">
              Ajoutez au moins un contenu, ou des actualités du site, pour pouvoir publier.
            </p>
          )}
          {invalidText && <p className="hint">Un texte sans titre ne peut pas être publié.</p>}
          {!dirty && live.reopenable && live.version !== null && items.length > 0 && (
            <p className="hint">C'est exactement ce que l'écran diffuse en ce moment.</p>
          )}
        </div>
      </section>

      <div style={{ marginTop: 20 }}>
        <MachineÀRemonterLeTemps instant={instantSimulé} onChange={setInstantSimulé} items={items} />
        <ScreenPreview
          manifest={preview}
          screenCode={screen.code}
          error={previewError}
          {...(instantSimulé !== null ? { instant: instantSimulé } : {})}
        />
      </div>
    </>
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
