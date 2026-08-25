import { useEffect, useRef, useState } from "react";
import type { Manifest } from "@couloir/protocol";
import { type RotationState, type SourceSnapshot, direct, mountRenderer } from "@couloir/renderer";
import { sourceLocale } from "./api.js";

/**
 * Une miniature vivante.
 *
 * Le rendu est dessiné à sa taille réelle — 1280 × 720 — puis réduit par une
 * transformation. Le dessiner petit donnerait des tailles de texte fausses :
 * le noyau de rendu calcule ses échelles typographiques sur la hauteur de la
 * dalle, et une miniature composée à 320 px de haut afficherait des titres
 * qu'aucun écran de couloir ne produira jamais.
 */
export function Vignette({
  manifest,
  screenCode,
  instantMs,
  sourcesVersion,
  vide = "Rien de publié",
}: {
  manifest: Manifest | null;
  screenCode: string;
  /**
   * L'instant à jouer, au lieu de maintenant.
   *
   * C'est ce qui permet de regarder un autre jour que celui-ci : le noyau
   * de rendu écarte un emploi du temps dont la date n'est pas celle du jour
   * — à raison, une colonne périmée envoie quelqu'un dans la mauvaise salle
   * — et sans cette bascule un aperçu de demain sortirait vide.
   */
  instantMs?: number;
  /**
   * Un compteur qui, en changeant, fait relire les sources.
   *
   * Les sources se rafraîchissent d'elles-mêmes toutes les cinq minutes,
   * ce qui suffit à un mur qu'on regarde. Ça ne suffit pas à un aperçu qu'on
   * consulte pour vérifier ce qu'on vient de saisir : sans ce signal, on
   * annule un cours et la dalle continue de l'afficher pendant cinq minutes.
   */
  sourcesVersion?: number;
  /** Ce qu'on écrit à la place quand il n'y a rien à jouer. */
  vide?: string;
}) {
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
            if (!vivant || !payload) return;
            /*
             * Sur un instant figé, la donnée est réputée reçue à cet
             * instant-là. Elle vient d'arriver ; la dater de maintenant la
             * ferait paraître vieille de trois jours dès qu'on regarde
             * vendredi, et l'aperçu porterait un « mis à jour mardi » qui ne
             * dit rien de ce que l'écran affichera ce vendredi-là.
             */
            sources.set(source.id, { fetchedAtMs: instantMs ?? Date.now(), payload });
            // Redessiner à l'arrivée, et pas seulement au battement suivant :
            // sur un instant figé il n'y a pas de battement suivant, et la
            // vignette resterait noire alors que la journée est arrivée.
            battement();
          })
          .catch(() => {});
      }
    };

    const battement = () => {
      const sortie = direct({
        manifest,
        nowMs: instantMs ?? Date.now(),
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

    charger();
    battement();
    // Un instant figé n'a pas besoin d'horloge : seule l'arrivée des sources
    // change quelque chose, et `charger` s'en occupe.
    const horloge = instantMs === undefined ? setInterval(battement, 1000) : null;
    const rafraichi = setInterval(charger, 5 * 60 * 1000);
    return () => {
      vivant = false;
      if (horloge) clearInterval(horloge);
      clearInterval(rafraichi);
      renderer.destroy();
    };
  }, [manifest, screenCode, instantMs, sourcesVersion]);

  const échelle = largeur > 0 ? largeur / 1280 : 0;

  if (!manifest) {
    return (
      <span className="vignette-vide" ref={cadre}>
        {vide}
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
