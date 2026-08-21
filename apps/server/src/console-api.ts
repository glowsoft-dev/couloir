import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { API_PREFIX } from "@couloir/protocol";
import { CompositionError, type PublishSpec, compose } from "./composer.js";
import type { MediaStore } from "./media.js";
import type { Store } from "./store.js";

/**
 * L'API de la console.
 *
 * Séparée de celle des écrans, et pour une bonne raison : les deux n'ont ni
 * les mêmes clients, ni la même authentification, ni la même surface. Un
 * player ne doit pas pouvoir publier, une console ne doit pas pouvoir
 * remonter de la télémétrie.
 *
 * L'authentification est ici un simple jeton partagé, passé en `Bearer`.
 * C'est volontairement minimal et c'est une dette assumée : les comptes
 * nominatifs, les rôles et le journal d'audit promis au cahier des charges
 * viendront, mais une console sans aucune protection serait pire que des
 * `curl`.
 */

export const CONSOLE_PREFIX = `${API_PREFIX}/console` as const;

const PublishBody = z.object({
  layout: z.enum(["plein-ecran", "principal-et-cours"]),
  items: z
    .array(
      z.object({
        assetId: z.string().optional(),
        text: z
          .object({
            eyebrow: z.string().optional(),
            titre: z.string().min(1),
            texte: z.string().optional(),
          })
          .optional(),
        durationMs: z.number().int().positive().max(60_000).optional(),
      }),
    )
    .min(1),
  ticker: z.string().max(500).optional(),
  timetableUrl: z.string().url().optional(),
});

const PairBody = z.object({
  pairingCode: z.string().length(6),
  code: z.string().min(1),
  label: z.string().min(1),
  building: z.string().min(1),
  floor: z.number().int(),
  area: z.string().min(1),
  orientation: z.enum(["landscape", "portrait"]).default("landscape"),
});

export interface ConsoleApiOptions {
  store: Store;
  media: MediaStore;
  /** Absent = console fermée. On ne l'ouvre jamais par défaut. */
  adminToken?: string;
  /** Connecteur d'emploi du temps proposé par défaut à la publication. */
  timetableUrl?: string;
}

export function registerConsoleApi(app: FastifyInstance, options: ConsoleApiOptions): void {
  const { store, media } = options;

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith(CONSOLE_PREFIX)) return;

    if (!options.adminToken) {
      return reply.code(503).send({
        code: "console-disabled",
        message: "La console n'est pas activée sur ce serveur.",
        retryable: false,
      });
    }

    const header = request.headers.authorization;
    if (header !== `Bearer ${options.adminToken}`) {
      return reply.code(401).send({
        code: "unauthorized",
        message: "Jeton d'accès invalide.",
        retryable: false,
      });
    }
  });

  // --- Le parc ---------------------------------------------------------

  app.get(`${CONSOLE_PREFIX}/screens`, async () => ({
    screens: await store.listScreenStatuses(),
    // Les boîtiers en attente : c'est ce qui permet de rattacher un écran
    // sans avoir à recopier son code à la main.
    pending: await store.listPendingDevices(),
  }));

  app.get<{ Params: { screenId: string } }>(
    `${CONSOLE_PREFIX}/screens/:screenId`,
    async (request, reply) => {
      const statuses = await store.listScreenStatuses();
      const screen = statuses.find((s) => s.id === request.params.screenId);
      if (!screen) {
        return reply.code(404).send({ code: "unknown-screen", message: "Écran inconnu.", retryable: false });
      }
      return { screen, manifest: await store.getManifest(screen.id) };
    },
  );

  // --- Rattachement ----------------------------------------------------

  app.post(`${CONSOLE_PREFIX}/pair`, async (request, reply) => {
    const parsed = PairBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: "Informations d'écran incomplètes.",
        retryable: false,
        details: parsed.error.flatten(),
      });
    }

    const { pairingCode, ...screen } = parsed.data;
    const device = await store.findByPairingCode(pairingCode);
    if (!device) {
      return reply.code(404).send({
        code: "unknown-pairing-code",
        message: "Ce code ne correspond à aucun écran en attente. Vérifiez ce qui est affiché.",
        retryable: false,
      });
    }

    try {
      const claimed = await store.claimNew(device.deviceId, screen);
      return { screenId: claimed.screen.id, screenCode: claimed.screen.code };
    } catch (error) {
      // Le cas courant : deux écrans avec la même étiquette.
      return reply.code(409).send({
        code: "screen-conflict",
        message: `Impossible de créer cet écran — le code « ${screen.code} » est peut-être déjà utilisé.`,
        retryable: false,
        details: { error: String(error) },
      });
    }
  });

  // --- Bibliothèque ----------------------------------------------------

  app.get(`${CONSOLE_PREFIX}/media`, async () => ({ media: media.list() }));

  app.post(`${CONSOLE_PREFIX}/media`, async (request, reply) => {
    const file = await request.file?.();
    if (!file) {
      return reply.code(400).send({ code: "no-file", message: "Aucun fichier reçu.", retryable: false });
    }

    const buffer = await file.toBuffer();
    if (buffer.byteLength === 0) {
      return reply.code(400).send({ code: "empty-file", message: "Le fichier est vide.", retryable: false });
    }

    const stored = await media.put(randomUUID(), buffer, file.mimetype, file.filename);
    return reply.code(201).send({ media: stored });
  });

  // --- Publication -----------------------------------------------------

  app.post<{ Params: { screenId: string } }>(
    `${CONSOLE_PREFIX}/screens/:screenId/publish`,
    async (request, reply) => {
      const parsed = PublishBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          code: "invalid-body",
          message: "La publication est incomplète.",
          retryable: false,
          details: parsed.error.flatten(),
        });
      }

      const screen = await store.getScreen(request.params.screenId);
      if (!screen) {
        return reply.code(404).send({ code: "unknown-screen", message: "Écran inconnu.", retryable: false });
      }

      const spec: PublishSpec = {
        ...parsed.data,
        timetableUrl: parsed.data.timetableUrl ?? options.timetableUrl,
      };

      try {
        const existing = await store.getManifest(screen.id);
        const manifest = compose({
          screenId: screen.id,
          version: (existing?.version ?? 0) + 1,
          issuedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
          spec,
          media: media.index(),
          baseUrl: publicUrl(request.headers.host),
        });

        await store.putManifest(manifest);
        request.log.info({ screenId: screen.id, version: manifest.version }, "publication");
        return { screenId: screen.id, version: manifest.version };
      } catch (error) {
        // Une erreur de composition est une erreur d'usage : on la rend
        // telle quelle, en français, pas sous forme de 500.
        if (error instanceof CompositionError) {
          return reply.code(400).send({ code: "composition", message: error.message, retryable: false });
        }
        throw error;
      }
    },
  );
}

/** L'adresse par laquelle le player joindra le serveur, telle qu'il la voit. */
function publicUrl(host: string | undefined): string {
  return `http://${host ?? "localhost:3000"}`;
}
