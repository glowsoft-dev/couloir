import { randomUUID } from "node:crypto";
import {
  COMMAND_WAIT_SEC,
  type CommandKind,
  type CommandResult,
  type DeviceCommand,
} from "@couloir/protocol";

/**
 * Le bus de commandes.
 *
 * Chaque écran tient une connexion ouverte vers `/v1/devices/me/commands`.
 * Le serveur la retient jusqu'à ce qu'il ait quelque chose à dire, ou que le
 * délai expire. Émettre une commande revient à réveiller cette attente.
 *
 * Tout est en mémoire, et c'est délibéré : une commande est éphémère. Faire
 * clignoter un écran qui vient de redémarrer n'a aucun sens, et un
 * redémarrage de serveur doit les oublier plutôt que de les rejouer plus
 * tard sans que personne ne comprenne pourquoi.
 */

interface Waiter {
  resolve: (commands: DeviceCommand[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Au-delà, un compte rendu n'intéresse plus personne. */
const RESULT_TTL_MS = 10 * 60_000;

export interface PendingCommand extends DeviceCommand {
  screenId: string;
}

export class CommandBus {
  private readonly queues = new Map<string, DeviceCommand[]>();
  private readonly waiters = new Map<string, Waiter[]>();
  private readonly results = new Map<string, CommandResult & { screenId: string; atMs: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Émet une commande vers un écran.
   *
   * Si l'écran attend, elle part immédiatement. Sinon elle patiente dans sa
   * file jusqu'à sa prochaine interrogation — au plus quelques secondes.
   */
  issue(screenId: string, kind: CommandKind, params: Record<string, unknown> = {}): DeviceCommand {
    const command: DeviceCommand = {
      id: randomUUID(),
      kind,
      issuedAt: new Date(this.now()).toISOString().replace(/\.\d+Z$/, "Z"),
      params,
    };

    const waiting = this.waiters.get(screenId);
    if (waiting && waiting.length > 0) {
      for (const waiter of waiting) {
        clearTimeout(waiter.timer);
        waiter.resolve([command]);
      }
      this.waiters.delete(screenId);
      return command;
    }

    const queue = this.queues.get(screenId) ?? [];
    queue.push(command);
    this.queues.set(screenId, queue);
    return command;
  }

  /** Émet la même commande vers plusieurs écrans d'un coup. */
  broadcast(screenIds: readonly string[], kind: CommandKind, params: Record<string, unknown> = {}): number {
    for (const screenId of screenIds) this.issue(screenId, kind, params);
    return screenIds.length;
  }

  /**
   * Attend une commande pour cet écran.
   *
   * Rend immédiatement si la file n'est pas vide. Sinon retient la réponse,
   * puis rend une liste vide à l'expiration — un tableau vide plutôt qu'une
   * erreur, pour que l'agent reboucle sans rien interpréter.
   */
  wait(screenId: string, waitSec = COMMAND_WAIT_SEC): Promise<DeviceCommand[]> {
    const queued = this.queues.get(screenId);
    if (queued && queued.length > 0) {
      this.queues.delete(screenId);
      return Promise.resolve(queued);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.drop(screenId, waiter);
        resolve([]);
      }, waitSec * 1000);
      // Ne pas retenir le processus en vie pour une attente vide.
      timer.unref?.();

      const waiter: Waiter = { resolve, timer };
      const list = this.waiters.get(screenId) ?? [];
      list.push(waiter);
      this.waiters.set(screenId, list);
    });
  }

  private drop(screenId: string, waiter: Waiter): void {
    const list = this.waiters.get(screenId);
    if (!list) return;
    const next = list.filter((entry) => entry !== waiter);
    if (next.length === 0) this.waiters.delete(screenId);
    else this.waiters.set(screenId, next);
  }

  /** Un écran attend-il en ce moment ? Sert à dire s'il est réellement joignable. */
  isListening(screenId: string): boolean {
    return (this.waiters.get(screenId)?.length ?? 0) > 0;
  }

  recordResult(screenId: string, result: CommandResult): void {
    this.evictOldResults();
    this.results.set(result.commandId, { ...result, screenId, atMs: this.now() });
  }

  result(commandId: string): (CommandResult & { screenId: string }) | null {
    this.evictOldResults();
    return this.results.get(commandId) ?? null;
  }

  private evictOldResults(): void {
    const cutoff = this.now() - RESULT_TTL_MS;
    for (const [id, entry] of this.results) {
      if (entry.atMs < cutoff) this.results.delete(id);
      else break;
    }
  }

  /** Libère les attentes en cours. Appelé à l'extinction du serveur. */
  close(): void {
    for (const [, list] of this.waiters) {
      for (const waiter of list) {
        clearTimeout(waiter.timer);
        waiter.resolve([]);
      }
    }
    this.waiters.clear();
    this.queues.clear();
  }
}
