import { useEffect, useState } from "react";
import { type PendingDevice, type ScreenStatus, api } from "./api.js";

/**
 * Poser un nouveau boîtier, pas à pas.
 *
 * Entre « j'ai un Raspberry Pi dans un carton » et « il affiche quelque
 * chose », il y avait un trou que seul quelqu'un ayant lu le dépôt savait
 * franchir. Cet assistant le comble, et surtout il **attend le boîtier** : il
 * surveille l'arrivée du nouveau venu et passe à l'étape suivante tout seul.
 *
 * C'est ce qui change tout pour qui n'est pas informaticien — on n'a pas à
 * savoir si ça a marché, l'écran le dit.
 */

interface Installation {
  adresse: string;
  commande: string;
  adresseLocale: boolean;
  sansTls: boolean;
}

const ZONES = ["hall", "couloir", "préau", "cantine", "salle des profs", "accueil"];

/**
 * Le prochain numéro libre pour un bâtiment et un étage.
 *
 * Le code d'étiquette se construit tout seul — « B·1·03 ». Le fixer à 01
 * faisait échouer la pose du deuxième écran d'un même palier, et l'erreur
 * parlait d'un code que personne n'avait choisi.
 */
export function prochainNumero(screens: readonly ScreenStatus[], batiment: string, etage: number): string {
  const prefixe = `${batiment.trim().toUpperCase()}·${etage}·`;
  const pris = screens
    .filter((e) => e.code.startsWith(prefixe))
    .map((e) => Number.parseInt(e.code.slice(prefixe.length), 10))
    .filter((n) => Number.isFinite(n));
  const suivant = pris.length > 0 ? Math.max(...pris) + 1 : 1;
  return String(suivant).padStart(2, "0");
}

export function NouvelEcran({
  pending,
  screens,
  onTermine,
  onAnnuler,
}: {
  pending: PendingDevice[];
  screens: ScreenStatus[];
  onTermine: () => void;
  onAnnuler: () => void;
}) {
  const [etape, setEtape] = useState(1);
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [copie, setCopie] = useState(false);
  /**
   * L'écran une fois rattaché.
   *
   * Tenu ici et non dans le formulaire : le rattachement retire le boîtier de
   * la liste d'attente, le formulaire se démontait donc aussitôt et le
   * message de réussite partait avec lui — on se retrouvait devant « aucun
   * nouveau boîtier » une seconde après avoir réussi.
   */
  const [rattache, setRattache] = useState<string | null>(null);
  /** Les boîtiers déjà là quand on a commencé. */
  const [dejaLa] = useState(() => new Set(pending.map((p) => p.deviceId)));
  /** Quand plusieurs attendent, celui que l'on a désigné. */
  const [choisi, setChoisi] = useState<string | null>(null);

  useEffect(() => {
    void api.installation().then(setInstallation).catch(() => {});
  }, []);

  /**
   * Le boîtier à rattacher.
   *
   * Un arrivant pendant l'assistant l'emporte — c'est le cas de celui qu'on
   * vient d'installer. Sinon on propose ceux qui attendaient déjà : les
   * ignorer obligerait à débrancher et rebrancher un boîtier pour la seule
   * raison qu'on a ouvert l'assistant trop tard.
   */
  const arrivants = pending.filter((p) => !dejaLa.has(p.deviceId));
  const candidats = arrivants.length > 0 ? arrivants : pending;
  const nouveau =
    candidats.find((p) => p.deviceId === choisi) ?? (candidats.length === 1 ? candidats[0]! : null);

  // Un boîtier s'est annoncé pendant qu'on regardait : on passe à la suite
  // sans rien demander. On ne saute pas pour un boîtier qui attendait déjà —
  // ce serait bousculer quelqu'un au milieu de sa lecture.
  useEffect(() => {
    if (arrivants.length > 0 && etape === 3) setEtape(4);
  }, [arrivants.length, etape]);

  return (
    <div className="assistant">
      <button type="button" className="retour" onClick={onAnnuler}>
        ← Tous les écrans
      </button>

      <header className="assistant-entete">
        <h1>Poser un nouvel écran</h1>
        <p>Comptez une vingtaine de minutes, dont quinze d'attente.</p>
      </header>

      <ol className="etapes">
        <Etape numero={1} courante={etape} titre="Ce qu'il vous faut" onOuvrir={setEtape}>
          <ul className="liste-materiel">
            <li>
              <b>Un Raspberry Pi 5</b> (4 Go suffisent) avec son alimentation officielle.
            </li>
            <li>
              <b>Un module d'horloge</b> pour le Pi. Sans lui, le boîtier perd l'heure à chaque
              coupure de courant — et un écran qui ne sait pas l'heure ne peut pas suivre une
              programmation.
            </li>
            <li>
              <b>Une carte micro-SD</b> de 32 Go, en classe A2 de préférence : elle sera lue en
              permanence.
            </li>
            <li>
              <b>Un câble HDMI</b> et l'écran lui-même.
            </li>
            <li>
              <b>Un accès au réseau</b> de l'établissement, en Ethernet si possible : le Wi-Fi d'un
              couloir tombe, et un écran tombé se voit de loin.
            </li>
          </ul>
          <p className="hint">
            Comptez environ 150 € par écran, hors dalle.
          </p>
          <BoutonSuivant onClick={() => setEtape(2)} />
        </Etape>

        <Etape numero={2} courante={etape} titre="Préparer la carte" onOuvrir={setEtape}>
          <p>
            Installez <b>Raspberry Pi Imager</b> sur votre ordinateur, puis écrivez{" "}
            <b>Raspberry Pi OS (64 bits)</b> sur la carte micro-SD.
          </p>
          <p>
            Dans les réglages avancés de l'Imager (l'engrenage), avant d'écrire :
          </p>
          <ul>
            <li>donnez un nom à la machine — le lieu de l'écran fait un bon nom ;</li>
            <li>activez <b>SSH</b> et choisissez un mot de passe ;</li>
            <li>renseignez le Wi-Fi si le boîtier n'aura pas d'Ethernet.</li>
          </ul>
          <p className="hint">
            Insérez ensuite la carte dans le Pi, branchez l'écran et l'alimentation, et attendez
            qu'il démarre.
          </p>
          <BoutonSuivant onClick={() => setEtape(3)} />
        </Etape>

        <Etape numero={3} courante={etape} titre="Lancer l'installation" onOuvrir={setEtape}>
          {installation?.adresseLocale && (
            <p className="notice error">
              L'adresse de ce serveur est <span className="mono">{installation.adresse}</span> : elle
              ne désigne que la machine sur laquelle il tourne. Un boîtier ne pourra jamais la
              joindre. Renseignez <span className="mono">COULOIR_PUBLIC_URL</span> avec l'adresse
              que voient les écrans avant de poser quoi que ce soit.
            </p>
          )}
          {installation && !installation.adresseLocale && installation.sansTls && (
            <p className="notice">
              Ce serveur répond en <span className="mono">http</span>, sans chiffrement. La commande
              ci-dessous télécharge donc un script en clair. Acceptable sur le réseau interne d'un
              établissement ; à corriger avant toute exposition sur Internet.
            </p>
          )}

          <p>
            Connectez-vous au boîtier en SSH depuis votre ordinateur, puis collez cette commande.
            L'adresse de ce serveur y est déjà.
          </p>

          <div className="commande">
            <code>{installation?.commande ?? "…"}</code>
            <button
              type="button"
              disabled={!installation}
              onClick={() => {
                if (!installation) return;
                void navigator.clipboard.writeText(installation.commande).then(() => {
                  setCopie(true);
                  setTimeout(() => setCopie(false), 2000);
                });
              }}
            >
              {copie ? "Copié" : "Copier"}
            </button>
          </div>

          <p className="hint">
            Elle installe Chromium en mode kiosque, le lecteur, et deux services qui redémarrent
            seuls. Comptez dix à quinze minutes selon la connexion. Si vous préférez lire le script
            avant de l'exécuter, ouvrez{" "}
            <span className="mono">{installation?.adresse}/installer.sh</span> dans un navigateur.
          </p>

          <div className="attente">
            <span className="attente-rond" />
            <span>
              J'attends que le boîtier s'annonce. Il apparaîtra ici tout seul dès qu'il aura joint
              le serveur — vous n'avez rien d'autre à faire.
            </span>
          </div>
        </Etape>

        <Etape
          numero={4}
          courante={etape}
          titre={rattache ? "C'est posé" : "Dire où il se trouve"}
          onOuvrir={setEtape}
        >
          {rattache ? (
            <Reussite code={rattache} onTermine={onTermine} />
          ) : nouveau ? (
            <FormulaireDeLieu boitier={nouveau} screens={screens} onRattache={setRattache} />
          ) : candidats.length > 1 ? (
            <>
              <p>
                {candidats.length} boîtiers attendent d'être rattachés. Lequel venez-vous
                d'installer ? Le code s'affiche sur l'écran.
              </p>
              <div className="row-actions">
                {candidats.map((c) => (
                  <button key={c.deviceId} type="button" onClick={() => setChoisi(c.deviceId)}>
                    <span className="mono">{c.pairingCode}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="hint">
              Aucun boîtier n'attend d'être rattaché. Revenez à l'étape précédente si
              l'installation n'est pas lancée.
            </p>
          )}
        </Etape>
      </ol>
    </div>
  );
}

function BoutonSuivant({ onClick }: { onClick: () => void }) {
  return (
    <div className="row-actions">
      <button type="button" className="primary" onClick={onClick}>
        C'est fait, étape suivante
      </button>
    </div>
  );
}

function Etape({
  numero,
  courante,
  titre,
  onOuvrir,
  children,
}: {
  numero: number;
  courante: number;
  titre: string;
  onOuvrir: (n: number) => void;
  children: React.ReactNode;
}) {
  const ouverte = numero === courante;
  const passee = numero < courante;

  return (
    <li className={`etape ${ouverte ? "ouverte" : ""} ${passee ? "passee" : ""}`}>
      <button type="button" className="etape-titre" onClick={() => onOuvrir(numero)}>
        <span className="etape-numero" aria-hidden="true">
          {passee ? "✓" : numero}
        </span>
        {titre}
      </button>
      {ouverte && <div className="etape-corps">{children}</div>}
    </li>
  );
}

/** Ce qu'on montre une fois l'écran rattaché. Tenu par l'assistant, pas par
 *  le formulaire : celui-ci disparaît à l'instant où le rattachement réussit. */
function Reussite({ code, onTermine }: { code: string; onTermine: () => void }) {
  return (
    <>
      <p className="notice">
        C'est fait. L'écran s'appelle <b>{code}</b> et affiche déjà son code d'identité.
      </p>
      <p className="hint">
        Il apparaît maintenant sur le mur. Ouvrez-le pour choisir ce qu'il diffuse — et servez-vous
        du bouton <b>Identifier</b> pour vérifier depuis le couloir que c'est bien celui-là.
      </p>
      <div className="row-actions">
        <button type="button" className="primary" onClick={onTermine}>
          Voir le mur d'écrans
        </button>
      </div>
    </>
  );
}

function FormulaireDeLieu({
  boitier,
  screens,
  onRattache,
}: {
  boitier: PendingDevice;
  screens: ScreenStatus[];
  onRattache: (code: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [building, setBuilding] = useState("A");
  const [floor, setFloor] = useState(0);
  const [area, setArea] = useState("couloir");
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupé, setOccupé] = useState(false);

  async function rattacher() {
    setOccupé(true);
    setErreur(null);
    try {
      const r = await api.pair({
        pairingCode: boitier.pairingCode,
        code: `${building.trim().toUpperCase()}·${floor}·${prochainNumero(screens, building, floor)}`,
        label: label.trim(),
        building: building.trim().toUpperCase(),
        floor,
        area: area.trim(),
      });
      onRattache(r.screenCode);
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOccupé(false);
    }
  }

  return (
    <>
      <p className="notice">
        Le boîtier s'est annoncé. Il affiche le code <b className="mono">{boitier.pairingCode}</b> —
        vérifiez qu'il correspond bien à ce que vous voyez sur l'écran.
      </p>

      {erreur && <p className="notice error">{erreur}</p>}

      <div className="field">
        <label htmlFor="ne-label">Où se trouve cet écran ?</label>
        <input
          id="ne-label"
          value={label}
          placeholder="Couloir du premier étage, aile nord"
          autoFocus
          onChange={(e) => setLabel(e.target.value)}
        />
        <p className="hint">En clair : c'est ce nom que vous lirez sur le mur d'écrans.</p>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="ne-bat">Bâtiment</label>
          <input
            id="ne-bat"
            value={building}
            maxLength={2}
            onChange={(e) => setBuilding(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ne-etage">Étage</label>
          <input
            id="ne-etage"
            type="number"
            min={-2}
            max={20}
            value={floor}
            onChange={(e) => setFloor(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="ne-zone">Type de lieu</label>
          <select id="ne-zone" value={area} onChange={(e) => setArea(e.target.value)}>
            {ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="hint">
        Cet écran s'appellera{" "}
        <b className="mono">
          {building.trim().toUpperCase()}·{floor}·{prochainNumero(screens, building, floor)}
        </b>
        . Le bâtiment décide de l'emploi du temps affiché : un écran du bâtiment B montrera les
        cours du bâtiment B, sans réglage supplémentaire.
      </p>

      <div className="row-actions">
        <button type="button" className="primary" onClick={() => void rattacher()} disabled={!label.trim() || occupé}>
          {occupé ? "Rattachement…" : "Rattacher cet écran"}
        </button>
      </div>
    </>
  );
}
