import { useEffect, useState } from "react";
import { DalleDAccueil } from "./DalleDAccueil.js";
import { ApiError, type Utilisateur, api, clefDeSecoursPosée, poserClefDeSecours } from "./api.js";

/**
 * L'entrée dans la console.
 *
 * Trois situations, et l'écran doit dire laquelle sans faire deviner :
 *
 *   — installation neuve, aucun compte : on crée le premier administrateur,
 *     et ça demande la clé de secours du serveur ;
 *   — usage normal : adresse et mot de passe ;
 *   — un administrateur a perdu son mot de passe : la clé rouvre la porte,
 *     mais elle ne publie rien.
 */

export function Entree({ onEntré }: { onEntré: (utilisateur: Utilisateur) => void }) {
  const [amorcé, setAmorcé] = useState<boolean | null>(null);
  const [etablissement, setEtablissement] = useState<{ nom: string; accent: string | null }>({
    nom: "Couloir",
    accent: null,
  });
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    void api
      .amorce()
      .then((r) => {
        setAmorcé(r.comptesExistants);
        if (r.nom) setEtablissement({ nom: r.nom, accent: r.accent ?? null });
      })
      .catch((cause) => setErreur(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  if (amorcé === null) {
    return (
      <div className="entree">
        <div className="entree-forme">
          <div className="gate">
            <h1>Couloir</h1>
            {erreur ? <p className="notice error">{erreur}</p> : <p>Un instant…</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="entree">
      {amorcé ? (
        <DalleDAccueil nom={etablissement.nom} accent={etablissement.accent} />
      ) : (
        <PromesseDuProduit />
      )}

      <div className="entree-forme">
        {amorcé ? <Connexion onEntré={onEntré} /> : <PremierCompte onEntré={onEntré} />}
      </div>
    </div>
  );
}

/**
 * Ce que le produit promet, à la toute première installation.
 *
 * À ce moment-là il n'y a pas encore d'écran à montrer, et l'établissement
 * n'a pas de nom : on remplace la dalle par ce qu'on s'engage à tenir. Trois
 * points, pas dix — ce sont ceux qu'on vérifiera.
 */
function PromesseDuProduit() {
  return (
    <aside className="dalle promesse">
      <span className="dalle-mention">avant de commencer</span>
      <div className="dalle-contenu">
        <span className="dalle-eyebrow">Couloir</span>
        <ul className="promesse-liste">
          <li>Un écran débranché du réseau garde son contenu et continue de l'afficher.</li>
          <li>Une urgence prend tous les écrans, même ceux dont la dalle est éteinte.</li>
          <li>La console ne s'ouvre jamais par défaut : il faut un compte pour entrer.</li>
        </ul>
      </div>
    </aside>
  );
}

function Connexion({ onEntré }: { onEntré: (utilisateur: Utilisateur) => void }) {
  const [courriel, setCourriel] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupé, setOccupé] = useState(false);
  const [secours, setSecours] = useState(false);

  async function soumettre(event: React.FormEvent) {
    event.preventDefault();
    setOccupé(true);
    setErreur(null);
    try {
      const { utilisateur } = await api.connexion(courriel.trim(), motDePasse);
      onEntré(utilisateur);
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOccupé(false);
    }
  }

  return (
    <form className="gate" onSubmit={soumettre}>
      <h1>Couloir</h1>
      <p>Console de pilotage des écrans.</p>

      {erreur && <p className="notice error">{erreur}</p>}

      <div className="field">
        <label htmlFor="courriel">Adresse électronique</label>
        <input
          id="courriel"
          type="email"
          value={courriel}
          autoComplete="username"
          autoFocus
          onChange={(e) => setCourriel(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="mdp">Mot de passe</label>
        <input
          id="mdp"
          type="password"
          value={motDePasse}
          autoComplete="current-password"
          onChange={(e) => setMotDePasse(e.target.value)}
        />
      </div>

      <button type="submit" className="primary" disabled={!courriel.trim() || !motDePasse || occupé}>
        {occupé ? "Vérification…" : "Entrer"}
      </button>

      <button type="button" className="link" onClick={() => setSecours(!secours)}>
        Mot de passe oublié ?
      </button>

      {secours && (
        <p className="hint">
          Demandez à un administrateur de vous en donner un nouveau. Si plus personne ne peut entrer,
          la clé de secours du serveur — <span className="mono">COULOIR_CONSOLE_TOKEN</span> — permet
          de réparer un compte depuis l'onglet Comptes. Elle ne publie rien.
        </p>
      )}
    </form>
  );
}

function PremierCompte({ onEntré }: { onEntré: (utilisateur: Utilisateur) => void }) {
  const [clef, setClef] = useState("");
  const [nom, setNom] = useState("");
  const [courriel, setCourriel] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupé, setOccupé] = useState(false);

  async function soumettre(event: React.FormEvent) {
    event.preventDefault();
    setOccupé(true);
    setErreur(null);
    poserClefDeSecours(clef.trim());
    try {
      await api.premierCompte({ nom: nom.trim(), courriel: courriel.trim(), motDePasse });
      // On enchaîne sur une vraie connexion : le compte créé doit servir tout
      // de suite, et la clé n'a plus de raison de rester en mémoire.
      poserClefDeSecours(null);
      const { utilisateur } = await api.connexion(courriel.trim(), motDePasse);
      onEntré(utilisateur);
    } catch (cause) {
      poserClefDeSecours(null);
      setErreur(
        cause instanceof ApiError && cause.status === 401
          ? "Clé de secours incorrecte. C'est la valeur de COULOIR_CONSOLE_TOKEN sur le serveur."
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    } finally {
      setOccupé(false);
    }
  }

  const prêt = clef.trim() && nom.trim() && courriel.trim() && motDePasse.length >= 12;

  return (
    <form className="gate" onSubmit={soumettre}>
      <h1>Couloir</h1>
      <p>Aucun compte n'existe encore. Créons celui de l'administrateur.</p>

      {erreur && <p className="notice error">{erreur}</p>}

      <div className="field">
        <label htmlFor="clef">Clé de secours du serveur</label>
        <input
          id="clef"
          type="password"
          value={clef}
          autoComplete="off"
          autoFocus
          onChange={(e) => setClef(e.target.value)}
        />
        <p className="hint">
          La valeur de <span className="mono">COULOIR_CONSOLE_TOKEN</span>. Demandée une seule fois,
          pour prouver que vous administrez bien ce serveur.
        </p>
      </div>

      <div className="field">
        <label htmlFor="nom">Votre nom</label>
        <input id="nom" value={nom} autoComplete="name" onChange={(e) => setNom(e.target.value)} />
        <p className="hint">C'est ce nom qui apparaîtra dans le journal des publications.</p>
      </div>

      <div className="field">
        <label htmlFor="courriel-premier">Adresse électronique</label>
        <input
          id="courriel-premier"
          type="email"
          value={courriel}
          autoComplete="username"
          onChange={(e) => setCourriel(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="mdp-premier">Mot de passe</label>
        <input
          id="mdp-premier"
          type="password"
          value={motDePasse}
          autoComplete="new-password"
          onChange={(e) => setMotDePasse(e.target.value)}
        />
        <p className="hint">
          Douze caractères au minimum. Une phrase courte fait très bien l'affaire, et se retient
          mieux qu'un mot tordu.
        </p>
      </div>

      <button type="submit" className="primary" disabled={!prêt || occupé}>
        {occupé ? "Création…" : "Créer le compte"}
      </button>

      {clefDeSecoursPosée() && <p className="hint">Clé retenue le temps de cette page.</p>}
    </form>
  );
}
