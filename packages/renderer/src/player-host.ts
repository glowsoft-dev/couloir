import type { Manifest } from "@couloir/protocol";
import { type SlideTransition, direct } from "./director.js";
import type { RotationState } from "./rotation.js";
import { type MountOptions, mountRenderer } from "./dom/mount.js";
import type { SourceSnapshot } from "./staleness.js";

/**
 * L'hôte du player, côté page.
 *
 * C'est le trait d'union entre l'agent et le rendu. L'agent tourne dans un
 * processus séparé — il gère le réseau, le cache et la résilience — et publie
 * son état sur une URL locale. La page l'interroge et fait tourner le rendu.
 *
 * Ce découpage a une raison précise : Chromium peut planter, être relancé par
 * le chien de garde, ou recharger la page, sans que l'agent perde son cache,
 * sa file de télémétrie ou sa position dans la synchronisation.
 */

export interface PlayerState {
  manifest: Manifest | null;
  /** Données vivantes récupérées par l'agent, avec leur date de récupération. */
  sources: Record<string, SourceSnapshot>;
  /** Médias réellement présents et vérifiés dans le cache local. */
  availableAssetIds: string[];
  /** Imposé par l'agent après une coupure trop longue. */
  forceFallback: boolean;
  identify: { screenCode: string; label: string; ipAddress: string } | null;
  screenCode: string | null;
  /** Affiché tant que l'écran n'est pas rattaché à un emplacement. */
  pairing: { code: string; expiresAt: string } | null;
}

export interface PlayerHostOptions extends MountOptions {
  stateUrl: string;
  /** Où renvoyer les preuves de diffusion. */
  transitionsUrl?: string;
  /** Fréquence d'interrogation de l'agent. */
  pollMs?: number;
  /** Cadence de réévaluation du rendu. */
  tickMs?: number;
}

export interface PlayerHostHandle {
  stop(): void;
}

export function startPlayer(container: HTMLElement, options: PlayerHostOptions): PlayerHostHandle {
  const renderer = mountRenderer(container, options);
  const pollMs = options.pollMs ?? 2_000;
  const tickMs = options.tickMs ?? 500;

  let state: PlayerState | null = null;
  let rotations = new Map<string, RotationState>();
  let mediaEnded = new Set<string>();
  let stopped = false;

  renderer.onMediaEnded((zoneId) => {
    mediaEnded.add(zoneId);
    tick();
  });

  /**
   * Le nom de l'onglet, c'est le code de l'écran.
   *
   * Sans ça toutes les pages s'appellent « Couloir » : trois onglets ouverts
   * et on ne sait plus lequel regarde quel couloir. On publie alors sur un
   * écran en observant l'autre, on conclut que la publication ne marche pas,
   * et on reclique. C'est exactement ce qui est arrivé.
   *
   * Utile aussi en vrai : on ouvre la page d'un écran depuis un portable pour
   * vérifier ce qu'il diffuse, et l'onglet dit lequel c'est.
   */
  function nommerOnglet(next: PlayerState): void {
    if (typeof document === "undefined") return;
    const titre = next.screenCode
      ? next.screenCode
      : next.pairing
        ? `À rattacher · ${next.pairing.code}`
        : "Couloir";
    if (document.title !== titre) document.title = titre;
  }

  async function poll(): Promise<void> {
    if (stopped) return;
    try {
      const response = await fetch(options.stateUrl, { cache: "no-store" });
      if (response.ok) {
        const next = (await response.json()) as PlayerState;
        // Un changement de manifeste remet les tourniquets à zéro : les
        // identifiants de diapositives ne survivent pas forcément.
        if (next.manifest?.version !== state?.manifest?.version) rotations = new Map();
        state = next;
        nommerOnglet(next);
      }
    } catch {
      // L'agent n'est pas joignable : on continue avec le dernier état connu
      // plutôt que d'effacer l'écran.
    }
  }

  function tick(): void {
    if (stopped) return;

    if (!state?.manifest) {
      renderer.update(pendingScreen(state));
      return;
    }

    const output = direct({
      manifest: state.manifest,
      nowMs: Date.now(),
      sources: new Map(Object.entries(state.sources)),
      availableAssetIds: new Set(state.availableAssetIds),
      rotations,
      forceFallback: state.forceFallback,
      identify: state.identify,
      mediaEndedZoneIds: mediaEnded,
      ...(state.screenCode !== null ? { screenCode: state.screenCode } : {}),
    });

    mediaEnded = new Set();
    rotations = output.rotations;
    renderer.update(output.screen);

    if (output.transitions.length > 0 && options.transitionsUrl) {
      void report(options.transitionsUrl, output.transitions);
    }
  }

  const pollTimer = setInterval(() => void poll(), pollMs);
  const tickTimer = setInterval(tick, tickMs);
  void poll().then(tick);

  return {
    stop() {
      stopped = true;
      clearInterval(pollTimer);
      clearInterval(tickTimer);
      renderer.destroy();
    },
  };
}

/**
 * Ce qu'on montre avant d'avoir un manifeste.
 *
 * Au premier démarrage, c'est le code d'appairage : il doit être lisible
 * depuis le couloir pour être recopié dans la console. Ensuite, une page
 * d'attente sobre — jamais un message d'erreur technique devant les élèves.
 */
function pendingScreen(state: PlayerState | null): Parameters<ReturnType<typeof mountRenderer>["update"]>[0] {
  if (state?.pairing) {
    return {
      mode: "identify",
      zones: [],
      emergency: null,
      identify: {
        screenCode: state.pairing.code,
        label: "Saisissez ce code dans la console pour rattacher cet écran",
        ipAddress: "",
      },
      accent: null,
    zoom: null,
      watermark: null,
    };
  }
  return {
    mode: "normal",
    // L'écran d'attente précède tout manifeste : aucune identité connue.
    accent: null,
    zoom: null,
    zones: [
      {
        zoneId: "attente",
        rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
        playlistId: "attente",
        slide: {
          kind: "template",
          slideId: "attente",
          templateId: "identite-ecole",
          fields: { eyebrow: "Écran en préparation", titre: "Bienvenue" },
        },
      },
    ],
    emergency: null,
    identify: null,
    watermark: state?.screenCode ?? null,
  };
}

async function report(url: string, transitions: SlideTransition[]): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transitions }),
      keepalive: true,
    });
  } catch {
    // Sans conséquence : l'agent journalise déjà côté processus.
  }
}
