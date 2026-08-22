import { useCallback, useEffect, useState } from "react";
import {
  type EntreeJournal,
  type Role,
  type Utilisateur,
  api,
  descriptionDuRole,
  libelléDuRole,
  poserClefDeSecours,
} from "./api.js";

/**
 * Les comptes et le journal.
 *
 * Réservé aux administrateurs — le serveur le vérifie, cet onglet ne fait
 * que ne pas l'afficher aux autres.
 */

const ROLES: Role[] = ["administrateur", "editeur", "lecteur"];

function quand(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return `aujourd'hui à ${heure}`;
  return `${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${heure}`;
}

export function Comptes({ moi }: { moi: Utilisateur }) {
  const [utilisateurs, setUtilisateurs] = useState<Utilisateur[]>([]);
  const [journal, setJournal] = useState<EntreeJournal[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try {
      const [{ utilisateurs: liste }, { entrees }] = await Promise.all([
        api.utilisateurs.lister(),
        api.journal(),
      ]);
      setUtilisateurs(liste);
      setJournal(entrees);
      setErreur(null);
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  async function agir(action: () => Promise<unknown>, succès: string) {
    setErreur(null);
    setMessage(null);
    try {
      await action();
      setMessage(succès);
      await recharger();
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="split">
      <div>
        <section className="panel">
          <header>
            <h2>Comptes</h2>
            <span className="spacer" />
            <span className="pill">{utilisateurs.length}</span>
          </header>

          <div className="body">
            {erreur && <p className="notice error">{erreur}</p>}
            {message && <p className="notice">{message}</p>}

            {utilisateurs.length === 0 && <p className="hint">Aucun compte.</p>}

            {utilisateurs.map((u) => {
              const soiMême = u.id === moi.id;
              return (
                <div className={`compte-row ${u.actif ? "" : "inactif"}`} key={u.id}>
                  <div className="compte-identite">
                    <span className="compte-nom">
                      {u.nom}
                      {soiMême && <span className="pill">vous</span>}
                      {!u.actif && <span className="pill warn">désactivé</span>}
                    </span>
                    <span className="compte-courriel">{u.courriel}</span>
                    <span className="hint">
                      {u.derniereConnexion
                        ? `dernière connexion ${quand(u.derniereConnexion)}`
                        : "ne s'est jamais connecté"}
                    </span>
                  </div>

                  <label className="inline">
                    <span className="sr">Rôle de {u.nom}</span>
                    <select
                      value={u.role}
                      /* On ne modifie pas son propre rôle : le dernier
                         administrateur se retirerait, et plus personne ne
                         pourrait créer de compte. */
                      disabled={soiMême}
                      title={soiMême ? "Vous ne pouvez pas changer votre propre rôle." : undefined}
                      onChange={(e) =>
                        void agir(
                          () => api.utilisateurs.modifier(u.id, { role: e.target.value as Role }),
                          `${u.nom} est maintenant ${libelléDuRole(e.target.value as Role).toLowerCase()}.`,
                        )
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {libelléDuRole(r)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    className="ghost"
                    disabled={soiMême}
                    title={soiMême ? "Vous ne pouvez pas vous désactiver." : undefined}
                    onClick={() => {
                      if (
                        u.actif &&
                        !globalThis.confirm(
                          `Désactiver le compte de ${u.nom} ? Ses sessions ouvertes se fermeront immédiatement.`,
                        )
                      )
                        return;
                      void agir(
                        () => api.utilisateurs.modifier(u.id, { actif: !u.actif }),
                        u.actif ? `Compte de ${u.nom} désactivé.` : `Compte de ${u.nom} réactivé.`,
                      );
                    }}
                  >
                    {u.actif ? "Désactiver" : "Réactiver"}
                  </button>

                  <NouveauMotDePasse utilisateur={u} onFait={recharger} />
                </div>
              );
            })}
          </div>
        </section>

        <JournalPanel entrees={journal} />
      </div>

      <div>
        <Inviter onCréé={recharger} />
      </div>
    </div>
  );
}

function NouveauMotDePasse({
  utilisateur,
  onFait,
}: {
  utilisateur: Utilisateur;
  onFait: () => Promise<void>;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [valeur, setValeur] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  if (!ouvert) {
    return (
      <button type="button" className="ghost" onClick={() => setOuvert(true)}>
        Mot de passe
      </button>
    );
  }

  return (
    <span className="mdp-inline">
      <input
        type="password"
        value={valeur}
        placeholder="Nouveau mot de passe"
        aria-label={`Nouveau mot de passe pour ${utilisateur.nom}`}
        autoFocus
        onChange={(e) => setValeur(e.target.value)}
      />
      <button
        type="button"
        disabled={valeur.length < 12}
        onClick={() => {
          void api.utilisateurs
            .modifier(utilisateur.id, { motDePasse: valeur })
            .then(async () => {
              setOuvert(false);
              setValeur("");
              setErreur(null);
              await onFait();
            })
            .catch((cause) => setErreur(cause instanceof Error ? cause.message : String(cause)));
        }}
      >
        Changer
      </button>
      <button type="button" className="ghost" onClick={() => setOuvert(false)}>
        ✕
      </button>
      {erreur && <span className="hint">{erreur}</span>}
    </span>
  );
}

function Inviter({ onCréé }: { onCréé: () => Promise<void> }) {
  const [nom, setNom] = useState("");
  const [courriel, setCourriel] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [role, setRole] = useState<Role>("editeur");
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [occupé, setOccupé] = useState(false);

  async function soumettre(event: React.FormEvent) {
    event.preventDefault();
    setOccupé(true);
    setErreur(null);
    setMessage(null);
    try {
      await api.utilisateurs.creer({ nom: nom.trim(), courriel: courriel.trim(), motDePasse, role });
      setMessage(
        `Compte créé pour ${nom.trim()}. Transmettez-lui le mot de passe de vive voix, pas par courriel.`,
      );
      setNom("");
      setCourriel("");
      setMotDePasse("");
      await onCréé();
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOccupé(false);
    }
  }

  return (
    <form className="panel" onSubmit={soumettre}>
      <header>
        <h2>Ajouter quelqu'un</h2>
      </header>

      <div className="body">
        {erreur && <p className="notice error">{erreur}</p>}
        {message && <p className="notice">{message}</p>}

        <div className="field">
          <label htmlFor="n-nom">Nom</label>
          <input id="n-nom" value={nom} onChange={(e) => setNom(e.target.value)} />
          <p className="hint">Apparaîtra dans le journal des publications.</p>
        </div>

        <div className="field">
          <label htmlFor="n-courriel">Adresse électronique</label>
          <input
            id="n-courriel"
            type="email"
            value={courriel}
            onChange={(e) => setCourriel(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="n-role">Rôle</label>
          <select id="n-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {libelléDuRole(r)}
              </option>
            ))}
          </select>
          <p className="hint">{descriptionDuRole(role)}</p>
        </div>

        <div className="field">
          <label htmlFor="n-mdp">Mot de passe provisoire</label>
          <input
            id="n-mdp"
            type="text"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
          />
          <div className="row-actions">
            <button
              type="button"
              onClick={() => setMotDePasse(phraseDePasse())}
              title="Trois mots tirés au hasard"
            >
              Proposer une phrase
            </button>
          </div>
          <p className="hint">
            Douze caractères au minimum. Il est affiché en clair exprès : vous devez pouvoir le lire
            à la personne.
          </p>
        </div>

        <button
          type="submit"
          className="primary"
          disabled={occupé || !nom.trim() || !courriel.trim() || motDePasse.length < 12}
        >
          {occupé ? "Création…" : "Créer le compte"}
        </button>
      </div>
    </form>
  );
}

/**
 * Une phrase de passe proposée.
 *
 * Trois mots courants tirés au hasard : plus long, plus facile à dire au
 * téléphone et à retenir qu'une suite de caractères tordus — et plus dur à
 * deviner, ce qui est le seul critère qui compte.
 */
const MOTS = [
  "ardoise", "balcon", "cartable", "dictée", "encrier", "fenêtre", "gomme", "horloge",
  "image", "jardin", "kiosque", "lampe", "marelle", "nuage", "orange", "pupitre",
  "quille", "règle", "sablier", "tableau", "usine", "violon", "wagon", "zeste",
];

function phraseDePasse(): string {
  const tirage = new Uint32Array(3);
  crypto.getRandomValues(tirage);
  return Array.from(tirage, (n) => MOTS[n % MOTS.length]).join("-");
}

function JournalPanel({ entrees }: { entrees: EntreeJournal[] }) {
  const [ouvert, setOuvert] = useState(true);

  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <header>
        <button
          type="button"
          className="disclosure"
          aria-expanded={ouvert}
          onClick={() => setOuvert(!ouvert)}
        >
          <span aria-hidden="true">{ouvert ? "▾" : "▸"}</span>
          Journal des actions
        </button>
      </header>

      {ouvert && (
        <div className="body">
          {entrees.length === 0 ? (
            <p className="hint">Rien n'a encore été fait.</p>
          ) : (
            <ul className="history">
              {entrees.map((e) => (
                <li className="history-row" key={e.id}>
                  <span className="title">
                    <b>{e.auteur}</b> — {e.action}
                    {e.cible && <span className="mono"> {e.cible}</span>}
                  </span>
                  <span className="hint">{quand(e.au)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            Seul ce qui change quelque chose y figure : publier, revenir en arrière, déclencher une
            urgence, redémarrer un boîtier, toucher aux comptes. Consulter n'y est pas — un journal
            noyé n'est lu par personne.
          </p>
        </div>
      )}
    </section>
  );
}
