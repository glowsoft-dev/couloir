import type { ScreenStatus } from "./api.js";
import { relativeTime } from "./api.js";

/**
 * Où part cette composition.
 *
 * L'écran ouvert est coché et ne se décoche pas — on est venu le modifier.
 * Les autres s'ajoutent, et chacun dit **ce que la publication lui fera** :
 * un écran muet la recevra à son retour, un écran réglé autrement gardera
 * sa mise en page.
 *
 * Écrire la conséquence plutôt que le seul nom, c'est la différence entre
 * cocher une case et savoir ce qu'on fait.
 */

export function OuCaPart({
  ecranCourant,
  autres,
  choisis,
  onBasculer,
}: {
  ecranCourant: ScreenStatus;
  autres: ScreenStatus[];
  choisis: string[];
  onBasculer: (id: string) => void;
}) {
  return (
    <section className="cible">
      <h3>Où ça part</h3>

      <label className="cible-ligne fixe">
        <input type="checkbox" checked readOnly disabled />
        <span className="cible-texte">
          <span className="cible-nom">{ecranCourant.label}</span>
          <span className="cible-note">
            {ecranCourant.code} · l'écran que vous modifiez
          </span>
        </span>
        <span className={`dot ${ecranCourant.online ? "online" : "offline"}`} />
      </label>

      {autres.map((e) => {
        const coche = choisis.includes(e.id);
        return (
          <label key={e.id} className={`cible-ligne ${coche ? "" : "eteinte"}`}>
            <input type="checkbox" checked={coche} onChange={() => onBasculer(e.id)} />
            <span className="cible-texte">
              <span className="cible-nom">{e.label}</span>
              <span className="cible-note">
                {e.code} ·{" "}
                {!e.online
                  ? e.lastHeartbeatAtMs === null
                    ? // Jamais vu : « muet depuis jamais vu » ne veut rien dire.
                      "ne s'est jamais annoncé, recevra à sa première connexion"
                    : `muet depuis ${relativeTime(e.lastHeartbeatAtMs)}, recevra à son retour`
                  : coche
                    ? "garde sa mise en page"
                    : "ne changera pas"}
              </span>
            </span>
            <span className={`dot ${e.online ? "online" : "offline"}`} />
          </label>
        );
      })}

      {autres.length === 0 && (
        <p className="hint">C'est le seul écran rattaché pour l'instant.</p>
      )}

      {choisis.length > 0 && (
        <p className="hint">
          Chaque écran garde sa mise en page, son emploi du temps et son heure d'extinction. Seule
          la rotation change.
        </p>
      )}
    </section>
  );
}
