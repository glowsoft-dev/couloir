import { useEffect, useState } from "react";
import { ApiError, type JourneeAfficheur, api } from "./api.js";

/**
 * Le branchement sur NetYPareo.
 *
 * NetYPareo expose une fonction « afficheur planning » faite exactement pour
 * ça : des écrans de couloir. On s'y branche plutôt que de ressaisir à la
 * main un emploi du temps qui existe déjà — deux saisies finissent toujours
 * par diverger, et c'est l'écran qui a tort.
 *
 * La correspondance se fait par bâtiment : NetYPareo en configure un par
 * bâtiment, nos écrans en portent un. Un écran du bâtiment A lit donc
 * l'afficheur du bâtiment A, sans réglage supplémentaire.
 */

interface Ligne {
  afficheur: string;
  batiment: string;
  libelle: string;
}

export function Netypareo() {
  const [baseUrl, setBaseUrl] = useState("");
  const [actif, setActif] = useState(false);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [journee, setJournee] = useState<JourneeAfficheur | null>(null);
  const [erreur, setErreur] = useState<{ message: string; conseil?: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [occupé, setOccupé] = useState<string | null>(null);
  const [chargé, setChargé] = useState(false);

  useEffect(() => {
    void api.netypareo
      .lire()
      .then((r) => {
        setBaseUrl(r.reglages.baseUrl);
        setActif(r.reglages.actif);
        setLignes(
          r.reglages.afficheurs.map((a) => ({
            afficheur: a.afficheur,
            batiment: a.batiment ?? "",
            libelle: a.libelle,
          })),
        );
      })
      .catch(() => {})
      .finally(() => setChargé(true));
  }, []);

  async function essayer(afficheur: string) {
    setOccupé(`essai-${afficheur}`);
    setErreur(null);
    setMessage(null);
    setJournee(null);
    try {
      const r = await api.netypareo.essayer({ baseUrl: baseUrl.trim(), afficheur });
      setJournee(r.journee);
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
    setMessage(null);
    try {
      await api.netypareo.enregistrer({
        baseUrl: baseUrl.trim(),
        actif,
        afficheurs: lignes
          .filter((l) => l.afficheur.trim())
          .map((l) => ({
            afficheur: l.afficheur.trim(),
            batiment: l.batiment.trim() || null,
            libelle: l.libelle.trim(),
          })),
      });
      setMessage(
        actif
          ? "Branchement enregistré. Republiez vos écrans pour qu'ils prennent l'emploi du temps."
          : "Enregistré, mais éteint : les écrans gardent la grille saisie à la main.",
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
          <h2>Emploi du temps · NetYPareo</h2>
        </header>
        <p className="empty">Un instant…</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <header>
          <h2>Emploi du temps · NetYPareo</h2>
          <span className="spacer" />
          <span className={`pill ${actif ? "accent" : ""}`}>{actif ? "branché" : "éteint"}</span>
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
            NetYPareo expose des « afficheurs planning », faits pour des écrans de couloir. On s'y
            branche plutôt que de ressaisir un emploi du temps qui existe déjà : deux saisies
            finissent toujours par diverger, et c'est l'écran qui a tort.
          </p>

          <div className="field">
            <label htmlFor="nety-url">Adresse de NetYPareo</label>
            <input
              id="nety-url"
              type="url"
              value={baseUrl}
              placeholder="https://netypareo.votre-campus.com"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="hint">
              Sans le chemin : l'adresse d'accueil suffit. La page qui liste les afficheurs se
              trouve ensuite sous <span className="mono">/netypareo/index.php/planning/afficheur</span>,
              et le numéro de chaque afficheur apparaît à la fin de son adresse.
            </p>
          </div>

          <div className="field">
            <label>Afficheurs</label>
            {lignes.length === 0 && (
              <p className="hint">
                Aucun afficheur. Ajoutez-en un par bâtiment, plus un sans bâtiment qui servira de
                défaut.
              </p>
            )}

            {lignes.map((ligne, index) => (
              <div className="nety-ligne" key={index}>
                <input
                  value={ligne.afficheur}
                  placeholder="n°"
                  aria-label={`Numéro de l'afficheur ${index + 1}`}
                  className="nety-num"
                  onChange={(e) =>
                    setLignes((c) => c.map((l, i) => (i === index ? { ...l, afficheur: e.target.value } : l)))
                  }
                />
                <input
                  value={ligne.batiment}
                  placeholder="bâtiment"
                  aria-label={`Bâtiment de l'afficheur ${index + 1}`}
                  className="nety-bat"
                  onChange={(e) =>
                    setLignes((c) => c.map((l, i) => (i === index ? { ...l, batiment: e.target.value } : l)))
                  }
                />
                <input
                  value={ligne.libelle}
                  placeholder="nom, pour vous y retrouver"
                  aria-label={`Nom de l'afficheur ${index + 1}`}
                  onChange={(e) =>
                    setLignes((c) => c.map((l, i) => (i === index ? { ...l, libelle: e.target.value } : l)))
                  }
                />
                <button
                  type="button"
                  disabled={!baseUrl.trim() || !ligne.afficheur.trim() || occupé !== null}
                  onClick={() => void essayer(ligne.afficheur.trim())}
                >
                  {occupé === `essai-${ligne.afficheur.trim()}` ? "…" : "Essayer"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  aria-label={`Retirer l'afficheur ${index + 1}`}
                  onClick={() => setLignes((c) => c.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </div>
            ))}

            <div className="row-actions">
              <button
                type="button"
                onClick={() => setLignes((c) => [...c, { afficheur: "", batiment: "", libelle: "" }])}
              >
                Ajouter un afficheur
              </button>
            </div>
            <p className="hint">
              Un écran affiche l'afficheur de son bâtiment. Sans correspondance, il prend celui qui
              n'a pas de bâtiment — mieux vaut l'établissement entier que pas d'emploi du temps.
            </p>
          </div>

          <div className="field">
            <label className="inline">
              <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} />
              Alimenter les écrans depuis NetYPareo
            </label>
            <p className="hint">
              Décoché, les écrans utilisent la grille saisie à la main dans l'onglet Grille.
            </p>
          </div>

          <button type="button" className="primary" onClick={() => void enregistrer()} disabled={occupé !== null}>
            {occupé === "enregistrement" ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </section>

      {journee && <ApercuJournee journee={journee} />}
    </>
  );
}

/** Ce qui a l'air d'un nom de personne plutôt que d'un groupe. */
function ressembleÀUnNom(intitulé: string): boolean {
  const mots = intitulé.trim().split(/\s+/);
  if (mots.length < 2 || mots.length > 4) return false;
  if (/\d/.test(intitulé)) return false;
  // « Morgane LINOIS », « Ratan Reddy KONDA » : au moins un mot tout en
  // majuscules, et aucun sigle de formation.
  if (/\b(BTS|BAC|CAP|MASTER|M1|M2|LICENCE|TITRE|BLOC|PROMO)\b/i.test(intitulé)) return false;
  return mots.some((m) => m.length > 2 && m === m.toUpperCase());
}

function ApercuJournee({ journee }: { journee: JourneeAfficheur }) {
  const nominatives = journee.seances.filter((s) => ressembleÀUnNom(s.subject));

  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <header>
        <h2>Ce que l'écran afficherait</h2>
        <span className="spacer" />
        <span className="pill">{journee.titre}</span>
        <span className="pill accent">{journee.seances.length} séance(s)</span>
      </header>

      <div className="body">
        {journee.chaineCompletee && (
          <p className="notice">
            Le serveur NetYPareo sert une chaîne de certificats incomplète. On l'a complétée nous-mêmes
            et la connexion reste vérifiée — mais la correction propre est de faire servir la chaîne
            entière par NetYPareo. À signaler à qui l'héberge.
          </p>
        )}

        {nominatives.length > 0 && (
          <p className="notice error">
            {nominatives.length === 1 ? "Une séance porte" : `${nominatives.length} séances portent`}{" "}
            un nom de personne plutôt qu'un groupe — {nominatives.map((s) => s.subject).join(", ")}.
            Ces rendez-vous individuels s'afficheraient en clair dans un couloir. À trancher avec la
            direction : NetYPareo permet de les exclure de l'afficheur.
          </p>
        )}

        {journee.seances.length === 0 ? (
          <p className="hint">Aucun cours ce jour-là. L'écran l'écrira plutôt que de rester vide.</p>
        ) : (
          <ul className="nety-seances">
            {journee.seances.map((s, i) => (
              <li key={i}>
                <time>
                  {s.time}
                  <span>{s.endTime}</span>
                </time>
                <span className="nety-groupe">
                  {s.subject}
                  {s.detail && <span className="nety-module">{s.detail}</span>}
                </span>
                <span className="nety-salle">{s.room}</span>
                <span className="nety-prof">{s.teacher ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="hint">
          Journée du {new Date(`${journee.date}T12:00:00`).toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          . Les écrans relisent NetYPareo toutes les quinze minutes, et gardent la dernière journée
          connue s'il tombe.
        </p>
      </div>
    </section>
  );
}
