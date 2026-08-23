import { useEffect, useState } from "react";
import { ApiError, type Article, type ChargeActualites, api } from "./api.js";

/**
 * Le connecteur d'actualités du site.
 *
 * C'est la promesse d'origine : ce que la personne chargée de la
 * communication publie sur le site apparaît dans les couloirs, sans qu'elle
 * ait à toucher aux écrans.
 *
 * Le panneau tourne autour d'un bouton : **Essayer**. On ne branche pas une
 * source sur vingt écrans sans avoir vu ce qu'elle rend, et un message
 * d'erreur bien rédigé vaut mieux qu'une documentation que personne ne lira.
 */

export function Actualites() {
  const [url, setUrl] = useState("");
  const [categorie, setCategorie] = useState("");
  const [nombre, setNombre] = useState(5);
  const [actif, setActif] = useState(false);

  const [charge, setCharge] = useState<ChargeActualites | null>(null);
  const [erreur, setErreur] = useState<{ message: string; conseil?: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [etat, setEtat] = useState<{ recupereLe: string | null; articles: number } | null>(null);
  const [occupé, setOccupé] = useState<"essai" | "enregistrement" | null>(null);
  const [chargé, setChargé] = useState(false);

  useEffect(() => {
    void api.actualites
      .lire()
      .then((r) => {
        setUrl(r.reglages.url);
        setCategorie(r.reglages.categorie ?? "");
        setNombre(r.reglages.nombre);
        setActif(r.reglages.actif);
        setEtat(r.etat);
      })
      .catch(() => {})
      .finally(() => setChargé(true));
  }, []);

  async function essayer() {
    setOccupé("essai");
    setErreur(null);
    setMessage(null);
    setCharge(null);
    try {
      const r = await api.actualites.essayer({
        url: url.trim(),
        ...(categorie.trim() ? { categorie: categorie.trim() } : {}),
        nombre,
      });
      setCharge(r.charge);
    } catch (cause) {
      setErreur({
        message: cause instanceof Error ? cause.message : String(cause),
        ...(cause instanceof ApiError && typeof (cause as { conseil?: string }).conseil === "string"
          ? { conseil: (cause as { conseil?: string }).conseil }
          : {}),
      });
    } finally {
      setOccupé(null);
    }
  }

  async function enregistrer() {
    setOccupé("enregistrement");
    setErreur(null);
    try {
      await api.actualites.enregistrer({
        url: url.trim(),
        ...(categorie.trim() ? { categorie: categorie.trim() } : {}),
        nombre,
        actif,
      });
      setMessage(
        actif
          ? "Source enregistrée. Ajoutez des actualités à une publication depuis l'onglet Écrans."
          : "Source enregistrée, mais désactivée : les écrans ne la liront pas.",
      );
    } catch (cause) {
      setErreur({ message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setOccupé(null);
    }
  }

  if (!chargé) {
    return (
      <section className="panel">
        <header>
          <h2>Actualités du site</h2>
        </header>
        <p className="empty">Un instant…</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <header>
          <h2>Actualités du site</h2>
          <span className="spacer" />
          <span className={`pill ${actif ? "accent" : ""}`}>{actif ? "active" : "éteinte"}</span>
        </header>

        <div className="body">
          {erreur && (
            <p className="notice error">
              {erreur.message}
              {erreur.conseil && <span className="hint">{erreur.conseil}</span>}
            </p>
          )}
          {message && <p className="notice">{message}</p>}

          <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
            Ce qui est publié sur le site de l'école apparaît dans les couloirs, sans avoir à
            toucher aux écrans. C'est le serveur qui va chercher les articles, pas les écrans : ils
            sont souvent sur un réseau qui ne sort pas, et vingt boîtiers interrogeant le site
            toutes les dix minutes finiraient par le faire tomber.
          </p>

          <div className="field">
            <label htmlFor="actus-url">Adresse du site</label>
            <input
              id="actus-url"
              type="url"
              value={url}
              placeholder="https://www.ecole.fr"
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="hint">
              L'adresse d'accueil suffit. WordPress est reconnu directement ; pour tout autre site,
              indiquez l'adresse du flux RSS.
            </p>
          </div>

          <div className="field">
            <label htmlFor="actus-cat">Catégorie</label>
            <input
              id="actus-cat"
              value={categorie}
              placeholder="facultatif"
              onChange={(e) => setCategorie(e.target.value)}
            />
            <p className="hint">
              Identifiant de catégorie WordPress, pour ne remonter qu'une rubrique. Laissé vide,
              tout le site remonte.
            </p>
          </div>

          <div className="field">
            <label htmlFor="actus-nb">Articles récupérés</label>
            <input
              id="actus-nb"
              type="number"
              min={1}
              max={20}
              value={nombre}
              onChange={(e) => setNombre(Math.min(20, Math.max(1, Number(e.target.value))))}
            />
          </div>

          <div className="field">
            <label className="inline">
              <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} />
              Alimenter les écrans avec cette source
            </label>
          </div>

          <div className="row-actions">
            <button type="button" onClick={() => void essayer()} disabled={!url.trim() || occupé !== null}>
              {occupé === "essai" ? "Lecture…" : "Essayer"}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void enregistrer()}
              disabled={!url.trim() || occupé !== null}
            >
              {occupé === "enregistrement" ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>

          {etat?.recupereLe && (
            <p className="hint">
              Les écrans lisent une copie conservée sur le serveur, rafraîchie toutes les dix
              minutes. Dernière lecture : {new Date(etat.recupereLe).toLocaleString("fr-FR")} —{" "}
              {etat.articles} article{etat.articles > 1 ? "s" : ""}. Si le site tombe, cette copie
              continue d'être servie.
            </p>
          )}
        </div>
      </section>

      {charge && <Apercu charge={charge} />}
    </>
  );
}

function Apercu({ charge }: { charge: ChargeActualites }) {
  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <header>
        <h2>Ce qui sera affiché</h2>
        <span className="spacer" />
        <span className="pill accent">
          {charge.source === "wordpress" ? "API WordPress" : charge.source === "rss" ? "flux RSS" : "aucune"}
        </span>
        <span className="pill">{charge.articles.length}</span>
      </header>

      <div className="body">
        {charge.source === "rss" && (
          <p className="hint" style={{ marginTop: 0 }}>
            Lu par le flux RSS. C'est plus pauvre que l'API WordPress — souvent sans image ni
            catégorie — mais ça marche partout.
          </p>
        )}

        <div className="actus-grille">
          {charge.articles.map((article) => (
            <Carte key={article.id} article={article} />
          ))}
        </div>

        <p className="hint">
          Un article par diapositive, dans la rotation avec vos affiches et vos vidéos. Le titre est
          ce qui se lit à quatre mètres ; l'extrait est raccourci pour tenir en deux lignes.
        </p>
      </div>
    </section>
  );
}

function Carte({ article }: { article: Article }) {
  return (
    <article className="actu-carte">
      {article.image && <img src={article.image} alt="" loading="lazy" />}
      <div className="actu-texte">
        {article.categorie && <span className="actu-categorie">{article.categorie}</span>}
        <h3>{article.titre}</h3>
        {article.extrait && <p>{article.extrait}</p>}
      </div>
    </article>
  );
}
