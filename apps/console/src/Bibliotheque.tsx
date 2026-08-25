import { useRef } from "react";
import { type Media, humanSize } from "./api.js";

/**
 * La bibliothèque, en colonne permanente.
 *
 * Elle passe à gauche et ne bouge plus : on compose en piochant dedans, et
 * la faire défiler avec le reste obligeait à remonter à chaque ajout.
 *
 * Chaque média dit **où il passe**. C'est l'information qui manquait : sans
 * elle, on ne sait pas si retirer une affiche va vider un couloir, ni
 * lesquels des trente fichiers importés depuis septembre servent encore.
 */

export function Bibliotheque({
  media,
  usage,
  onAjouter,
  onAjouterTexte,
  onImporter,
  glissable = false,
}: {
  media: Media[];
  /** Combien d'écrans diffusent chaque média. */
  usage: Record<string, number>;
  onAjouter: (m: Media) => void;
  onAjouterTexte?: () => void;
  onImporter: (fichier: File) => void;
  glissable?: boolean;
}) {
  const champ = useRef<HTMLInputElement>(null);

  return (
    <aside className="biblio">
      <div className="biblio-entete">
        <h2>Bibliothèque</h2>
        <p>{glissable ? "Glissez un contenu dans la journée." : "Cliquez pour l'ajouter à la rotation."}</p>
      </div>

      <div className="biblio-liste">
        {media.length === 0 && (
          <p className="hint">Aucun média. Importez une affiche ou une vidéo pour commencer.</p>
        )}

        {media.map((m) => {
          const n = usage[m.id] ?? 0;
          return (
            <div
              key={m.id}
              className="biblio-ligne"
              role="button"
              tabIndex={0}
              draggable={glissable}
              title={`${m.filename ?? m.id} — ${humanSize(m.bytes)}`}
              onClick={() => onAjouter(m)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onAjouter(m);
                }
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData("application/couloir", `media:${m.id}`);
                e.dataTransfer.effectAllowed = "copy";
              }}
            >
              <span className="biblio-vignette">
                {m.mime.startsWith("image/") ? (
                  <img src={`/v1/assets/${m.id}`} alt="" draggable={false} />
                ) : (
                  <span className="biblio-kind">{m.mime.split("/")[1] ?? "fichier"}</span>
                )}
              </span>

              <span className="biblio-texte">
                <span className="biblio-nom">{m.filename ?? m.id}</span>
                <span className="biblio-usage">
                  {m.mime.startsWith("video/") ? "vidéo" : "image"} ·{" "}
                  {n === 0 ? (
                    <span className="biblio-nulle-part">nulle part</span>
                  ) : (
                    <span className="biblio-quelque-part">
                      sur {n} écran{n > 1 ? "s" : ""}
                    </span>
                  )}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="biblio-pied">
        <input
          ref={champ}
          type="file"
          accept="image/*,video/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImporter(f);
            if (champ.current) champ.current.value = "";
          }}
        />
        <button type="button" className="biblio-ajout" onClick={() => champ.current?.click()}>
          Importer un fichier
        </button>
        {onAjouterTexte && (
          <button type="button" className="biblio-ajout" onClick={onAjouterTexte}>
            Écrire un texte
          </button>
        )}
      </div>
    </aside>
  );
}
