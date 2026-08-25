import type { Media, PublishItem } from "./api.js";
import type { Draft } from "./brouillon.js";
import { Periode } from "./Periode.js";

/**
 * Le volet « Contenu ».
 *
 * Ce qu'on diffuse : la rotation, le bandeau, les actualités du site. Sorti
 * de l'éditeur, qui mêlait sur mille lignes trois questions sans rapport —
 * ce qu'on diffuse aujourd'hui, quand ça paraît, et comment l'écran est réglé.
 *
 * L'état reste chez l'éditeur : c'est une seule composition qu'on modifie, et
 * la découper en états séparés ferait diverger l'aperçu de ce qu'on publie.
 */


export function VoletContenu({
  media,
  items,
  setItems,
  ticker,
  setTicker,
  actualites,
  setActualites,
  sourceActive,
  move,
  touch,
}: {
  media: Media[];
  items: Draft[];
  setItems: (f: (c: Draft[]) => Draft[]) => void;
  ticker: string;
  setTicker: (v: string) => void;
  /** Combien d'articles du site tournent avec le reste. 0 = aucun. */
  actualites: number;
  setActualites: (v: number) => void;
  /** Nul tant qu'on ne sait pas ; faux quand aucune source n'est configurée. */
  sourceActive: boolean | null;
  /** Avance ou recule un contenu dans la rotation. */
  move: (key: string, direction: 1 | -1) => void;
  /** Marque la composition comme modifiée, et applique le changement. */
  touch: (apply: () => void) => void;
}) {
  return (
    <>
{/*
  La bibliothèque était ici ET dans la colonne de gauche — deux
  grilles des mêmes fichiers, deux boutons « Importer », et la
  rotation réduite à deux vignettes par rangée pour loger la copie.
  Elle reste où elle sert : à côté, en permanence, quel que soit le
  volet ouvert.
*/}
<div className="field">
  <label>Contenus à diffuser</label>
  {items.length === 0 ? (
    <p className="hint">Cliquez sur un média ci-dessus, ou ajoutez un texte.</p>
  ) : (
    /*
     * Des vignettes, et non des lignes.
     *
     * La rotation est une suite d'images : en lignes, on relisait
     * douze noms de fichiers pour retrouver l'affiche à retirer, et
     * « affiche-po-2026 » ne dit pas de quoi elle a l'air. La
     * vignette montre ce qui passera, et le rang se lit dessus.
     */
    <div className="rotation">
      {items.map((item, index) => {
        // Le type du fichier vient de la bibliothèque : le brouillon
        // ne porte que son identifiant.
        const mime = media.find((m) => m.id === item.assetId)?.mime;
        return (
        <div className="rotation-carte" key={item.key}>
          <div className="rotation-vignette">
            {item.text ? (
              <span className="rotation-texte">{item.text.titre || "Sans titre"}</span>
            ) : mime?.startsWith("image/") ? (
              <img src={`/v1/assets/${item.assetId}`} alt="" />
            ) : (
              <span className="rotation-type">{mime?.split("/")[1] ?? "fichier"}</span>
            )}
            <span className="rotation-rang">{String(index + 1).padStart(2, "0")}</span>
            <button
              type="button"
              className="rotation-retirer"
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
          </div>

          <div className="rotation-corps">
            {item.text ? (
              <input
                className="rotation-titre"
                value={item.text.titre}
                placeholder="Titre affiché à l'écran"
                aria-label={`Titre du contenu ${index + 1}`}
                aria-invalid={!item.text.titre.trim()}
                onChange={(e) =>
                  touch(() =>
                    setItems((current) =>
                      current.map((it) =>
                        it.key === item.key
                          ? { ...it, text: { titre: e.target.value } }
                          : it,
                      ),
                    ),
                  )
                }
              />
            ) : (
              <span className="rotation-nom" title={item.title}>
                {item.title}
              </span>
            )}

            <div className="rotation-reglages">
              {item.durationMs === undefined ? (
                <span className="hint" title="Une vidéo dure le temps qu'elle dure">
                  durée vidéo
                </span>
              ) : (
                <label className="rotation-duree">
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
                              ? {
                                  ...it,
                                  durationMs: Math.max(1, Number(e.target.value)) * 1000,
                                }
                              : it,
                          ),
                        ),
                      )
                    }
                  />
                  <span>s</span>
                </label>
              )}

              {!item.text && (
                <button
                  type="button"
                  className="ajustement"
                  aria-pressed={item.fit === "remplir"}
                  title={
                    item.fit === "remplir"
                      ? "L'image couvre toute la zone, quitte à rogner les bords."
                      : "L'image tient en entier, quitte à laisser des bandes."
                  }
                  onClick={() =>
                    touch(() =>
                      setItems((current) =>
                        current.map((it) =>
                          it.key === item.key
                            ? ({
                                ...it,
                                ...(it.fit === "remplir"
                                  ? { fit: undefined }
                                  : { fit: "remplir" as const }),
                              } as Draft)
                            : it,
                        ),
                      ),
                    )
                  }
                >
                  {item.fit === "remplir" ? "Remplit" : "Entière"}
                </button>
              )}
            </div>

            <div className="rotation-pied">
              <Periode
                valeur={item.visibility}
                libellé={`Contenu ${index + 1}`}
                onChange={(v) =>
                  touch(() =>
                    setItems((current) =>
                      current.map((it) =>
                        it.key === item.key ? ({ ...it, visibility: v } as Draft) : it,
                      ),
                    ),
                  )
                }
              />
              <span className="rotation-ordre">
                <button
                  type="button"
                  aria-label={`Avancer le contenu ${index + 1}`}
                  title="Avancer dans la rotation"
                  disabled={index === 0}
                  onClick={() => move(item.key, -1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label={`Reculer le contenu ${index + 1}`}
                  title="Reculer dans la rotation"
                  disabled={index === items.length - 1}
                  onClick={() => move(item.key, 1)}
                >
                  →
                </button>
              </span>
            </div>
          </div>
        </div>
        );
      })}
    </div>
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
    </>
  );
}
