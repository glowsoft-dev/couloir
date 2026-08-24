import { useEffect, useState } from "react";
import { api } from "./api.js";

/**
 * L'identité de l'établissement.
 *
 * Deux réglages seulement : le nom affiché sur la carte d'identité des
 * écrans, et une couleur d'accent. C'est peu, et c'est voulu — le fond des
 * dalles reste sombre quelle que soit la charte.
 *
 * Un couloir n'est pas une page web. Une dalle claire éblouit le soir,
 * consomme davantage, et perd en contraste à quatre mètres. L'identité passe
 * donc par l'accent : les horaires, les sur-titres, les surlignages.
 */

/** Quelques accents lisibles sur fond sombre, pour éviter la saisie à froid. */
const SUGGESTIONS = [
  { valeur: "#11A6C4", nom: "Bleu" },
  { valeur: "#F29104", nom: "Orange" },
  { valeur: "#C3215D", nom: "Framboise" },
  { valeur: "#54BE95", nom: "Vert" },
];

/**
 * Le contraste d'une couleur sur le fond des écrans.
 *
 * Une charte pensée pour du texte noir sur blanc donne souvent un accent
 * illisible sur fond sombre. Mieux vaut le dire au moment du choix qu'après
 * avoir posé l'écran à quatre mètres de haut.
 */
export function contrasteSurFondSombre(hex: string): number {
  const c = hex.replace("#", "");
  const canal = (i: number) => {
    const v = Number.parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
  // #0E1211, le fond des dalles.
  const fond = 0.0058;
  return (luminance + 0.05) / (fond + 0.05);
}

export function Identite() {
  const [nom, setNom] = useState("");
  const [accent, setAccent] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupé, setOccupé] = useState(false);
  const [chargé, setChargé] = useState(false);

  useEffect(() => {
    void api.identite
      .lire()
      .then((r) => {
        setNom(r.identite.nom);
        setAccent(r.identite.accent ?? "");
      })
      .catch(() => {})
      .finally(() => setChargé(true));
  }, []);

  async function enregistrer() {
    setOccupé(true);
    setErreur(null);
    setMessage(null);
    try {
      await api.identite.enregistrer({ nom: nom.trim(), accent: accent || null });
      setMessage(
        "Identité enregistrée. Les écrans la prendront à la prochaine publication — les manifestes déjà en ligne gardent l'ancienne.",
      );
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOccupé(false);
    }
  }

  const valide = /^#[0-9a-fA-F]{6}$/.test(accent);
  const contraste = valide ? contrasteSurFondSombre(accent) : null;

  if (!chargé) {
    return (
      <section className="panel">
        <header>
          <h2>Identité de l'établissement</h2>
        </header>
        <p className="empty">Un instant…</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <header>
        <h2>Identité de l'établissement</h2>
      </header>

      <div className="body">
        {erreur && <p className="notice error">{erreur}</p>}
        {message && <p className="notice">{message}</p>}

        <div className="field">
          <label htmlFor="id-nom">Nom affiché</label>
          <input
            id="id-nom"
            value={nom}
            placeholder="Campus by CCI Nièvre"
            onChange={(e) => setNom(e.target.value)}
          />
          <p className="hint">
            Affiché sur la carte d'identité des écrans — celle qu'on voit quand le réseau est tombé
            ou que rien n'est programmé.
          </p>
        </div>

        <div className="field">
          <label htmlFor="id-accent">Couleur d'accent</label>
          <div className="accent-ligne">
            <input
              id="id-accent"
              value={accent}
              placeholder="#11A6C4"
              spellCheck={false}
              onChange={(e) => setAccent(e.target.value.trim())}
            />
            <input
              type="color"
              value={valide ? accent : "#11A6C4"}
              aria-label="Choisir la couleur"
              onChange={(e) => setAccent(e.target.value.toUpperCase())}
            />
            <div className="accent-suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.valeur}
                  type="button"
                  className="accent-pastille"
                  style={{ background: s.valeur }}
                  aria-label={s.nom}
                  title={`${s.nom} · ${s.valeur}`}
                  onClick={() => setAccent(s.valeur)}
                />
              ))}
            </div>
          </div>

          {accent && !valide && <p className="hint">La couleur doit s'écrire « #11A6C4 ».</p>}

          {contraste !== null && (
            <p className="hint">
              {contraste >= 4.5
                ? `Bien lisible sur le fond des écrans (contraste ${contraste.toFixed(1)}).`
                : contraste >= 3
                  ? `Lisible pour un titre, un peu juste pour du texte fin (contraste ${contraste.toFixed(1)}).`
                  : `Trop sombre pour le fond des écrans (contraste ${contraste.toFixed(1)}). Prenez une teinte plus claire de la même couleur.`}
            </p>
          )}
        </div>

        {valide && (
          <div className="accent-apercu" style={{ ["--essai" as string]: accent }}>
            <span className="accent-eyebrow">Bienvenue</span>
            <span className="accent-titre">{nom.trim() || "Établissement"}</span>
            <span className="accent-heure">08:00</span>
          </div>
        )}

        <p className="hint">
          Le fond des dalles reste sombre quelle que soit la charte. Un couloir n'est pas une page
          web : une dalle claire éblouit le soir, consomme davantage et perd en contraste à quatre
          mètres.
        </p>

        <button type="button" className="primary" onClick={() => void enregistrer()} disabled={occupé}>
          {occupé ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </section>
  );
}
