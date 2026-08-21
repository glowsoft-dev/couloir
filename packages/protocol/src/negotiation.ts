import type { Capabilities, VideoCodec } from "./capabilities.js";

/**
 * Choix du bon fichier pour un appareil donné.
 *
 * Le serveur transcode chaque vidéo en plusieurs dérivés, puis sert à chaque
 * écran celui qu'il sait lire. Une 4K ne part pas sur un boîtier limité au
 * 1080p, et un écran à faible espace disque reçoit des fichiers plus légers.
 *
 * Logique pure, sans accès réseau ni base : c'est ce qui la rend testable
 * sur les cinq profils d'appareils sans monter d'infrastructure.
 */

export interface VideoDerivative {
  id: string;
  codec: VideoCodec;
  heightPx: number;
  bytes: number;
}

export interface DerivativeChoice {
  derivative: VideoDerivative;
  /** Vrai si on a dû descendre en qualité par rapport au meilleur dérivé. */
  downgraded: boolean;
}

/** Pourquoi aucun dérivé ne convient — remonté tel quel dans la console. */
export type IncompatibilityReason =
  | { reason: "no-derivatives" }
  | { reason: "codec-unsupported"; available: VideoCodec[]; supported: VideoCodec[] }
  | { reason: "resolution-too-high"; smallestHeightPx: number; maxHeightPx: number };

export type NegotiationResult =
  | { ok: true; choice: DerivativeChoice }
  | { ok: false; problem: IncompatibilityReason };

/**
 * Ordre de préférence quand plusieurs codecs conviennent.
 * On privilégie le plus efficace que l'appareil sache décoder : à qualité
 * égale, moins d'octets à télécharger, donc une resynchronisation plus
 * rapide après une coupure.
 */
const CODEC_PREFERENCE: readonly VideoCodec[] = ["av1", "hevc", "vp9", "h264"];

export function chooseVideoDerivative(
  derivatives: readonly VideoDerivative[],
  caps: Capabilities,
): NegotiationResult {
  if (derivatives.length === 0) {
    return { ok: false, problem: { reason: "no-derivatives" } };
  }

  const supported = new Set(caps.codecs);
  const playable = derivatives.filter((d) => supported.has(d.codec));
  if (playable.length === 0) {
    return {
      ok: false,
      problem: {
        reason: "codec-unsupported",
        available: [...new Set(derivatives.map((d) => d.codec))],
        supported: [...caps.codecs],
      },
    };
  }

  const withinResolution = playable.filter((d) => d.heightPx <= caps.maxVideoHeight);
  if (withinResolution.length === 0) {
    const smallest = Math.min(...playable.map((d) => d.heightPx));
    return {
      ok: false,
      problem: {
        reason: "resolution-too-high",
        smallestHeightPx: smallest,
        maxHeightPx: caps.maxVideoHeight,
      },
    };
  }

  // La plus haute résolution acceptable, puis le codec le plus efficace,
  // puis le fichier le plus léger — dans cet ordre.
  const best = [...withinResolution].sort((a, b) => {
    if (a.heightPx !== b.heightPx) return b.heightPx - a.heightPx;
    const rank = CODEC_PREFERENCE.indexOf(a.codec) - CODEC_PREFERENCE.indexOf(b.codec);
    if (rank !== 0) return rank;
    return a.bytes - b.bytes;
  })[0]!;

  const bestAvailableHeight = Math.max(...derivatives.map((d) => d.heightPx));
  return { ok: true, choice: { derivative: best, downgraded: best.heightPx < bestAvailableHeight } };
}

/**
 * Message lisible pour la console.
 * On explique la cause, jamais un code d'erreur brut — c'est une personne
 * du service communication qui le lira.
 */
export function explainIncompatibility(problem: IncompatibilityReason): string {
  switch (problem.reason) {
    case "no-derivatives":
      return "Cette vidéo n'a pas encore été convertie. Réessayez dans quelques minutes.";
    case "codec-unsupported":
      return `Ce boîtier ne sait pas lire cette vidéo (formats disponibles : ${problem.available.join(", ")} ; formats lus par l'appareil : ${problem.supported.join(", ")}).`;
    case "resolution-too-high":
      return `Cette vidéo est trop grande pour ce boîtier : ${problem.smallestHeightPx}p disponible au minimum, ${problem.maxHeightPx}p maximum sur l'appareil.`;
  }
}
