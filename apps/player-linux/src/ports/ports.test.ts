import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileQueue } from "./queue.js";
import { FileStore } from "./store.js";

/**
 * Les portes disque.
 *
 * Ce sont elles qui portent les promesses les plus concrètes du projet :
 * ne jamais afficher un fichier corrompu, ne jamais perdre une preuve de
 * diffusion. Elles se testent avec de vrais fichiers, pas des bouchons.
 */

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "couloir-ports-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

describe("cache média", () => {
  it("ne publie un fichier qu'après vérification de son empreinte", async () => {
    const store = new FileStore(join(directory, "cache"));
    await store.open();

    const data = Buffer.from("une affiche");
    await writeFile(store.partPathFor("affiche"), data);
    await store.commit("affiche", sha(data));

    expect(await store.has("affiche", sha(data))).toBe(true);
    expect(await readFile(store.pathFor("affiche"))).toEqual(data);
  });

  it("refuse et supprime un téléchargement corrompu", async () => {
    // C'est la garantie qu'un fichier tronqué par une coupure n'atteint
    // jamais l'écran.
    const store = new FileStore(join(directory, "cache"));
    await store.open();

    await writeFile(store.partPathFor("affiche"), Buffer.from("tronqué"));
    await expect(store.commit("affiche", sha(Buffer.from("complet")))).rejects.toThrow(/empreinte/);

    expect(await store.has("affiche", sha(Buffer.from("complet")))).toBe(false);
    // Le `.part` corrompu est jeté : on repart proprement de zéro.
    expect(await store.partialBytes("affiche")).toBe(0);
  });

  it("signale les octets déjà reçus pour reprendre un téléchargement", async () => {
    const store = new FileStore(join(directory, "cache"));
    await store.open();

    expect(await store.partialBytes("video")).toBe(0);
    await writeFile(store.partPathFor("video"), Buffer.alloc(4096));
    expect(await store.partialBytes("video")).toBe(4096);
  });

  it("évince les plus anciens sans jamais toucher au requis", async () => {
    let now = 1_000;
    const store = new FileStore(join(directory, "cache"), () => now);
    await store.open();

    for (const id of ["vieux", "moyen", "requis"]) {
      const data = Buffer.alloc(1000, id.length);
      await writeFile(store.partPathFor(id), data);
      await store.commit(id, sha(data));
      now += 1000;
    }
    expect(await store.usedBytes()).toBe(3000);

    // Budget 2500 : évincer le plus ancien suffit à repasser dessous.
    const evicted = await store.evictTo(2500, ["requis"]);

    expect(evicted).toEqual(["vieux"]);
    expect(await store.usedBytes()).toBe(2000);
    expect(await store.has("requis", sha(Buffer.alloc(1000, 6)))).toBe(true);

    // Budget plus serré : on descend jusqu'au requis, sans jamais y toucher.
    expect(await store.evictTo(1000, ["requis"])).toEqual(["moyen"]);
    expect(await store.has("requis", sha(Buffer.alloc(1000, 6)))).toBe(true);
  });

  it("se rattrape si un fichier a disparu derrière son dos", async () => {
    const store = new FileStore(join(directory, "cache"));
    await store.open();

    const data = Buffer.from("affiche");
    await writeFile(store.partPathFor("affiche"), data);
    await store.commit("affiche", sha(data));

    await rm(store.pathFor("affiche"));
    expect(await store.has("affiche", sha(data))).toBe(false);
  });

  it("retrouve son cache après un redémarrage", async () => {
    const path = join(directory, "cache");
    const first = new FileStore(path);
    await first.open();
    const data = Buffer.from("affiche");
    await writeFile(first.partPathFor("affiche"), data);
    await first.commit("affiche", sha(data));

    const second = new FileStore(path);
    await second.open();
    expect(await second.has("affiche", sha(data))).toBe(true);
  });
});

describe("file de télémétrie", () => {
  const log = (message: string) => ({
    eventId: randomUUID(),
    at: "2026-09-15T10:00:00Z",
    level: "info" as const,
    code: "test",
    message,
  });

  it("ne purge que ce que le serveur a acquitté", async () => {
    // La règle qui garantit qu'une coupure ne fait perdre aucune preuve.
    const queue = new FileQueue(join(directory, "t.jsonl"));
    await queue.open();

    const [a, b, c] = [log("a"), log("b"), log("c")];
    await queue.append({ heartbeats: [], playEvents: [], logs: [a, b, c] });
    expect(await queue.pendingCount()).toBe(3);

    await queue.acknowledge([a.eventId, b.eventId]);
    expect(await queue.pendingCount()).toBe(1);
    expect((await queue.peek(10)).logs[0]?.message).toBe("c");
  });

  it("ne perd rien quand l'envoi échoue", async () => {
    const queue = new FileQueue(join(directory, "t.jsonl"));
    await queue.open();
    await queue.append({ heartbeats: [], playEvents: [], logs: [log("a")] });

    // Un échec réseau n'acquitte rien du tout.
    await queue.acknowledge([]);
    expect(await queue.pendingCount()).toBe(1);
  });

  it("survit au redémarrage", async () => {
    const path = join(directory, "t.jsonl");
    const first = new FileQueue(path);
    await first.open();
    await first.append({ heartbeats: [], playEvents: [], logs: [log("avant coupure")] });

    const second = new FileQueue(path);
    await second.open();
    expect((await second.peek(10)).logs[0]?.message).toBe("avant coupure");
  });

  it("ignore une ligne tronquée par une coupure de courant", async () => {
    const path = join(directory, "t.jsonl");
    const queue = new FileQueue(path);
    await queue.open();
    await queue.append({ heartbeats: [], playEvents: [], logs: [log("intacte")] });

    // Une écriture interrompue en plein milieu.
    await writeFile(path, (await readFile(path, "utf8")) + '{"kind":"log","event":{"eve');

    const reopened = new FileQueue(path);
    await reopened.open();
    expect(await reopened.pendingCount()).toBe(1);
    expect((await reopened.peek(10)).logs[0]?.message).toBe("intacte");
  });

  it("reste bornée, en sacrifiant les battements de cœur avant les preuves", async () => {
    // Un écran isolé un mois ne doit pas remplir sa carte — mais ce qu'on
    // jette en premier, c'est ce qui vaut le moins cher.
    const queue = new FileQueue(join(directory, "t.jsonl"), { maxEvents: 4 });
    await queue.open();

    const play = {
      eventId: randomUUID(),
      slideId: "affiche",
      zoneId: "principal",
      manifestVersion: 1,
      startedAt: "2026-09-15T10:00:00Z",
      endedAt: "2026-09-15T10:00:09Z",
      reason: "completed" as const,
      offline: true,
    };
    const heartbeat = (n: number) => ({
      eventId: randomUUID(),
      at: `2026-09-15T10:0${n}:00Z`,
      state: "active" as const,
      manifestVersion: 1,
      wasOffline: true,
      metrics: {
        uptimeSec: 1,
        freeDiskBytes: 1,
        freeMemoryBytes: 1,
        cacheBytes: 1,
        displayOn: true,
      },
    });

    await queue.append({ heartbeats: [heartbeat(1), heartbeat(2), heartbeat(3)], playEvents: [play], logs: [] });
    await queue.append({ heartbeats: [heartbeat(4), heartbeat(5)], playEvents: [], logs: [] });

    expect(await queue.pendingCount()).toBe(4);
    // La preuve de diffusion a survécu.
    expect((await queue.peek(10)).playEvents).toHaveLength(1);
  });

  it("purge les événements trop vieux", async () => {
    const queue = new FileQueue(join(directory, "t.jsonl"));
    await queue.open();
    await queue.append({ heartbeats: [], playEvents: [], logs: [log("vieux")] });

    expect(await queue.prune("2026-09-16T00:00:00Z")).toBe(1);
    expect(await queue.pendingCount()).toBe(0);
  });
});
