import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import {
  EnrollClaimRequest,
  EnrollStartRequest,
  HEADERS,
  type Manifest,
  ROUTES,
  TelemetryBatch,
  demoManifest,
  SIGNATURE_MAX_SKEW_MS,
  explainRejection,
  requiresSignature,
} from "@couloir/protocol";
import { ReplayGuard, verifyRequest } from "./auth.js";
import { registerConsoleApi } from "./console-api.js";
import { MediaStore, parseRange } from "./media.js";
import { MemoryStore, type Store, isPairingExpired } from "./store.js";

/**
 * L'API du serveur.
 *
 * Trois chemins seulement pour l'instant, mais ce sont les trois qui portent
 * le socle : enrôler un écran, lui donner son manifeste, recevoir ce qu'il
 * remonte. Le reste — console, médias, connecteurs — viendra dessus.
 */

export interface AppOptions {
  store?: Store;
  media?: MediaStore;
  logger?: boolean;
  /** Jeton d'accès à la console. Absent = console fermée. */
  consoleToken?: string;
  /** Connecteur d'emploi du temps proposé par défaut à la publication. */
  timetableUrl?: string;
  /** Adresse par laquelle les écrans joignent le serveur. Voir console-api. */
  publicUrl?: string;
  /**
   * Coupe la vérification des signatures.
   * Réservé aux tests qui portent sur autre chose : en production, une
   * requête d'appareil non signée n'a aucune raison d'exister.
   */
  trustUnsignedDevices?: boolean;
  /** Ouvre les routes de publication de développement. */
  devRoutes?: boolean;
}

/** ETag calculé sur le contenu : deux manifestes identiques donnent le même. */
function etagOf(manifest: Manifest): string {
  const hash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  return `"${hash.slice(0, 32)}"`;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const store: Store = options.store ?? new MemoryStore();
  const media_ = options.media ?? new MediaStore("./data/media");
  const app = Fastify({ logger: options.logger ?? false });

  app.decorate("store", store);
  app.decorate("media", media_);

  // Import de médias depuis la console. 512 Mo : une vidéo d'établissement
  // tient largement dedans, et au-delà c'est une erreur de manipulation.
  void app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024, files: 1 } });

  // --- Signature des requêtes d'appareil --------------------------------

  const replayGuard = new ReplayGuard(SIGNATURE_MAX_SKEW_MS);

  // Le corps brut est conservé : c'est son empreinte qui est signée, et
  // `JSON.stringify` d'un objet reparsé ne redonne pas les mêmes octets.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body: Buffer, done) => {
      (request as { rawBody?: Buffer }).rawBody = body;
      if (body.length === 0) return done(null, undefined);
      try {
        done(null, JSON.parse(body.toString("utf8")));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.addHook("preHandler", async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? request.url;
    if (!requiresSignature(pathname)) return;
    if (options.trustUnsignedDevices) return;

    const result = await verifyRequest(
      {
        method: request.method,
        url: request.url,
        headers: request.headers as Record<string, string | string[] | undefined>,
        rawBody: (request as { rawBody?: Buffer }).rawBody,
      },
      store,
      replayGuard,
    );

    if (!result.ok) {
      request.log.warn({ url: request.url, reason: result.reason }, "requête d'appareil rejetée");
      return reply.code(401).send({
        code: result.reason,
        message: explainRejection(result.reason),
        // Un décalage d'horloge se corrige tout seul : l'agent doit réessayer.
        retryable: result.reason === "clock-skew",
      });
    }

    (request as { deviceId?: string; screenId?: string }).deviceId = result.deviceId;
    (request as { deviceId?: string; screenId?: string }).screenId = result.screenId;
  });

  app.get(ROUTES.health, async () => ({ status: "ok", screens: (await store.listScreens()).length }));

  // --- Enrôlement -----------------------------------------------------

  app.post(ROUTES.enrollStart, async (request, reply) => {
    const parsed = EnrollStartRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: "Requête d'enrôlement invalide.",
        retryable: false,
        details: parsed.error.flatten(),
      });
    }

    const device = await store.startEnrollment(
      parsed.data.publicKey,
      parsed.data.capabilities,
      parsed.data.hardwareId,
    );
    return reply.code(201).send({
      deviceId: device.deviceId,
      pairingCode: device.pairingCode,
      expiresAt: new Date(device.pairingExpiresAtMs).toISOString().replace(/\.\d+Z$/, "Z"),
      pollIntervalSec: 5,
    });
  });

  /** L'appareil interroge jusqu'à ce que quelqu'un l'ait rattaché. */
  app.get(ROUTES.enrollStatus, async (request, reply) => {
    const deviceId = (request.query as { deviceId?: string }).deviceId;
    if (!deviceId) {
      return reply.code(400).send({ code: "missing-device", message: "deviceId requis.", retryable: false });
    }

    const device = await store.getDevice(deviceId);
    if (!device) {
      return reply.code(404).send({ code: "unknown-device", message: "Appareil inconnu.", retryable: false });
    }
    if (isPairingExpired(device, Date.now())) {
      return reply.send({ state: "expired" });
    }
    if (!device.screenId) {
      return reply.send({ state: "pending" });
    }

    const screen = await store.getScreen(device.screenId);
    // Le jeton n'est délivré qu'une fois, au rattachement : on ne le
    // conserve que sous forme d'empreinte et on ne peut pas le rejouer.
    return reply.send({ state: "claimed", screenId: device.screenId, screenCode: screen?.code });
  });

  /** Appelé depuis la console, code d'appairage en main. */
  app.post(ROUTES.enrollClaim, async (request, reply) => {
    const parsed = EnrollClaimRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: "Requête de rattachement invalide.",
        retryable: false,
        details: parsed.error.flatten(),
      });
    }
    const { pairingCode, existingScreenId, newScreen } = parsed.data;

    const device = await store.findByPairingCode(pairingCode);
    if (!device) {
      return reply.code(404).send({
        code: "unknown-pairing-code",
        message: "Ce code ne correspond à aucun écran en attente. Vérifiez ce qui est affiché.",
        retryable: false,
      });
    }
    if (isPairingExpired(device, Date.now())) {
      return reply.code(410).send({
        code: "pairing-code-expired",
        message: "Ce code a expiré. Redémarrez l'écran pour en obtenir un nouveau.",
        retryable: false,
      });
    }

    // Remplacement d'un boîtier : l'écran existe, on le reprend tel quel.
    if (existingScreenId) {
      const claimed = await store.claimExisting(device.deviceId, existingScreenId);
      if (!claimed) {
        return reply.code(404).send({
          code: "unknown-screen",
          message: "Cet écran n'existe pas.",
          retryable: false,
        });
      }
      return reply.send({
        state: "claimed",
        screenId: claimed.screen.id,
        screenCode: claimed.screen.code,
        deviceToken: claimed.deviceToken,
      });
    }

    if (!newScreen) {
      return reply.code(400).send({
        code: "missing-screen",
        message: "Indiquez un écran existant à reprendre, ou les informations d'un nouvel écran.",
        retryable: false,
      });
    }

    const claimed = await store.claimNew(device.deviceId, {
      code: newScreen.code,
      label: newScreen.label,
      building: newScreen.building,
      floor: newScreen.floor,
      area: newScreen.area,
      orientation: newScreen.orientation,
    });
    return reply.send({
      state: "claimed",
      screenId: claimed.screen.id,
      screenCode: claimed.screen.code,
      deviceToken: claimed.deviceToken,
    });
  });

  // --- Manifeste ------------------------------------------------------

  app.get(ROUTES.manifest, async (request, reply) => {
    const deviceId = request.headers[HEADERS.deviceId];
    if (typeof deviceId !== "string") {
      return reply.code(401).send({ code: "unauthenticated", message: "Appareil non identifié.", retryable: false });
    }

    const device = await store.getDevice(deviceId);
    if (!device?.screenId) {
      return reply.code(403).send({
        code: "not-claimed",
        message: "Cet appareil n'est rattaché à aucun écran.",
        retryable: true,
      });
    }

    const manifest = await store.getManifest(device.screenId);
    if (!manifest) {
      return reply.code(404).send({
        code: "no-manifest",
        message: "Aucun contenu n'a encore été publié sur cet écran.",
        retryable: true,
      });
    }

    const etag = etagOf(manifest);
    reply.header("ETag", etag);
    reply.header("Cache-Control", "no-cache");

    // 304 : quelques centaines d'octets pour un écran déjà à jour.
    if (request.headers["if-none-match"] === etag) {
      return reply.code(304).send();
    }
    return reply.send(manifest);
  });

  // --- Médias ---------------------------------------------------------

  app.get<{ Params: { assetId: string } }>(ROUTES.asset, async (request, reply) => {
    const media = media_.get(request.params.assetId);
    if (!media) {
      return reply.code(404).send({ code: "unknown-asset", message: "Média inconnu.", retryable: false });
    }

    reply.header("Content-Type", media.mime);
    reply.header("ETag", `"${media.sha256}"`);
    // Sans ça, un téléchargement coupé à 90 % repart de zéro à la reconnexion.
    reply.header("Accept-Ranges", "bytes");

    const range = parseRange(request.headers.range, media.bytes);
    if (range === "invalid") {
      reply.header("Content-Range", `bytes */${media.bytes}`);
      return reply.code(416).send();
    }
    if (range === null) {
      reply.header("Content-Length", String(media.bytes));
      return reply.send(media_.stream(media, null));
    }

    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${media.bytes}`);
    reply.header("Content-Length", String(range.end - range.start + 1));
    return reply.code(206).send(media_.stream(media, range));
  });

  // --- Publication (développement) -------------------------------------
  // En attendant la console. Réservé au mode développement : c'est la
  // console qui publiera, avec ses rôles et son journal d'audit.

  if (options.devRoutes) {
    app.post<{ Body: { screenId?: string; version?: number } }>("/dev/publish-demo", async (request, reply) => {
      const screenId = request.body?.screenId;
      if (!screenId || !(await store.getScreen(screenId))) {
        return reply.code(404).send({ code: "unknown-screen", message: "Écran inconnu.", retryable: false });
      }

      const existing = await store.getManifest(screenId);
      const version = request.body?.version ?? (existing ? existing.version + 1 : 1);
      const manifest = demoManifest(screenId, version);
      const poster = media_.get("affiche-po-2026");

      await store.putManifest({
        ...manifest,
        assets: manifest.assets.map((asset) => ({
          ...asset,
          ...(poster ? { sha256: poster.sha256, bytes: poster.bytes, mime: poster.mime } : {}),
          url: new URL(`/v1/assets/${asset.id}`, options.publicUrl ?? publicUrl(request)).toString(),
        })),
        dataSources: manifest.dataSources.map((source) => ({
          ...source,
          url: new URL(new URL(source.url).pathname, options.publicUrl ?? publicUrl(request)).toString(),
        })),
      });
      return reply.send({ screenId, version });
    });
  }

  // --- Connecteurs ----------------------------------------------------
  // Bouchons pour le développement. Les vrais connecteurs — ICS pour
  // l'emploi du temps, REST pour le site de l'école — viendront ici.

  app.get("/connectors/timetable", async () => [
    { time: "08:00", subject: "Mathématiques", room: "B 204" },
    { time: "09:00", subject: "Histoire-géo", room: "A 112" },
    { time: "10:15", subject: "Physique-chimie", room: "C 007", changed: true, note: "salle changée" },
    { time: "11:15", subject: "Anglais", room: "B 118" },
    { time: "13:30", subject: "EPS", room: "Gymnase" },
    { time: "14:30", subject: "SVT", room: "C 102", changed: true, note: "annulé" },
    { time: "15:30", subject: "Philosophie", room: "A 210" },
  ]);

  app.get("/connectors/news", async () => [
    {
      category: "Vie de l'école",
      title: "Portes ouvertes le samedi 12 septembre",
      excerpt:
        "Visite des ateliers, rencontre avec les équipes pédagogiques et démonstrations du club robotique de 9 h à 17 h.",
    },
  ]);

  // --- Télémétrie -----------------------------------------------------

  app.post(ROUTES.telemetry, async (request, reply) => {
    const deviceId = request.headers[HEADERS.deviceId];
    const device = typeof deviceId === "string" ? await store.getDevice(deviceId) : null;
    if (!device?.screenId) {
      return reply.code(401).send({ code: "unauthenticated", message: "Appareil non identifié.", retryable: false });
    }

    const parsed = TelemetryBatch.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: "Lot de télémétrie invalide.",
        retryable: false,
        details: parsed.error.flatten(),
      });
    }

    // L'acquittement porte les identifiants générés par l'agent : c'est lui
    // qui rend le renvoi après coupure idempotent, et qui autorise l'agent
    // à purger sa file locale. Rien d'autre ne doit servir de signal.
    const acceptedEventIds = await store.recordTelemetry(device.screenId, parsed.data);

    request.log.info(
      { deviceId, accepted: acceptedEventIds.length },
      "lot de télémétrie enregistré",
    );
    return reply.send({ acceptedEventIds });
  });

  if (options.consoleToken !== undefined || options.devRoutes) {
    registerConsoleApi(app, {
      store,
      media: media_,
      ...(options.consoleToken !== undefined ? { adminToken: options.consoleToken } : {}),
      ...(options.timetableUrl !== undefined ? { timetableUrl: options.timetableUrl } : {}),
      ...(options.publicUrl !== undefined ? { publicUrl: options.publicUrl } : {}),
    });
  }

  return app;
}

/** L'adresse par laquelle le player joint le serveur, telle qu'il la voit. */
function publicUrl(request: { headers: Record<string, unknown> }): string {
  const host = typeof request.headers["host"] === "string" ? request.headers["host"] : "localhost:3000";
  return `http://${host}`;
}

declare module "fastify" {
  interface FastifyInstance {
    store: Store;
    media: MediaStore;
  }
}
