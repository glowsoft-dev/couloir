import { useEffect, useRef, useState } from "react";
import type { Manifest } from "@couloir/protocol";
import { type ScreenStatus, relativeTime } from "./api.js";
import { Vignette } from "./Vignette.js";

/**
 * Le mur d'écrans.
 *
 * La page d'accueil montre ce que chaque écran affiche **en ce moment**, à
 * l'échelle. C'est le seul repère qui vaille pour quelqu'un dont ce n'est
 * pas le métier : on reconnaît son couloir à ce qu'il montre, pas à un
 * numéro de version.
 *
 * Ce ne sont pas des captures : c'est le vrai moteur de rendu, alimenté par
 * le manifeste réellement publié. Ce qu'on voit ici est ce qui est là-bas.
 */

export function MurDEcrans({
  screens,
  manifestes,
  onChoisir,
  selection,
  onBasculer,
}: {
  screens: ScreenStatus[];
  manifestes: Record<string, unknown | null>;
  onChoisir: (screen: ScreenStatus) => void;
  /** Les écrans cochés, pour agir sur plusieurs d'un geste. */
  selection?: string[];
  /**
   * Bascule un écran.
   *
   * On remonte l'INTENTION, pas la liste calculée. Deux coches cliquées coup
   * sur coup lisaient toutes deux la même liste figée, et la seconde
   * écrasait la première : un écran sur deux disparaissait de la sélection.
   */
  onBasculer?: (id: string) => void;
}) {
  if (screens.length === 0) {
    return (
      <div className="mur-vide">
        <p className="mur-vide-titre">Aucun écran pour l'instant</p>
        <p>
          Branchez un boîtier sur un écran. Il affichera un code, et apparaîtra ici tout seul —
          vous n'aurez qu'à dire où il se trouve.
        </p>
      </div>
    );
  }

  return (
    <div className="mur">
      {screens.map((screen) => (
        <CarteDEcran
          key={screen.id}
          screen={screen}
          manifest={(manifestes[screen.id] ?? null) as Manifest | null}
          onChoisir={() => onChoisir(screen)}
          {...(onBasculer
            ? { coche: selection?.includes(screen.id) ?? false, onCocher: () => onBasculer(screen.id) }
            : {})}
        />
      ))}
    </div>
  );
}

function CarteDEcran({
  screen,
  manifest,
  onChoisir,
  coche,
  onCocher,
}: {
  screen: ScreenStatus;
  manifest: Manifest | null;
  onChoisir: () => void;
  coche?: boolean;
  onCocher?: () => void;
}) {
  return (
    <div className={`carte-ecran ${coche ? "cochee" : ""}`}>
      {/*
        Deux gestes distincts sur la même carte : cliquer l'aperçu ouvre
        l'écran, cocher le sélectionne. La coche arrête la propagation —
        sans quoi sélectionner ferait quitter la page.
      */}
      {onCocher && (
        <button
          type="button"
          className="carte-coche"
          role="checkbox"
          aria-checked={coche}
          aria-label={`Sélectionner ${screen.label}`}
          onClick={(e) => {
            e.stopPropagation();
            onCocher();
          }}
        >
          {coche ? "✓" : ""}
        </button>
      )}

      <button type="button" className="carte-ouvrir" onClick={onChoisir}>
      <span className="carte-vignette">
        <Vignette manifest={manifest} screenCode={screen.code} />
        {!screen.online && (
          <span className="carte-voile">
            <span className="carte-voile-pastille">Ne répond pas</span>
            <span className="carte-voile-note">
              dernière image reçue {relativeTime(screen.lastHeartbeatAtMs)}
            </span>
          </span>
        )}
      </span>

      <span className="carte-pied">
        <span className="carte-identite">
          <span className="carte-nom">{screen.label}</span>
          <span className="carte-lieu">
            {screen.code} · {screen.area}
          </span>
        </span>
        <span className={`carte-etat ${screen.online ? "ok" : "muet"}`}>
          <span className={`dot ${screen.online ? "online" : "offline"}`} />
          {screen.online
            ? relativeTime(screen.lastHeartbeatAtMs)
            : "hors ligne"}
        </span>
      </span>
      </button>
    </div>
  );
}
