import { useEffect, useRef, useState } from "react";
import { type Media, type PublishSpec, type ScreenStatus, api, humanSize } from "./api.js";

/**
 * Diffuser un contenu sur plusieurs écrans.
 *
 * Le geste que la console ne savait pas faire : une affiche se pose sur cinq
 * couloirs en une fois, au lieu de cinq passages dans l'éditeur.
 *
 * Chaque écran garde ses propres réglages — mise en page, emploi du temps,
 * heure d'extinction. Les écraser reviendrait à reconfigurer cinq écrans pour
 * publier une image, et personne ne s'en apercevrait avant de passer devant.
 */

export function DiffusionGroupee({
  ecrans,
  onFait,
  onFermer,
}: {
  ecrans: ScreenStatus[];
  onFait: () => void;
  onFermer: () => void;
}) {
  const [media, setMedia] = useState<Media[]>([]);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [ticker, setTicker] = useState("");
  const [occupé, setOccupé] = useState(false);
  const [resultats, setResultats] = useState<
    { screenId: string; code?: string; version?: number; erreur?: string }[] | null
  >(null);
  const fichier = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.media().then((r) => setMedia(r.media)).catch(() => {});
  }, []);

  async function diffuser() {
    if (!choisi) return;
    setOccupé(true);
    try {
      const spec: PublishSpec = {
        layout: "plein-ecran",
        items: [{ assetId: choisi, durationMs: 12_000 }],
        ...(ticker.trim() ? { ticker: ticker.trim() } : {}),
      };
      const r = await api.publierGroupe(
        ecrans.map((e) => e.id),
        spec,
      );
      setResultats(r.resultats);
      onFait();
    } catch (cause) {
      setResultats([
        { screenId: "", erreur: cause instanceof Error ? cause.message : String(cause) },
      ]);
    } finally {
      setOccupé(false);
    }
  }

  if (resultats) {
    const réussis = resultats.filter((r) => r.version !== undefined);
    const refusés = resultats.filter((r) => r.erreur);
    return (
      <div className="modale-fond" onClick={onFermer}>
        <div className="modale" onClick={(e) => e.stopPropagation()}>
          <h2>{réussis.length > 0 ? "C'est diffusé" : "Rien n'a été diffusé"}</h2>

          {réussis.length > 0 && (
            <p className="notice">
              {réussis.length} écran{réussis.length > 1 ? "s" : ""} —{" "}
              {réussis.map((r) => r.code).join(", ")}. Ils l'affichent à l'instant.
            </p>
          )}

          {refusés.length > 0 && (
            <div className="notice error">
              <p style={{ margin: 0 }}>Ces écrans n'ont rien reçu :</p>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {refusés.map((r) => (
                  <li key={r.screenId}>
                    <b>{r.code ?? "écran inconnu"}</b> — {r.erreur}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="hint">
            Chaque écran a gardé sa mise en page et ses réglages : seule la rotation a changé.
          </p>

          <div className="row-actions">
            <button type="button" className="primary" onClick={onFermer}>
              Fermer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modale-fond" onClick={onFermer}>
      <div className="modale large" onClick={(e) => e.stopPropagation()}>
        <h2>Diffuser sur {ecrans.length} écran{ecrans.length > 1 ? "s" : ""}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {ecrans.map((e) => e.label).join(" · ")}
        </p>

        <div className="field">
          <label>Le contenu à diffuser</label>
          {media.length === 0 ? (
            <p className="hint">Aucun média. Importez-en un.</p>
          ) : (
            <div className="media-grid">
              {media.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="media-tile"
                  aria-pressed={choisi === m.id}
                  title={`${m.filename ?? m.id} — ${humanSize(m.bytes)}`}
                  onClick={() => setChoisi(choisi === m.id ? null : m.id)}
                >
                  {m.mime.startsWith("image/") ? (
                    <img src={`/v1/assets/${m.id}`} alt="" />
                  ) : (
                    <span className="kind">{m.mime.split("/")[1] ?? "fichier"}</span>
                  )}
                  <span className="name">{m.filename ?? m.id}</span>
                </button>
              ))}
            </div>
          )}
          <div className="row-actions">
            <input
              ref={fichier}
              type="file"
              accept="image/*,video/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                void api.upload(f).then(({ media: ajouté }) => {
                  setMedia((c) => [ajouté, ...c]);
                  setChoisi(ajouté.id);
                });
              }}
            />
            <button type="button" onClick={() => fichier.current?.click()}>
              Importer un fichier
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="dg-ticker">Bandeau défilant</label>
          <input
            id="dg-ticker"
            value={ticker}
            placeholder="facultatif"
            onChange={(e) => setTicker(e.target.value)}
          />
        </div>

        <p className="hint">
          Chaque écran garde sa mise en page, son emploi du temps et son heure d'extinction. Seule
          la rotation change.
        </p>

        <div className="row-actions">
          <button type="button" className="primary" onClick={() => void diffuser()} disabled={!choisi || occupé}>
            {occupé ? "Diffusion…" : `Diffuser sur ${ecrans.length} écran${ecrans.length > 1 ? "s" : ""}`}
          </button>
          <button type="button" onClick={onFermer} disabled={occupé}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
