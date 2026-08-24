import { useEffect, useRef, useState } from "react";
import type { Manifest } from "@couloir/protocol";
import {
  type RotationState,
  type SourceSnapshot,
  direct,
  mountRenderer,
} from "@couloir/renderer";
import { sourceLocale } from "./api.js";

/**
 * L'aperçu fidèle d'un écran.
 *
 * Le vrai noyau de rendu, pas une imitation : le même code que celui qui
 * tourne dans les couloirs. Un aperçu redessiné à la main finirait par
 * mentir le jour où le rendu évolue sans lui.
 *
 * Il est dessiné à 1280×720 puis réduit par transformation. Les tailles de
 * texte du rendu dérivent de la hauteur de la dalle : le réduire en CSS
 * conserve les proportions, alors que le rendre petit produirait un écran
 * différent de celui qu'on verra dans le couloir.
 */

const NATIVE_WIDTH = 1280;
const NATIVE_HEIGHT = 720;

export function ScreenPreview({
  manifest,
  screenCode,
  error,
  /**
   * L'instant simulé, en millisecondes.
   *
   * C'est ce qui rend une programmation vérifiable : sans lui, on ne saurait
   * ce qu'affichera l'écran le 12 septembre qu'en attendant le 12 septembre.
   * Le rendu prend déjà l'instant en paramètre — il n'y avait qu'à cesser de
   * lui passer l'heure courante.
   */
  instant,
}: {
  manifest: Manifest | null;
  screenCode: string;
  error: string | null;
  instant?: number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  /**
   * Mesuré, pas déduit d'une ref pendant le rendu : une ref lue au rendu
   * garde la valeur du tour précédent, et le cadre ne se redimensionnait
   * jamais.
   */
  const [width, setWidth] = useState(0);
  const [sources, setSources] = useState<Map<string, SourceSnapshot>>(new Map());

  // Les sources vivantes sont récupérées comme le ferait l'agent : c'est ce
  // qui rend l'aperçu honnête sur les cours du jour.
  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;

    void Promise.all(
      manifest.dataSources.map(async (source) => {
        try {
          const response = await fetch(sourceLocale(source.url), { cache: "no-store" });
          if (!response.ok) return null;
          return [source.id, { fetchedAtMs: Date.now(), payload: await response.json() }] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setSources(new Map(entries.filter((e): e is NonNullable<typeof e> => e !== null)));
    });

    return () => {
      cancelled = true;
    };
  }, [manifest]);

  // Le cadre s'adapte à la largeur disponible, la scène garde sa taille réelle.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    setWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = stage.current;
    if (!element || !manifest) return;

    const renderer = mountRenderer(element, { assetUrl: (id) => `/v1/assets/${id}` });
    let rotations = new Map<string, RotationState>();
    let mediaEnded = new Set<string>();

    renderer.onMediaEnded((zoneId) => {
      mediaEnded.add(zoneId);
    });

    const tick = () => {
      const output = direct({
        manifest,
        nowMs: instant ?? Date.now(),
        sources,
        // Tout est réputé disponible : l'aperçu montre le résultat voulu,
        // pas l'état d'un cache qui n'existe pas encore sur l'écran.
        availableAssetIds: new Set(manifest.assets.map((asset) => asset.id)),
        rotations,
        mediaEndedZoneIds: mediaEnded,
        screenCode,
      });
      mediaEnded = new Set();
      rotations = output.rotations;
      renderer.update(output.screen);
    };

    tick();
    const timer = setInterval(tick, 500);
    return () => {
      clearInterval(timer);
      renderer.destroy();
    };
  }, [manifest, sources, screenCode, instant]);

  return (
    <section className="panel">
      <header>
        <h2>Aperçu avant publication</h2>
        <span className="spacer" />
        <span className="pill mono">1280 × 720</span>
      </header>

      <div className="body">
        {error ? (
          <p className="notice error">{error}</p>
        ) : (
          <p className="hint" style={{ marginBottom: 10 }}>
            Le rendu réel, celui qui tournera dans le couloir. Les cours affichés sont ceux
            d'aujourd'hui.
          </p>
        )}

        <div
          className="preview-frame"
          ref={frame}
          style={{ aspectRatio: `${NATIVE_WIDTH} / ${NATIVE_HEIGHT}` }}
        >
          <div
            ref={stage}
            className="preview-stage"
            style={{
              width: NATIVE_WIDTH,
              height: NATIVE_HEIGHT,
              transform: `scale(${width / NATIVE_WIDTH})`,
              transformOrigin: "top left",
            }}
          />
          {!manifest && !error && <p className="preview-waiting">Ajoutez un contenu pour voir l'écran.</p>}
        </div>
      </div>
    </section>
  );
}
