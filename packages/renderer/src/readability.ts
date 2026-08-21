import type { Slide } from "@couloir/protocol";

/**
 * Règles de lisibilité, imposées par le rendu.
 *
 * Personne n'y pense au moment de créer une diapositive : on la compose sur
 * un écran de bureau, à cinquante centimètres, assis. Elle sera lue à quatre
 * mètres, debout, en marchant. Le noyau de rendu applique donc deux garde-fous
 * que la personne qui publie n'a pas à connaître.
 */

/**
 * Vitesse de lecture retenue, en mots par minute.
 *
 * La lecture courante tourne autour de 200 mots/minute. À distance, sur un
 * écran croisé en passant, on descend nettement : 130 laisse le temps de
 * lever les yeux, de trouver le texte, puis de le lire.
 */
export const READING_WORDS_PER_MINUTE = 130;

/** Temps de « prise en main » avant la lecture proprement dite. */
export const GLANCE_TIME_MS = 2_500;

/** Personne ne s'arrête devant un écran : au-delà, on perd le passant. */
export const MAX_SENSIBLE_DURATION_MS = 60_000;

/** Hauteur de texte minimale, en pourcentage de la hauteur de la dalle. */
export const MIN_BODY_TEXT_HEIGHT_PERCENT = 1.9;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/** Durée minimale pour qu'un texte donné soit lisible en passant. */
export function minReadableDurationMs(text: string): number {
  const words = countWords(text);
  return Math.round(GLANCE_TIME_MS + (words / READING_WORDS_PER_MINUTE) * 60_000);
}

/** Tout le texte porté par une diapositive, pour en déduire la durée minimale. */
export function slideText(slide: Slide): string {
  if (slide.kind !== "template") return "";
  return Object.values(slide.fields)
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export interface DurationVerdict {
  /** Durée réellement appliquée à l'écran. */
  effectiveMs: number;
  /** Durée demandée dans le manifeste. */
  requestedMs: number;
  /** Vrai si on a dû allonger : remonté à la console pour information. */
  extended: boolean;
}

/**
 * Durée retenue pour une diapositive.
 * On allonge sans rien demander à personne — mieux vaut un écran lisible
 * qu'un écran fidèle à un réglage impossible à tenir.
 */
export function effectiveDuration(slide: Slide): DurationVerdict {
  const requestedMs = "durationMs" in slide && slide.durationMs ? slide.durationMs : 0;
  const minimumMs = minReadableDurationMs(slideText(slide));
  const effectiveMs = Math.min(Math.max(requestedMs, minimumMs), MAX_SENSIBLE_DURATION_MS);
  return { effectiveMs, requestedMs, extended: effectiveMs > requestedMs };
}

export interface TypeScale {
  eyebrow: number;
  title: number;
  body: number;
  caption: number;
}

/**
 * Échelle typographique dérivée de la hauteur de la dalle.
 *
 * Les tailles sont calculées, jamais fixées en pixels : la même mise en page
 * doit tenir en 1080p sur un écran de couloir et en 4K sur un totem, sans
 * qu'on ait à la refaire.
 */
export function typeScale(screenHeightPx: number): TypeScale {
  const body = Math.round((screenHeightPx * MIN_BODY_TEXT_HEIGHT_PERCENT) / 100);
  return {
    eyebrow: Math.round(body * 0.72),
    title: Math.round(body * 2.4),
    body,
    caption: Math.round(body * 0.8),
  };
}
