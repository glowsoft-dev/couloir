import { useState } from "react";
import type { Draft } from "./brouillon.js";
import type { Media, PublishItem } from "./api.js";
import { enDate, grilleDuMois, nomDuMois, paraitLeJour } from "./mois.js";

/**
 * Le mois d'un écran.
 *
 * La vue jour répond à « à quelle heure » ; celle-ci répond à « quels jours ».
 * C'est la question qu'on se pose en programmant à l'avance : les portes
 * ouvertes du 14, le menu de la semaine, l'affiche de rentrée qu'on a mise
 * « jusqu'au 15 » — et surtout, les jours où plus rien n'est prévu.
 *
 * Un jour vide n'est pas une erreur : le contenu par défaut y prend la main.
 * Mais c'est une décision, et on ne la prend pas sans la voir.
 */

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];


export function VueMois({ items, media }: { items: Draft[]; media: Media[] }) {
  const aujourdHui = new Date();
  const [curseur, setCurseur] = useState({
    annee: aujourdHui.getFullYear(),
    mois: aujourdHui.getMonth(),
  });

  const cases = grilleDuMois(curseur.annee, curseur.mois);
  const ceJour = enDate(aujourdHui);

  /** Le mois d'à côté, en laissant `Date` gérer le passage d'année. */
  const decaler = (pas: number) =>
    setCurseur((c) => {
      const d = new Date(c.annee, c.mois + pas, 1);
      return { annee: d.getFullYear(), mois: d.getMonth() };
    });

  const couleur = (item: Draft) =>
    media.find((m) => m.id === item.assetId)?.mime.startsWith("video/") ? "video" : "image";

  return (
    <div className="mois">
      <header className="mois-tete">
        <button type="button" onClick={() => decaler(-1)} aria-label="Mois précédent">
          ←
        </button>
        <span className="mois-nom">{nomDuMois(curseur.annee, curseur.mois)}</span>
        <button type="button" onClick={() => decaler(1)} aria-label="Mois suivant">
          →
        </button>
        <button
          type="button"
          className="mois-aujourdhui"
          onClick={() =>
            setCurseur({ annee: aujourdHui.getFullYear(), mois: aujourdHui.getMonth() })
          }
        >
          Ce mois-ci
        </button>
      </header>

      <div className="mois-grille">
        {JOURS.map((jour) => (
          <span className="mois-entete" key={jour}>
            {jour}
          </span>
        ))}

        {cases.map((c) => {
          const contenus = items.filter((item) => paraitLeJour(item.visibility, c.date));
          const numero = Number(c.date.slice(-2));
          return (
            <div
              className={[
                "mois-case",
                c.duMois ? "" : "mois-case--voisin",
                c.date === ceJour ? "mois-case--aujourdhui" : "",
                c.duMois && contenus.length === 0 ? "mois-case--vide" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={c.date}
            >
              <span className="mois-numero">{numero}</span>
              {c.duMois && contenus.length === 0 ? (
                <span className="mois-rien">rien de prévu</span>
              ) : (
                contenus.slice(0, 3).map((item) => (
                  <span className={`mois-puce mois-puce--${couleur(item)}`} key={item.key}>
                    {item.text ? (item.text.titre || "Sans titre") : item.title}
                  </span>
                ))
              )}
              {contenus.length > 3 && (
                <span className="mois-reste">+{contenus.length - 3}</span>
              )}
            </div>
          );
        })}
      </div>

      <p className="mois-note">
        Un jour sans rien n'est pas une erreur : le contenu par défaut y prend la main — les salles
        du jour, une affiche d'accueil, ou la carte d'identité de l'écran. Ce qu'il montre se règle
        dans <strong>Réglages de l'écran</strong>.
      </p>
    </div>
  );
}
