import { useEffect, useRef, useState } from "react";
import { type DisplayOffWindow, type Media, type PublishItem, humanSize } from "./api.js";
import { type Relais, disposerLesBlocs, enFrancais, finDeJournee } from "./journee.js";

/**
 * La journée d'un écran, en tranches horaires.
 *
 * On glisse une affiche dans un créneau, et elle ne paraîtra qu'à ce
 * moment-là. C'est la même donnée que la période d'affichage réglée
 * ailleurs — une autre façon de l'éditer, pas un autre mécanisme.
 *
 * On voit d'un coup ce que l'écran montrera dans la journée, y compris les
 * trous. Un trou n'est pas une erreur : c'est là que le contenu par défaut
 * prend la main, et la vue le dit.
 */

/** L'amplitude affichée. Une école ne programme rien à trois heures du matin. */
const DEBUT_JOURNEE = 7;
const FIN_JOURNEE = 20;
const HEURES = Array.from({ length: FIN_JOURNEE - DEBUT_JOURNEE }, (_, i) => DEBUT_JOURNEE + i);

/**
 * En dessous, le bloc se met sur une ligne.
 *
 * Douze pour cent de l'amplitude, soit une heure et demie : c'est en dessous
 * que la vignette et les deux heures ne tiennent plus l'une sous l'autre.
 */
const HAUTEUR_MINIMALE_POUR_DEUX_LIGNES = 12;

type Draft = PublishItem & { key: string; title: string };

function enMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function enHeure(minutes: number): string {
  const m = Math.max(0, Math.min(minutes, 24 * 60 - 1));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Où se place un contenu dans la journée, en pourcentage de l'amplitude. */
function position(item: Draft): { debut: number; hauteur: number } | null {
  const v = item.visibility;
  if (!v?.dailyStart || !v.dailyEnd) return null;

  const amplitude = (FIN_JOURNEE - DEBUT_JOURNEE) * 60;
  const depuis = DEBUT_JOURNEE * 60;
  const debut = enMinutes(v.dailyStart) - depuis;
  let fin = enMinutes(v.dailyEnd) - depuis;
  // Une plage qui passe minuit s'arrête au bas de la vue : la journée
  // affichée ne va pas au-delà, et l'étirer mentirait sur sa durée.
  if (fin <= debut) fin = amplitude;

  return {
    debut: Math.max(0, (debut / amplitude) * 100),
    hauteur: Math.max(3, ((Math.min(fin, amplitude) - Math.max(debut, 0)) / amplitude) * 100),
  };
}

export function VueJour({
  items,
  media,
  displayOff,
  parDefaut,
  onChange,
}: {
  items: Draft[];
  media: Media[];
  /** Les plages d'extinction de l'écran, pour dire quand la dalle s'éteint. */
  displayOff?: DisplayOffWindow[];
  /** Ce que l'écran montre quand rien n'est programmé. */
  parDefaut?: { assetId?: string; emploiDuTemps?: boolean };
  onChange: (items: Draft[]) => void;
}) {
  const grille = useRef<HTMLDivElement>(null);
  const [survolé, setSurvolé] = useState<number | null>(null);
  /**
   * L'heure qu'il est, pour le trait de « maintenant ».
   *
   * À la minute : un trait qui saute d'une heure entière se remarquerait
   * comme une panne, et à la seconde on redessinerait pour rien.
   */
  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => {
    const horloge = setInterval(() => setMaintenant(new Date()), 60_000);
    return () => clearInterval(horloge);
  }, []);

  const programmés = items.filter((i) => position(i) !== null);
  const permanents = items.filter((i) => position(i) === null);

  // Deux affiches aux horaires qui se croisent se recouvraient : la seconde
  // cachait la première, qu'on ne pouvait plus ni lire ni attraper.
  const placements = disposerLesBlocs(
    programmés.map((i) => ({
      debut: enMinutes(i.visibility!.dailyStart!),
      fin: Math.max(
        enMinutes(i.visibility!.dailyStart!) + 15,
        enMinutes(i.visibility!.dailyEnd!),
      ),
    })),
  );

  const relais: Relais = permanents.length > 0
    ? { quoi: "permanents" }
    : parDefaut?.emploiDuTemps
      ? { quoi: "emploiDuTemps" }
      : parDefaut?.assetId
        ? { quoi: "media", nom: media.find((m) => m.id === parDefaut.assetId)?.filename ?? "le contenu par défaut" }
        : { quoi: "rien" };

  const aprèsCoup = finDeJournee({
    fins: programmés.map((i) => enMinutes(i.visibility!.dailyEnd!)),
    relais,
    ...(displayOff ? { extinctions: displayOff } : {}),
  });

  const minutesMaintenant = maintenant.getHours() * 60 + maintenant.getMinutes();
  const partMaintenant =
    (minutesMaintenant - DEBUT_JOURNEE * 60) / ((FIN_JOURNEE - DEBUT_JOURNEE) * 60);

  /** L'heure sous le curseur, arrondie au quart d'heure. */
  function heureSous(clientY: number): number {
    const cadre = grille.current?.getBoundingClientRect();
    if (!cadre) return DEBUT_JOURNEE * 60;
    const part = (clientY - cadre.top) / cadre.height;
    const minutes = DEBUT_JOURNEE * 60 + part * (FIN_JOURNEE - DEBUT_JOURNEE) * 60;
    return Math.max(DEBUT_JOURNEE * 60, Math.min(Math.round(minutes / 15) * 15, FIN_JOURNEE * 60 - 60));
  }

  function déposer(event: React.DragEvent) {
    event.preventDefault();
    setSurvolé(null);

    const donnees = event.dataTransfer.getData("application/couloir");
    if (!donnees) return;

    const debut = heureSous(event.clientY);
    // Une heure par défaut : assez pour être visible dans la vue, assez
    // court pour qu'on pense à l'ajuster.
    const fin = Math.min(debut + 60, FIN_JOURNEE * 60);

    if (donnees.startsWith("media:")) {
      const id = donnees.slice(6);
      const m = media.find((x) => x.id === id);
      if (!m) return;
      onChange([
        ...items,
        {
          key: `${id}-${Date.now()}`,
          assetId: id,
          title: m.filename ?? id,
          ...(m.mime.startsWith("video/") ? {} : { durationMs: 12_000 }),
          visibility: { dailyStart: enHeure(debut), dailyEnd: enHeure(fin) },
        },
      ]);
      return;
    }

    if (donnees.startsWith("item:")) {
      const clef = donnees.slice(5);
      onChange(
        items.map((i) =>
          i.key === clef
            ? {
                ...i,
                visibility: {
                  ...i.visibility,
                  dailyStart: enHeure(debut),
                  dailyEnd: enHeure(
                    debut +
                      (i.visibility?.dailyStart && i.visibility.dailyEnd
                        ? Math.max(15, enMinutes(i.visibility.dailyEnd) - enMinutes(i.visibility.dailyStart))
                        : 60),
                  ),
                },
              }
            : i,
        ),
      );
    }
  }

  function ajusterHeures(clef: string, champ: "dailyStart" | "dailyEnd", valeur: string) {
    onChange(
      items.map((i) =>
        i.key === clef ? { ...i, visibility: { ...i.visibility, [champ]: valeur } } : i,
      ),
    );
  }

  function retirerLaPlage(clef: string) {
    onChange(
      items.map((i) => {
        if (i.key !== clef) return i;
        const { dailyStart, dailyEnd, ...reste } = i.visibility ?? {};
        const vide = Object.values(reste).every((v) => v === undefined);
        return { ...i, ...(vide ? { visibility: undefined } : { visibility: reste }) };
      }),
    );
  }

  return (
    <div className="jour">
      <div className="jour-bibliotheque">
        <p className="jour-consigne">
          Glissez un média dans la journée pour dire quand il paraîtra.
        </p>
        {media.length === 0 ? (
          <p className="hint">Aucun média. Importez-en depuis l'onglet Contenu.</p>
        ) : (
          <div className="media-grid">
            {media.map((m) => (
              <div
                key={m.id}
                className="media-tile"
                draggable
                role="button"
                tabIndex={0}
                title={`${m.filename ?? m.id} — ${humanSize(m.bytes)}`}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/couloir", `media:${m.id}`);
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                {m.mime.startsWith("image/") ? (
                  <img src={`/v1/assets/${m.id}`} alt="" draggable={false} />
                ) : (
                  <span className="kind">{m.mime.split("/")[1] ?? "fichier"}</span>
                )}
                <span className="name">{m.filename ?? m.id}</span>
              </div>
            ))}
          </div>
        )}

        {permanents.length > 0 && (
          <div className="jour-permanents">
            <h3>Toute la journée</h3>
            <p className="hint">
              Ces contenus n'ont pas d'horaire : ils tournent en continu. Glissez-en un dans la
              journée pour lui en donner un.
            </p>
            {permanents.map((i) => (
              <div
                key={i.key}
                className="jour-permanent"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/couloir", `item:${i.key}`);
                  e.dataTransfer.effectAllowed = "move";
                }}
              >
                {i.title}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="jour-grille-cadre">
        <div className="jour-heures">
          {HEURES.map((h) => (
            <span key={h} className="jour-heure">
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>

        <div
          className={`jour-grille ${survolé !== null ? "survolee" : ""}`}
          ref={grille}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setSurvolé(heureSous(e.clientY));
          }}
          onDragLeave={() => setSurvolé(null)}
          onDrop={déposer}
        >
          {HEURES.map((h) => (
            <div key={h} className="jour-tranche" />
          ))}

          {survolé !== null && (
            <div
              className="jour-repere"
              style={{
                top: `${((survolé - DEBUT_JOURNEE * 60) / ((FIN_JOURNEE - DEBUT_JOURNEE) * 60)) * 100}%`,
              }}
            >
              {enHeure(survolé)}
            </div>
          )}

          {/* Où en est la journée. Sans ce trait, on programme une affiche
              pour « tout à l'heure » sans voir qu'il est déjà passé. */}
          {partMaintenant >= 0 && partMaintenant <= 1 && (
            <div className="jour-maintenant" style={{ top: `${partMaintenant * 100}%` }}>
              <span>{enFrancais(minutesMaintenant)}</span>
            </div>
          )}

          {programmés.map((i, rang) => {
            const p = position(i)!;
            const place = placements[rang] ?? { colonne: 0, colonnes: 1 };
            const largeur = 100 / place.colonnes;
            /*
             * Un créneau court n'a pas la hauteur de deux lignes : la
             * vignette et les heures débordaient sous le bloc suivant, donc
             * hors d'atteinte. En dessous, tout tient sur une ligne.
             */
            const court = p.hauteur < HAUTEUR_MINIMALE_POUR_DEUX_LIGNES;
            return (
              <div
                key={i.key}
                className={court ? "jour-bloc jour-bloc--court" : "jour-bloc"}
                style={{
                  top: `${p.debut}%`,
                  height: `${p.hauteur}%`,
                  left: `calc(${place.colonne * largeur}% + 6px)`,
                  width: `calc(${largeur}% - 12px)`,
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/couloir", `item:${i.key}`);
                  e.dataTransfer.effectAllowed = "move";
                }}
              >
                <span className="jour-bloc-tete">
                  {/* La vignette du média : dans une journée chargée, on
                      reconnaît une affiche à son image avant son nom. */}
                  {court ? null : i.assetId &&
                    media.find((m) => m.id === i.assetId)?.mime.startsWith("image/") ? (
                    <img className="jour-bloc-vignette" src={`/v1/assets/${i.assetId}`} alt="" />
                  ) : (
                    <span className="jour-bloc-vignette jour-bloc-vignette--sans" />
                  )}
                  <span className="jour-bloc-titre">{i.title}</span>
                  <button
                    type="button"
                    className="jour-bloc-retirer"
                    aria-label={`Retirer l'horaire de ${i.title}`}
                    title="Toute la journée"
                    onClick={() => retirerLaPlage(i.key)}
                  >
                    ✕
                  </button>
                </span>
                <span className="jour-bloc-heures">
                  <input
                    type="time"
                    value={i.visibility?.dailyStart ?? ""}
                    aria-label={`Début de ${i.title}`}
                    onChange={(e) => ajusterHeures(i.key, "dailyStart", e.target.value)}
                  />
                  <input
                    type="time"
                    value={i.visibility?.dailyEnd ?? ""}
                    aria-label={`Fin de ${i.title}`}
                    onChange={(e) => ajusterHeures(i.key, "dailyEnd", e.target.value)}
                  />
                </span>
              </div>
            );
          })}
        </div>

        {programmés.length === 0 ? (
          <p className="hint jour-vide">
            Rien n'est programmé à une heure précise. Les contenus tournent toute la journée, et le
            contenu par défaut prend la main s'il n'y en a aucun.
          </p>
        ) : (
          aprèsCoup && (
            <p className="jour-apres">
              <span className="jour-apres-pastille" />
              {aprèsCoup}
            </p>
          )
        )}
      </div>
    </div>
  );
}
