/**
 * Les routes HTTP, définies une fois et importées des deux côtés.
 *
 * Le serveur les enregistre, l'agent les appelle. Une faute de frappe dans
 * un chemin devient une erreur de compilation plutôt qu'un 404 découvert
 * sur un écran posé à quatre mètres de haut.
 */
export const API_PREFIX = "/v1" as const;

export const ROUTES = {
  /** L'appareil se déclare et reçoit son code d'appairage. */
  enrollStart: `${API_PREFIX}/enroll/start`,
  /** L'appareil attend d'être rattaché à un écran. */
  enrollStatus: `${API_PREFIX}/enroll/status`,
  /** La console rattache l'appareil à un écran. */
  enrollClaim: `${API_PREFIX}/enroll/claim`,
  /** Le manifeste de l'écran courant. Répond 304 s'il n'a pas changé. */
  manifest: `${API_PREFIX}/devices/me/manifest`,
  /** Remontée des lots de télémétrie et de preuves de diffusion. */
  telemetry: `${API_PREFIX}/devices/me/telemetry`,
  /** Téléchargement d'un média, avec support des requêtes Range. */
  asset: `${API_PREFIX}/assets/:assetId`,
  health: "/health",
} as const;

/** En-têtes propres au protocole. */
export const HEADERS = {
  deviceId: "x-couloir-device",
  /** Signature Ed25519 de la requête, en base64url. */
  signature: "x-couloir-signature",
  /** Millisecondes epoch, bornées par la tolérance d'horloge. */
  timestamp: "x-couloir-timestamp",
  agentVersion: "x-couloir-agent",
} as const;

/**
 * Routes exigeant une signature d'appareil.
 *
 * L'enrôlement en est exclu : l'appareil n'a pas encore d'identité reconnue
 * au moment où il se déclare. C'est précisément le rôle du code d'appairage,
 * saisi par un humain, de faire ce premier pont de confiance.
 */
export const SIGNED_ROUTES: readonly string[] = [
  `${API_PREFIX}/devices/me/manifest`,
  `${API_PREFIX}/devices/me/telemetry`,
];

export function requiresSignature(pathname: string): boolean {
  return SIGNED_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}?`));
}

/** Sujets MQTT pour le canal temps réel. Le poll reste le filet de sécurité. */
export const MQTT_TOPICS = {
  /** Commandes descendantes : rafraîchir, redémarrer, identifier, urgence. */
  commands: (screenId: string) => `couloir/screens/${screenId}/cmd`,
  /** Présence, avec message de dernière volonté pour détecter les chutes. */
  presence: (screenId: string) => `couloir/screens/${screenId}/presence`,
} as const;

export type DeviceCommand =
  | { type: "sync-now" }
  | { type: "identify"; durationSec: number }
  | { type: "reboot" }
  | { type: "restart-app" }
  | { type: "clear-cache" }
  | { type: "screenshot" }
  | { type: "display-power"; on: boolean };
