import { z } from "zod";
import { IsoDateTime } from "./common.js";

/**
 * Le canal de commandes.
 *
 * Interrogation longue sur HTTP plutôt que MQTT : l'écran demande ses
 * commandes et le serveur retient la réponse jusqu'à ce qu'il en ait une, ou
 * que le délai expire.
 *
 * Ce choix vaut mieux qu'un broker dans un établissement scolaire — même
 * port, même certificat, même signature Ed25519 que le reste, et ça traverse
 * les mandataires et pare-feu sans rien demander à personne. Un socket en
 * attente par écran ne coûte rien : Node en tient des milliers.
 *
 * Effet de bord heureux : `sync-now` poussé à la publication ramène le délai
 * d'un message d'urgence de la minute à quelques secondes.
 */

/** Ce que la console peut demander à un écran. */
export const CommandKind = z.enum([
  /** Va chercher ton manifeste maintenant, sans attendre le prochain cycle. */
  "sync-now",
  /** Affiche ton code en grand, qu'on te retrouve dans le couloir. */
  "identify",
  /** Renvoie une capture de ce que tu affiches réellement. */
  "screenshot",
  /** Allume ou éteint la dalle. */
  "display-power",
  /** Vide le cache média et re-télécharge. */
  "clear-cache",
  /** Relance l'application, sans redémarrer la machine. */
  "restart-app",
  /** Redémarre la machine. */
  "reboot",
]);
export type CommandKind = z.infer<typeof CommandKind>;

export const DeviceCommand = z.object({
  /** Généré par le serveur. Rend l'acquittement idempotent. */
  id: z.string().uuid(),
  kind: CommandKind,
  issuedAt: IsoDateTime,
  /** Paramètres propres à la commande. */
  params: z.record(z.unknown()).default({}),
});
export type DeviceCommand = z.infer<typeof DeviceCommand>;

export const CommandBatch = z.object({
  commands: z.array(DeviceCommand),
});
export type CommandBatch = z.infer<typeof CommandBatch>;

/**
 * Le compte rendu d'une commande.
 *
 * `unsupported` est un résultat à part entière, pas une erreur : une
 * plateforme qui ne sait pas capturer son écran doit le dire clairement,
 * pour que la console grise le bouton au lieu de laisser croire à une panne.
 */
export const CommandOutcome = z.enum(["done", "unsupported", "failed"]);
export type CommandOutcome = z.infer<typeof CommandOutcome>;

export const CommandResult = z.object({
  commandId: z.string().uuid(),
  outcome: CommandOutcome,
  /** Message lisible, affiché tel quel dans la console. */
  message: z.string().optional(),
  /** Charge utile éventuelle — une capture, en base64. */
  payload: z.string().optional(),
  completedAt: IsoDateTime,
});
export type CommandResult = z.infer<typeof CommandResult>;

/**
 * Durée pendant laquelle le serveur retient la réponse.
 *
 * Vingt-cinq secondes : sous la minute des mandataires et pare-feu qui
 * coupent les connexions inactives, et assez long pour que le va-et-vient
 * reste négligeable.
 */
export const COMMAND_WAIT_SEC = 25;

/** Libellé de la commande, tel qu'il apparaît dans la console. */
export function commandLabel(kind: CommandKind): string {
  switch (kind) {
    case "sync-now":
      return "Synchroniser";
    case "identify":
      return "Identifier";
    case "screenshot":
      return "Capturer l'écran";
    case "display-power":
      return "Allumer ou éteindre la dalle";
    case "clear-cache":
      return "Vider le cache";
    case "restart-app":
      return "Relancer l'application";
    case "reboot":
      return "Redémarrer le boîtier";
  }
}

/**
 * Quelle capacité de l'appareil chaque commande exige.
 *
 * La console s'en sert pour griser un bouton AVANT de l'envoyer, plutôt que
 * de laisser l'utilisateur découvrir l'impossibilité après coup.
 */
export const COMMAND_REQUIREMENTS: Record<CommandKind, string | null> = {
  "sync-now": null,
  identify: null,
  screenshot: "screenshot",
  "display-power": "displayPower",
  "clear-cache": null,
  "restart-app": "remoteUpdate",
  reboot: "remoteReboot",
};
