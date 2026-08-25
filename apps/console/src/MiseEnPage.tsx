import type { PublishSpec } from "./api.js";

/**
 * Le choix de la mise en page, en trois vignettes.
 *
 * Une liste déroulante disait « Vos contenus + l'emploi du temps à droite »
 * et il fallait la croire sur parole, ou publier pour voir. Trois schémas au
 * format de la dalle montrent où va quoi, dans les proportions réelles —
 * deux tiers, un tiers — avant qu'un couloir n'en soit témoin.
 *
 * Ce ne sont pas des aperçus : aucun contenu n'y figure. C'est le découpage
 * qu'ils montrent, et rien d'autre.
 */

type Layout = PublishSpec["layout"];

interface Choix {
  id: Layout;
  libelle: string;
  aide: string;
  /** Les zones, dans les proportions du composeur. */
  zones: { part: number; role: "contenu" | "cours" }[];
}

const CHOIX: Choix[] = [
  {
    id: "plein-ecran",
    libelle: "Vos contenus, en plein écran",
    aide: "Affiches, vidéos et textes occupent toute la dalle.",
    zones: [{ part: 100, role: "contenu" }],
  },
  {
    id: "principal-et-cours",
    libelle: "Vos contenus + l'emploi du temps à droite",
    aide: "Les contenus à gauche sur deux tiers, l'emploi du temps à droite.",
    zones: [
      { part: 66, role: "contenu" },
      { part: 34, role: "cours" },
    ],
  },
  {
    id: "emploi-du-temps",
    libelle: "L'emploi du temps seul, en grand",
    aide: "Rien d'autre que les cours et les salles. C'est la mise en page d'un hall où l'on cherche une salle.",
    zones: [{ part: 100, role: "cours" }],
  },
];

export function MiseEnPage({
  valeur,
  onChange,
}: {
  valeur: Layout;
  onChange: (layout: Layout) => void;
}) {
  const choisi = CHOIX.find((c) => c.id === valeur);

  return (
    <div className="reglage">
      <div className="reglage-titre">Mise en page</div>
      <div className="dispositions">
        {CHOIX.map((choix) => (
          <button
            type="button"
            key={choix.id}
            className={choix.id === valeur ? "disposition disposition--choisie" : "disposition"}
            aria-pressed={choix.id === valeur}
            onClick={() => onChange(choix.id)}
          >
            <span className="disposition-dalle">
              <span className="disposition-zones">
                {choix.zones.map((zone, rang) => (
                  <span
                    key={rang}
                    className={`disposition-zone disposition-zone--${zone.role}`}
                    style={{ flex: zone.part }}
                  />
                ))}
              </span>
            </span>
            <span className="disposition-libelle">{choix.libelle}</span>
          </button>
        ))}
      </div>
      {choisi && <p className="reglage-note">{choisi.aide}</p>}
    </div>
  );
}
