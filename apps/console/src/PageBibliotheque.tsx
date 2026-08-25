import { useEffect, useMemo, useRef, useState } from "react";
import { type Media, type PublishSpec, type ScreenStatus, api, humanSize } from "./api.js";
import { phraseDUsage, usageDesMedias } from "./usageDesMedias.js";

/**
 * La bibliothèque, page entière.
 *
 * Elle existait déjà en colonne dans l'éditeur, où elle sert à composer. Ici
 * on ne compose pas : on fait le ménage. La question posée est l'inverse —
 * non pas « qu'est-ce que je mets sur cet écran », mais « qu'est-ce qui
 * traîne dans le serveur, et est-ce que ça passe quelque part ».
 *
 * D'où la seule colonne qui compte : où passe chaque média. Sans elle, la
 * bibliothèque grossit d'une affiche de portes ouvertes, de sa version
 * corrigée et de celle de l'an dernier, et plus personne n'ose rien retirer.
 */

/** Les dimensions d'une image, lues du navigateur qui vient de la charger. */
function useDimensions() {
  const [tailles, setTailles] = useState<Record<string, string>>({});
  const noter = (id: string, image: HTMLImageElement) => {
    if (!image.naturalWidth) return;
    setTailles((actuelles) =>
      actuelles[id]
        ? actuelles
        : { ...actuelles, [id]: `${image.naturalWidth} × ${image.naturalHeight}` },
    );
  };
  return [tailles, noter] as const;
}

export function PageBibliotheque() {
  const [media, setMedia] = useState<Media[]>([]);
  const [parc, setParc] = useState<{
    screens: ScreenStatus[];
    compositions: Record<string, PublishSpec | null>;
  }>({ screens: [], compositions: {} });
  const [filtre, setFiltre] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [survol, setSurvol] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  const [dimensions, noterDimensions] = useDimensions();

  async function recharger() {
    const [{ media: liste }, écrans] = await Promise.all([api.media(), api.screens(false, true)]);
    setMedia(liste);
    setParc({ screens: écrans.screens, compositions: écrans.compositions ?? {} });
  }

  useEffect(() => {
    void recharger().catch((cause) =>
      setErreur(cause instanceof Error ? cause.message : String(cause)),
    );
  }, []);

  const usage = useMemo(
    () => usageDesMedias(parc.screens, parc.compositions),
    [parc],
  );

  async function importer(fichiers: FileList | null) {
    if (!fichiers?.length) return;
    setEnvoi(true);
    setErreur(null);
    try {
      for (const fichier of Array.from(fichiers)) await api.upload(fichier);
      await recharger();
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setEnvoi(false);
    }
  }

  const visibles = media.filter((m) =>
    (m.filename ?? m.id).toLowerCase().includes(filtre.trim().toLowerCase()),
  );
  const octets = media.reduce((total, m) => total + m.bytes, 0);
  const orphelins = media.filter((m) => !usage.has(m.id)).length;

  return (
    <div className="mediatheque">
      <header className="mediatheque-tete">
        <div>
          <h1>Bibliothèque</h1>
          <p>
            {media.length === 0
              ? "Rien pour l'instant."
              : `${media.length} média${media.length > 1 ? "s" : ""} · ${humanSize(octets)}.`}
            {orphelins > 0 &&
              ` ${orphelins} ne passe${orphelins > 1 ? "nt" : ""} nulle part.`}
          </p>
        </div>
        <div className="mediatheque-outils">
          <input
            type="search"
            value={filtre}
            placeholder="Filtrer par nom"
            aria-label="Filtrer par nom"
            onChange={(e) => setFiltre(e.target.value)}
          />
          <button type="button" className="primary" onClick={() => champ.current?.click()}>
            {envoi ? "Import…" : "Importer un fichier"}
          </button>
          <input
            ref={champ}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              void importer(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      {erreur && <p className="notice error">{erreur}</p>}

      <div
        className={survol ? "mediatheque-grille mediatheque-grille--survol" : "mediatheque-grille"}
        onDragOver={(e) => {
          e.preventDefault();
          setSurvol(true);
        }}
        onDragLeave={() => setSurvol(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSurvol(false);
          void importer(e.dataTransfer.files);
        }}
      >
        {visibles.map((m) => {
          const écrans = usage.get(m.id) ?? [];
          return (
            <div className="media-carte" key={m.id}>
              <div className="media-carte-vignette">
                {m.mime.startsWith("image/") ? (
                  <img
                    src={`/v1/assets/${m.id}`}
                    alt=""
                    onLoad={(e) => noterDimensions(m.id, e.currentTarget)}
                  />
                ) : (
                  <span className="media-carte-type">{m.mime.split("/")[1] ?? "fichier"}</span>
                )}
              </div>
              <div className="media-carte-texte">
                <span className="media-carte-nom" title={m.filename ?? m.id}>
                  {m.filename ?? m.id}
                </span>
                <span className="media-carte-poids">
                  {humanSize(m.bytes)}
                  {dimensions[m.id] ? ` · ${dimensions[m.id]}` : ""}
                </span>
                <span
                  className={
                    écrans.length === 0 ? "media-usage media-usage--nulle-part" : "media-usage"
                  }
                  title={écrans.map((s) => s.label).join(", ") || undefined}
                >
                  {phraseDUsage(écrans.length)}
                </span>
              </div>
            </div>
          );
        })}

        <button
          type="button"
          className="media-depot"
          onClick={() => champ.current?.click()}
          disabled={envoi}
        >
          <span className="media-depot-plus">+</span>
          <span>Déposez une affiche ou une vidéo ici</span>
        </button>
      </div>

      {media.length > 0 && visibles.length === 0 && (
        <p className="hint">Aucun média ne porte ce nom.</p>
      )}

      <p className="mediatheque-note">
        Les écrans téléchargent leurs médias et les gardent : une affiche de 2 Mo passe une fois
        sur le réseau, pas à chaque tour de rotation. Un média qui ne passe nulle part n'occupe
        que le serveur.
      </p>
    </div>
  );
}
