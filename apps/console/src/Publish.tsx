import { useEffect, useRef, useState } from "react";
import { type Media, type PublishItem, type SchoolClass, type ScreenStatus, api, humanSize } from "./api.js";

/**
 * Le panneau de publication.
 *
 * Volontairement pauvre en options : on choisit une mise en page, on empile
 * des contenus, on publie. Les playlists nommées, la programmation calendaire
 * et les gabarits viendront — mais ce parcours-là doit rester faisable en
 * moins d'une minute, parce que c'est celui de tous les jours.
 */

type Draft = PublishItem & { key: string; title: string };

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
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.media().then((r) => setMedia(r.media)).catch(() => {});
  }, []);

  // Changer d'écran remet la composition à zéro : publier par erreur le
  // brouillon d'un autre couloir serait pire que de tout ressaisir.
  useEffect(() => {
    setItems([]);
    setTicker("");
    setMessage(null);
  }, [screen.id]);

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
    setItems((current) => [
      ...current,
      {
        key: `${item.id}-${current.length}`,
        assetId: item.id,
        title: item.filename ?? item.id,
        ...(item.mime.startsWith("video/") ? {} : { durationMs: 12_000 }),
      },
    ]);
  }

  function addText() {
    setItems((current) => [
      ...current,
      { key: `texte-${current.length}`, text: { titre: "" }, title: "Texte", durationMs: 12_000 },
    ]);
  }

  async function publish() {
    setBusy(true);
    setMessage(null);
    try {
      const { version } = await api.publish(screen.id, {
        layout,
        items: items.map(({ key, title, ...item }) => item),
        ...(ticker.trim() ? { ticker: ticker.trim() } : {}),
        ...(layout === "principal-et-cours" && classIds.length > 0 ? { timetableClassIds: classIds } : {}),
      });
      setMessage({ text: `Publié en version ${version}. L'écran l'affichera dans la minute.` });
      onPublished();
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : String(cause), error: true });
    } finally {
      setBusy(false);
    }
  }

  const ready = items.length > 0 && items.every((item) => !item.text || item.text.titre.trim());

  return (
    <section className="panel">
      <header>
        <h2>Publier sur {screen.code}</h2>
        <span className="spacer" />
        <span className={`pill ${screen.online ? "accent" : "warn"}`}>
          {screen.online ? "en ligne" : "hors ligne"}
        </span>
      </header>

      <div className="body">
        {message && <p className={`notice ${message.error ? "error" : ""}`}>{message.text}</p>}

        {!screen.online && (
          <p className="hint" style={{ marginBottom: 12 }}>
            Cet écran ne répond pas. La publication est enregistrée : il l'appliquera à son retour.
          </p>
        )}

        <div className="field">
          <label htmlFor="layout">Mise en page</label>
          <select id="layout" value={layout} onChange={(e) => setLayout(e.target.value as typeof layout)}>
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
                          setClassIds((current) =>
                            selected
                              ? current.filter((id) => id !== schoolClass.id)
                              : [...current, schoolClass.id],
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
            <p className="hint">Aucun média pour l'instant.</p>
          ) : (
            <div className="media-grid">
              {media.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="media-tile"
                  title={`${item.filename ?? item.id} — ${humanSize(item.bytes)}`}
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

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
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
            <p className="hint">Cliquez sur un média, ou ajoutez un texte.</p>
          ) : (
            items.map((item, index) => (
              <div className="slide-row" key={item.key}>
                <span className="index">{String(index + 1).padStart(2, "0")}</span>

                {item.text ? (
                  <input
                    value={item.text.titre}
                    placeholder="Titre affiché à l'écran"
                    onChange={(e) =>
                      setItems((current) =>
                        current.map((it) =>
                          it.key === item.key ? { ...it, text: { titre: e.target.value } } : it,
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
                    aria-label="Durée en secondes"
                    onChange={(e) =>
                      setItems((current) =>
                        current.map((it) =>
                          it.key === item.key
                            ? { ...it, durationMs: Math.max(1, Number(e.target.value)) * 1000 }
                            : it,
                        ),
                      )
                    }
                  />
                )}

                <button
                  type="button"
                  className="ghost"
                  aria-label={`Retirer le contenu ${index + 1}`}
                  onClick={() => setItems((current) => current.filter((it) => it.key !== item.key))}
                >
                  ✕
                </button>
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
            onChange={(e) => setTicker(e.target.value)}
          />
        </div>

        <button type="button" className="primary" onClick={publish} disabled={!ready || busy}>
          {busy ? "Publication…" : "Publier"}
        </button>
        {!ready && items.length > 0 && (
          <p className="hint">Un texte sans titre ne peut pas être publié.</p>
        )}
      </div>
    </section>
  );
}
