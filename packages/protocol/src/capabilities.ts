import { z } from "zod";
import { Orientation } from "./common.js";

/**
 * Ce qu'un appareil sait faire.
 *
 * Le player déclare ses capacités à l'enrôlement puis à chaque manifeste.
 * Deux usages, tous deux prévus au cahier des charges :
 *   - le serveur choisit le bon dérivé vidéo et n'envoie jamais un média
 *     que l'appareil ne saurait pas décoder ;
 *   - la console grise les actions impossibles et explique pourquoi,
 *     au lieu de les proposer puis d'échouer en silence.
 *
 * Principe : une capacité absente est déclarée absente, jamais simulée.
 */

export const Platform = z.enum(["linux", "android", "windows", "macos", "soc", "browser"]);
export type Platform = z.infer<typeof Platform>;

export const VideoCodec = z.enum(["h264", "hevc", "vp9", "av1"]);
export type VideoCodec = z.infer<typeof VideoCodec>;

/**
 * Les capacités système, une par ligne, sans valeur par défaut implicite.
 * Ajouter un champ ici oblige chaque coque à se positionner — c'est voulu.
 */
export const DeviceFeatures = z.object({
  /** Cache média sur un vrai disque, sans risque d'éviction par le système. */
  persistentCache: z.boolean(),
  /** Démarre seul à la mise sous tension, sans intervention humaine. */
  autoStart: z.boolean(),
  /** Verrouillé : ni clavier, ni navigation, ni accès au système. */
  kiosk: z.boolean(),
  /** Redémarrage complet de l'appareil pilotable à distance. */
  remoteReboot: z.boolean(),
  /** Mise à jour de l'application pilotable à distance. */
  remoteUpdate: z.boolean(),
  /** Extinction et allumage de la dalle (CEC, DPMS, API constructeur). */
  displayPower: z.boolean(),
  /** Capture de ce qui est réellement affiché, pour l'aperçu console. */
  screenshot: z.boolean(),
  /** Chien de garde matériel : redémarre si le système ne répond plus. */
  hardwareWatchdog: z.boolean(),
  /**
   * Horloge qui survit à une coupure de courant.
   * Faux sur un Raspberry Pi sans module RTC — et dans ce cas la
   * programmation horaire n'est pas fiable au redémarrage.
   */
  reliableClock: z.boolean(),
});
export type DeviceFeatures = z.infer<typeof DeviceFeatures>;

export const DisplayInfo = z.object({
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  orientation: Orientation,
});
export type DisplayInfo = z.infer<typeof DisplayInfo>;

export const Capabilities = z.object({
  platform: Platform,
  /** Version de la coque native, propre à la plateforme. */
  shellVersion: z.string(),
  /** Version du noyau de rendu, commune à toutes les plateformes. */
  rendererVersion: z.string(),
  agentVersion: z.string(),
  display: DisplayInfo,
  codecs: z.array(VideoCodec).min(1),
  /** Hauteur vidéo maximale décodable confortablement (1080, 2160…). */
  maxVideoHeight: z.number().int().positive(),
  /** Place que l'agent s'autorise à occuper pour le cache média. */
  storageBudgetBytes: z.number().int().nonnegative(),
  features: DeviceFeatures,
});
export type Capabilities = z.infer<typeof Capabilities>;

/**
 * Profils de référence, un par famille d'appareils.
 *
 * Ils servent de valeurs de départ pour une coque et de jeu d'essai pour
 * les tests : la logique de négociation doit se comporter correctement
 * sur les cinq, sans branche conditionnelle par plateforme.
 */
export const FEATURE_PROFILES = {
  linux: {
    persistentCache: true,
    autoStart: true,
    kiosk: true,
    remoteReboot: true,
    remoteUpdate: true,
    displayPower: true,
    screenshot: true,
    hardwareWatchdog: true,
    // Faux tant qu'un module RTC n'est pas installé — la coque Linux
    // détecte la présence du module au démarrage et corrige ce champ.
    reliableClock: false,
  },
  android: {
    persistentCache: true,
    autoStart: true,
    kiosk: true,
    remoteReboot: true,
    remoteUpdate: true,
    displayPower: true,
    screenshot: true,
    hardwareWatchdog: false,
    reliableClock: true,
  },
  windows: {
    persistentCache: true,
    autoStart: true,
    kiosk: true,
    remoteReboot: true,
    remoteUpdate: true,
    displayPower: true,
    screenshot: true,
    hardwareWatchdog: false,
    reliableClock: true,
  },
  macos: {
    persistentCache: true,
    autoStart: true,
    kiosk: true,
    remoteReboot: true,
    remoteUpdate: true,
    displayPower: true,
    screenshot: true,
    hardwareWatchdog: false,
    reliableClock: true,
  },
  soc: {
    persistentCache: true,
    autoStart: true,
    kiosk: true,
    remoteReboot: true,
    remoteUpdate: false,
    displayPower: true,
    screenshot: false,
    hardwareWatchdog: true,
    reliableClock: true,
  },
  // Mode dégradé assumé : pratique pour dépanner ou faire une démo,
  // pas pour un écran de couloir permanent.
  browser: {
    persistentCache: false,
    autoStart: false,
    kiosk: false,
    remoteReboot: false,
    remoteUpdate: true,
    displayPower: false,
    screenshot: false,
    hardwareWatchdog: false,
    reliableClock: true,
  },
} as const satisfies Record<Platform, DeviceFeatures>;

/** Capacités exigées d'un écran de couloir permanent. */
export const PERMANENT_SCREEN_REQUIREMENTS = [
  "persistentCache",
  "autoStart",
  "kiosk",
] as const satisfies readonly (keyof DeviceFeatures)[];

/**
 * Un appareil convient-il à une pose permanente ?
 * La console s'en sert pour signaler les écrans en mode dégradé.
 */
export function isSuitableForPermanentScreen(caps: Capabilities): boolean {
  return PERMANENT_SCREEN_REQUIREMENTS.every((feature) => caps.features[feature]);
}
