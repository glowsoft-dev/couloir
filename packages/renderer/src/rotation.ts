/**
 * Le tourniquet d'une zone.
 *
 * Chaque zone avance dans sa playlist indépendamment des autres. La logique
 * est pure : on lui donne l'état courant et l'instant, elle renvoie l'état
 * suivant. C'est ce qui permet de rejouer une journée entière de rotation en
 * quelques millisecondes dans un test, plutôt que d'attendre devant un écran.
 */

export interface RotationState {
  playlistId: string;
  index: number;
  slideStartedAtMs: number;
}

export interface RotationInput {
  /** Absent au premier tour, ou après un changement de playlist. */
  state: RotationState | undefined;
  playlistId: string;
  slideIds: readonly string[];
  /**
   * Une diapositive dont la source est périmée, ou dont le média n'est pas
   * encore en cache, est sautée sans bloquer la rotation.
   */
  isEligible: (slideId: string) => boolean;
  /** `null` pour une vidéo : elle dure le temps qu'elle dure. */
  durationMsOf: (slideId: string) => number | null;
  nowMs: number;
  /** Signalé par la couche DOM quand une vidéo se termine. */
  mediaEnded?: boolean;
}

export interface RotationResult {
  /** `null` quand plus aucune diapositive n'est diffusable. */
  state: RotationState | null;
  currentSlideId: string | null;
  /** Vrai si on vient de changer de diapositive — sert la preuve de diffusion. */
  changed: boolean;
}

function nextEligibleIndex(
  slideIds: readonly string[],
  from: number,
  isEligible: (slideId: string) => boolean,
): number | null {
  for (let step = 1; step <= slideIds.length; step++) {
    const index = (from + step) % slideIds.length;
    const slideId = slideIds[index];
    if (slideId !== undefined && isEligible(slideId)) return index;
  }
  return null;
}

function firstEligibleIndex(
  slideIds: readonly string[],
  isEligible: (slideId: string) => boolean,
): number | null {
  for (let index = 0; index < slideIds.length; index++) {
    const slideId = slideIds[index];
    if (slideId !== undefined && isEligible(slideId)) return index;
  }
  return null;
}

export function advanceRotation(input: RotationInput): RotationResult {
  const { state, playlistId, slideIds, isEligible, durationMsOf, nowMs } = input;
  const previousSlideId =
    state && state.playlistId === playlistId ? (slideIds[state.index] ?? null) : null;

  const start = (index: number | null): RotationResult => {
    if (index === null) {
      return { state: null, currentSlideId: null, changed: previousSlideId !== null };
    }
    const slideId = slideIds[index]!;
    return {
      state: { playlistId, index, slideStartedAtMs: nowMs },
      currentSlideId: slideId,
      changed: slideId !== previousSlideId,
    };
  };

  // Premier tour, ou la programmation a changé de playlist : on repart du début.
  if (!state || state.playlistId !== playlistId || state.index >= slideIds.length) {
    return start(firstEligibleIndex(slideIds, isEligible));
  }

  const currentSlideId = slideIds[state.index];
  if (currentSlideId === undefined || !isEligible(currentSlideId)) {
    // La diapositive courante n'est plus diffusable — sa source vient de
    // se périmer, par exemple. On enchaîne sans laisser de trou.
    return start(nextEligibleIndex(slideIds, state.index, isEligible));
  }

  const duration = durationMsOf(currentSlideId);
  const elapsed = nowMs - state.slideStartedAtMs;
  const shouldAdvance = duration === null ? input.mediaEnded === true : elapsed >= duration;

  if (!shouldAdvance) {
    return { state, currentSlideId, changed: false };
  }

  const next = nextEligibleIndex(slideIds, state.index, isEligible);
  // Une playlist à une seule diapositive tourne sur elle-même : on repart
  // le chronomètre plutôt que de figer l'écran.
  if (next === null) return start(null);
  return start(next);
}
