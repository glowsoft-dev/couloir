import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type AgentLog, type Heartbeat, type PlayEvent, type TelemetryBatch } from "@couloir/protocol";
import type { QueuePort } from "@couloir/agent";

/**
 * La file de télémétrie, persistée sur disque.
 *
 * C'est la pièce qui tient la promesse « une coupure de 48 h ne fait perdre
 * aucune preuve de diffusion ». Trois propriétés à respecter :
 *
 *   - elle survit au redémarrage, donc elle est sur disque, pas en mémoire ;
 *   - on n'efface qu'après acquittement explicite du serveur ;
 *   - elle est bornée, sinon un écran isolé un mois remplit sa carte.
 *
 * Format JSONL : une ligne par événement, ajout en fin de fichier. Une ligne
 * illisible — coupure de courant en pleine écriture — est ignorée au
 * chargement plutôt que de faire échouer toute la file.
 */

type QueuedEvent =
  | { kind: "heartbeat"; event: Heartbeat }
  | { kind: "play"; event: PlayEvent }
  | { kind: "log"; event: AgentLog };

export interface FileQueueOptions {
  /** Au-delà, on jette les plus anciens : mieux vaut une file bornée. */
  maxEvents?: number;
}

export class FileQueue implements QueuePort {
  private events: QueuedEvent[] = [];
  private readonly maxEvents: number;

  constructor(
    private readonly path: string,
    options: FileQueueOptions = {},
  ) {
    this.maxEvents = options.maxEvents ?? 50_000;
  }

  async open(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    let content: string;
    try {
      content = await readFile(this.path, "utf8");
    } catch {
      this.events = [];
      return;
    }

    this.events = [];
    for (const line of content.split("\n")) {
      if (line.trim() === "") continue;
      try {
        this.events.push(JSON.parse(line) as QueuedEvent);
      } catch {
        // Ligne tronquée par une coupure : on la laisse tomber et on continue.
      }
    }
  }

  async append(batch: TelemetryBatch): Promise<void> {
    const incoming: QueuedEvent[] = [
      ...batch.heartbeats.map((event) => ({ kind: "heartbeat" as const, event })),
      ...batch.playEvents.map((event) => ({ kind: "play" as const, event })),
      ...batch.logs.map((event) => ({ kind: "log" as const, event })),
    ];
    if (incoming.length === 0) return;

    this.events.push(...incoming);

    if (this.events.length > this.maxEvents) {
      // Les preuves de diffusion valent plus que les battements de cœur :
      // en cas de saturation, ce sont les seconds qui partent en premier.
      const overflow = this.events.length - this.maxEvents;
      const heartbeats: QueuedEvent[] = this.events.filter((e) => e.kind === "heartbeat");
      const toDrop = new Set(heartbeats.slice(0, overflow));
      this.events = this.events.filter((e) => !toDrop.has(e));
      if (this.events.length > this.maxEvents) {
        this.events = this.events.slice(this.events.length - this.maxEvents);
      }
      await this.rewrite();
      return;
    }

    await appendFile(this.path, incoming.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }

  async peek(maxEvents: number): Promise<TelemetryBatch> {
    const slice = this.events.slice(0, maxEvents);
    return {
      heartbeats: slice.filter((e) => e.kind === "heartbeat").map((e) => e.event as Heartbeat),
      playEvents: slice.filter((e) => e.kind === "play").map((e) => e.event as PlayEvent),
      logs: slice.filter((e) => e.kind === "log").map((e) => e.event as AgentLog),
    };
  }

  async acknowledge(eventIds: readonly string[]): Promise<void> {
    if (eventIds.length === 0) return;
    const accepted = new Set(eventIds);
    const before = this.events.length;
    this.events = this.events.filter((e) => !accepted.has(e.event.eventId));
    if (this.events.length !== before) await this.rewrite();
  }

  async pendingCount(): Promise<number> {
    return this.events.length;
  }

  async prune(olderThanIso: string): Promise<number> {
    const cutoff = Date.parse(olderThanIso);
    const before = this.events.length;
    this.events = this.events.filter((e) => timestampOf(e) >= cutoff);
    const removed = before - this.events.length;
    if (removed > 0) await this.rewrite();
    return removed;
  }

  /** Réécriture atomique : le fichier n'est jamais laissé à moitié écrit. */
  private async rewrite(): Promise<void> {
    const temporary = `${this.path}.tmp`;
    if (this.events.length === 0) {
      await rm(this.path, { force: true });
      await rm(temporary, { force: true });
      return;
    }
    await writeFile(temporary, this.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    await rename(temporary, this.path);
  }
}

function timestampOf(queued: QueuedEvent): number {
  return Date.parse(queued.kind === "play" ? queued.event.startedAt : queued.event.at);
}
