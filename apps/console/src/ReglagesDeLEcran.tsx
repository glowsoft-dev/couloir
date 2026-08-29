import type { ChampEdt, DisplayOffWindow, Media, PublishSpec, SchoolClass, ScreenStatus } from "./api.js";
import { CHAMPS_EDT } from "./api.js";
import { MiseEnPage } from "./MiseEnPage.js";
import { Schedule } from "./Schedule.js";

/**
 * Le volet « Réglages de l'écran ».
 *
 * Ce qu'on pose une fois : mise en page, colonnes de l'emploi du temps,
 * extinction, contenu de repli. Sorti de l'éditeur, qui mêlait sur mille
 * lignes trois questions sans rapport — ce qu'on diffuse aujourd'hui, quand
 * ça paraît, et comment l'écran est réglé.
 *
 * L'état reste chez l'éditeur : c'est une seule composition qu'on modifie, et
 * la découper en états séparés ferait diverger l'aperçu de ce qu'on publie.
 * Les propriétés sont donc nombreuses, et c'est ce qui les rend lisibles :
 * on voit d'un coup ce que ce volet touche.
 */
/**
 * Le zoom, nommé par ce qui le décide.
 *
 * Un pourcentage ne se choisit pas : personne ne sait si son écran veut
 * 130 % ou 160 %. La distance, elle, se mesure du regard depuis l'endroit
 * où passent les gens — et c'est la seule chose que le rendu ne peut pas
 * déduire tout seul de la dalle.
 */
const DISTANCES = [
  { libelle: "Tout près", zoom: 0.85, aide: "Un comptoir, un guichet : moins de deux mètres." },
  { libelle: "Couloir", zoom: 1, aide: "Le cas ordinaire : trois à cinq mètres." },
  { libelle: "Loin", zoom: 1.3, aide: "Une salle traversante, six à huit mètres." },
  { libelle: "Hall", zoom: 1.7, aide: "Un grand volume : dix mètres et plus." },
] as const;

export function ReglagesDeLEcran({
  screen,
  media,
  classes,
  layout,
  setLayout,
  afficheurs,
  afficheursChoisis,
  setAfficheursChoisis,
  champsEdt,
  setChampsEdt,
  demiJournee,
  setDemiJournee,
  zoom,
  setZoom,
  classIds,
  setClassIds,
  displayOff,
  setDisplayOff,
  parDefaut,
  setParDefaut,
  touch,
}: {
  screen: ScreenStatus;
  media: Media[];
  classes: SchoolClass[];
  layout: PublishSpec["layout"];
  setLayout: (v: PublishSpec["layout"]) => void;
  afficheurs: { afficheur: string; batiment: string | null; libelle: string }[];
  afficheursChoisis: string[];
  setAfficheursChoisis: (f: (c: string[]) => string[]) => void;
  champsEdt: ChampEdt[] | null;
  setChampsEdt: (f: (c: ChampEdt[] | null) => ChampEdt[]) => void;
  demiJournee: boolean;
  setDemiJournee: (v: boolean) => void;
  /** Grossissement du texte. `undefined` = celui d'origine. */
  zoom: number | undefined;
  setZoom: (v: number | undefined) => void;
  classIds: string[];
  setClassIds: (f: (c: string[]) => string[]) => void;
  displayOff: DisplayOffWindow[];
  setDisplayOff: (v: DisplayOffWindow[]) => void;
  parDefaut: { assetId?: string; emploiDuTemps?: boolean };
  setParDefaut: (v: { assetId?: string; emploiDuTemps?: boolean }) => void;
  /** Marque la composition comme modifiée, et applique le changement. */
  touch: (apply: () => void) => void;
}) {
  const avecCours = layout === "principal-et-cours" || layout === "emploi-du-temps";

  return (
    <>

<MiseEnPage valeur={layout} onChange={(suivant) => touch(() => setLayout(suivant))} />

{avecCours && afficheurs.length > 0 && (
  <div className="reglage">
    <div className="reglage-titre">Emploi du temps affiché</div>
    <div className="day-picker">
      {afficheurs.map((a) => {
        const choisi = afficheursChoisis.includes(a.afficheur);
        return (
          <button
            key={a.afficheur}
            type="button"
            className="day-chip"
            aria-pressed={choisi}
            title={a.batiment ? `Bâtiment ${a.batiment}` : "Tout l'établissement"}
            onClick={() =>
              touch(() =>
                setAfficheursChoisis((c) =>
                  choisi ? c.filter((id) => id !== a.afficheur) : [...c, a.afficheur],
                ),
              )
            }
          >
            {a.libelle || `n°${a.afficheur}`}
          </button>
        );
      })}
    </div>
    <p className="hint">
      {afficheursChoisis.length === 0
        ? `Aucune sélection : l'écran prend celui de son bâtiment (${screen.building}), tout seul.`
        : afficheursChoisis.length === 1
          ? "Un seul : l'écran s'y tient."
          : `${afficheursChoisis.length} afficheurs, présentés à tour de rôle.`}
    </p>
  </div>
)}

{avecCours && (
  <div className="reglage">
    <div className="reglage-titre">Ce que montre la colonne des cours</div>
    <p className="reglage-note reglage-note--avant">
      L'heure de début et le nom du groupe sont toujours affichés — sans eux la colonne
      ne dit plus rien.
    </p>
    <div className="day-picker">
      {CHAMPS_EDT.map((champ) => {
        const montré = champsEdt === null || champsEdt.includes(champ.id);
        return (
          <button
            key={champ.id}
            type="button"
            className="day-chip"
            aria-pressed={montré}
            title={champ.aide}
            onClick={() =>
              touch(() =>
                setChampsEdt((actuels) => {
                  const base = actuels ?? CHAMPS_EDT.map((c) => c.id);
                  return montré
                    ? base.filter((c) => c !== champ.id)
                    : [...base, champ.id];
                }),
              )
            }
          >
            {champ.libelle}
          </button>
        );
      })}
    </div>
    <p className="reglage-note">
      Le reste se règle écran par écran : un couloir de bâtiment veut la salle, un écran
      d'accueil préfère souvent s'en passer.
    </p>
  </div>
)}

{avecCours && (
  <div className="reglage">
    <div className="reglage-titre">Journée entière ou demi-journée</div>
    <label className="inline">
      <input
        type="checkbox"
        checked={demiJournee}
        onChange={(e) => touch(() => setDemiJournee(e.target.checked))}
      />
      <span>Ne montrer que la demi-journée en cours</span>
    </label>
    <p className="reglage-note">
      Le matin, les cours du matin ; l'après-midi, ceux de l'après-midi. Moitié moins de
      lignes, donc des lignes deux fois plus grandes. Ce qui dépasse encore défile
      lentement, rien n'est perdu.
    </p>
  </div>
)}

<div className="reglage">
  <div className="reglage-titre">Distance de lecture</div>
  <p className="reglage-note reglage-note--avant">
    Les tailles se calculent déjà d'après la dalle. Ce réglage-ci ne corrige que ce que
    la machine ne peut pas deviner : à quelle distance on se tient de cet écran-là.
  </p>
  <div className="day-picker">
    {DISTANCES.map((d) => (
      <button
        key={d.libelle}
        type="button"
        className="day-chip"
        aria-pressed={(zoom ?? 1) === d.zoom}
        title={d.aide}
        /*
         * Toujours une valeur explicite, y compris pour « Couloir ».
         *
         * Le zoom est un réglage d'écran : le serveur le reporte d'une
         * publication à la suivante, pour qu'une modification de contenu
         * n'efface pas la configuration de la dalle. Envoyer « rien » en
         * choisissant Couloir laissait donc l'ancien zoom en place, et on
         * ne pouvait plus jamais revenir à la taille normale.
         */
        onClick={() => touch(() => setZoom(d.zoom))}
      >
        {d.libelle}
      </button>
    ))}
  </div>
</div>

{avecCours && afficheurs.length === 0 && (
  <div className="reglage">
    <div className="reglage-titre">Classes affichées dans la colonne</div>
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

<Schedule windows={displayOff} onChange={(next) => touch(() => setDisplayOff(next))} />

  <div className="reglage">
    <div className="reglage-titre">Quand rien n'est programmé</div>
    <p className="reglage-note reglage-note--avant">
      Ce que l'écran montre aux heures où aucun contenu n'est prévu. Sans réglage, il
      affiche sa carte d'identité — correct, mais c'est le message d'un écran qui a perdu
      le contact, pas d'un écran qui attend.
    </p>

    <div className="day-picker">
      <button
        type="button"
        className="day-chip"
        aria-pressed={!parDefaut.assetId && !parDefaut.emploiDuTemps}
        onClick={() => touch(() => setParDefaut({}))}
      >
        Carte d'identité
      </button>
      <button
        type="button"
        className="day-chip"
        aria-pressed={Boolean(parDefaut.emploiDuTemps)}
        onClick={() =>
          touch(() => setParDefaut({ emploiDuTemps: true }))
        }
      >
        Les salles du jour
      </button>
    </div>

    {media.length > 0 && (
      <>
        <p className="hint">Ou une affiche de la bibliothèque :</p>
        <div className="media-grid">
          {media.map((m) => (
            <button
              key={m.id}
              type="button"
              className="media-tile"
              aria-pressed={parDefaut.assetId === m.id}
              title={m.filename ?? m.id}
              onClick={() =>
                touch(() =>
                  setParDefaut(
                    parDefaut.assetId === m.id ? {} : { assetId: m.id },
                  ),
                )
              }
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
      </>
    )}
  </div>
    </>
  );
}
