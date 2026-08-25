import { useEffect, useRef, useState } from "react";
import type { Manifest } from "@couloir/protocol";
import { type RotationState, direct, mountRenderer } from "@couloir/renderer";
import type { SourceSnapshot } from "@couloir/renderer";
import { type ScreenStatus, relativeTime, sourceLocale } from "./api.js";

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

/**
 * Une miniature vivante.
 *
 * Le rendu est dessiné à sa taille réelle — 1280 × 720 — puis réduit par une
 * transformation. Le dessiner petit donnerait des tailles de texte fausses :
 * le noyau de rendu calcule ses échelles typographiques sur la hauteur de la
 * dalle, et une miniature composée à 320 px de haut afficherait des titres
 * qu'aucun écran de couloir ne produira jamais.
 */
function Vignette({ manifest, screenCode }: { manifest: Manifest | null; screenCode: string }) {
  const cadre = useRef<HTMLSpanElement>(null);
  const scene = useRef<HTMLSpanElement>(null);
  const [largeur, setLargeur] = useState(0);

  useEffect(() => {
    const element = cadre.current;
    if (!element) return;
    const observateur = new ResizeObserver(() => setLargeur(element.clientWidth));
    setLargeur(element.clientWidth);
    observateur.observe(element);
    return () => observateur.disconnect();
  }, []);

  useEffect(() => {
    const element = scene.current;
    if (!element || !manifest) return;

    const renderer = mountRenderer(element, { assetUrl: (id) => `/v1/assets/${id}` });
    let rotations = new Map<string, RotationState>();
    const sources = new Map<string, SourceSnapshot>();
    let vivant = true;

    /**
     * Les sources vivantes, chargées comme le ferait l'écran.
     *
     * Sans elles, la colonne des cours resterait vide dans la vignette alors
     * qu'elle est pleine sur la dalle — l'aperçu mentirait précisément là où
     * on compte sur lui.
     */
    const charger = () => {
      for (const source of manifest.dataSources) {
        void fetch(sourceLocale(source.url))
          .then((r) => (r.ok ? r.json() : null))
          .then((payload) => {
            if (vivant && payload) sources.set(source.id, { fetchedAtMs: Date.now(), payload });
          })
          .catch(() => {});
      }
    };
    charger();

    const battement = () => {
      const sortie = direct({
        manifest,
        nowMs: Date.now(),
        sources,
        // Tout est réputé téléchargé : la vignette montre le contenu voulu,
        // pas l'état du cache d'un boîtier qu'on ne peut pas interroger.
        availableAssetIds: new Set(manifest.assets.map((a) => a.id)),
        rotations,
        screenCode,
      });
      rotations = sortie.rotations;
      renderer.update(sortie.screen);
    };

    battement();
    const horloge = setInterval(battement, 1000);
    const rafraichi = setInterval(charger, 5 * 60 * 1000);
    return () => {
      vivant = false;
      clearInterval(horloge);
      clearInterval(rafraichi);
      renderer.destroy();
    };
  }, [manifest, screenCode]);

  const échelle = largeur > 0 ? largeur / 1280 : 0;

  if (!manifest) {
    return (
      <span className="vignette-vide" ref={cadre}>
        Rien de publié
      </span>
    );
  }

  return (
    <span className="vignette" ref={cadre}>
      <span
        className="vignette-scene"
        ref={scene}
        style={{
          width: 1280,
          height: 720,
          transform: `scale(${échelle})`,
          transformOrigin: "top left",
          opacity: échelle > 0 ? 1 : 0,
        }}
      />
    </span>
  );
}
