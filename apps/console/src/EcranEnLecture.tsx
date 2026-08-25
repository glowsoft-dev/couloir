import { useEffect, useState } from "react";
import type { Manifest } from "@couloir/protocol";
import { type ManifestVersion, type ScreenStatus, api, relativeTime } from "./api.js";
import { Vignette } from "./Vignette.js";

/**
 * Un écran, pour qui ne publie pas.
 *
 * La direction, l'intendance, un conseil : ils veulent voir ce qui passe dans
 * les couloirs, pas le composer. On leur montrait pourtant l'éditeur complet,
 * dont chaque bouton se serait fait refuser par le serveur — un bouton qui
 * refuse est pire qu'un bouton absent.
 *
 * Ce qui reste est ce qui répond à leur question : ce que l'écran affiche en
 * ce moment, et depuis quand.
 */

export function EcranEnLecture({
  screen,
  manifest,
}: {
  screen: ScreenStatus;
  manifest: Manifest | null;
}) {
  const [versions, setVersions] = useState<ManifestVersion[]>([]);

  useEffect(() => {
    void api
      .history(screen.id)
      .then((r) => setVersions(r.versions))
      .catch(() => {});
  }, [screen.id]);

  const derniere = versions[0];

  return (
    <div className="lecture-ecran">
      <div className="lecture-dalle">
        <Vignette manifest={manifest} screenCode={screen.code} vide="Rien de publié" />
      </div>

      <dl className="lecture-faits">
        <div>
          <dt>État</dt>
          <dd className={screen.online ? "" : "lecture-muet"}>
            {/* Un boîtier qui ne s'est jamais annoncé n'est pas en panne :
                il vient d'être rattaché et n'a pas encore appelé. Écrire
                « ne répond plus depuis jamais vu » ferait chercher une
                panne qui n'existe pas. */}
            {screen.online
              ? `en ligne, vu ${relativeTime(screen.lastHeartbeatAtMs)}`
              : screen.lastHeartbeatAtMs === null
                ? "ne s'est pas encore annoncé"
                : `ne répond plus depuis ${relativeTime(screen.lastHeartbeatAtMs)}`}
          </dd>
        </div>
        <div>
          <dt>Emplacement</dt>
          <dd>
            bâtiment {screen.building}, étage {screen.floor} — {screen.area}
          </dd>
        </div>
        <div>
          <dt>Dernière publication</dt>
          <dd>
            {derniere
              ? [
                  `version ${derniere.version}`,
                  derniere.auteur,
                  derniere.contenu,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "rien n'a encore été publié"}
          </dd>
        </div>
      </dl>

      <p className="lecture-note">
        Cette page ne modifie rien. Pour changer ce qui s'affiche ici, demandez à quelqu'un qui
        publie.
      </p>
    </div>
  );
}
