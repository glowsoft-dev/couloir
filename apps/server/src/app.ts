import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyCookie from "@fastify/cookie";
import type { DepotComptes } from "./comptes/depot.js";
import type { ServiceActualites, ServiceIdentite } from "./connecteurs/service.js";
import type { ServiceNetypareo } from "./connecteurs/service-netypareo.js";
import fastifyStatic from "@fastify/static";
import {
  EnrollClaimRequest,
  EnrollStartRequest,
  HEADERS,
  type Manifest,
  API_PREFIX,
  COMMAND_WAIT_SEC,
  CommandResult,
  ROUTES,
  TelemetryBatch,
  demoManifest,
  SIGNATURE_MAX_SKEW_MS,
  explainRejection,
  requiresSignature,
} from "@couloir/protocol";
import { ReplayGuard, verifyRequest } from "./auth.js";
import { CommandBus } from "./commands.js";
import { registerConsoleApi } from "./console-api.js";
import { registerTimetableRoutes } from "./timetable/routes.js";
import type { TimetableRepository } from "./timetable/repository.js";
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
  /** Emploi du temps. Absent = les routes ne sont pas montées. */
  timetable?: TimetableRepository;
  /** Canal de commandes. Partagé avec la console pour qu'elle puisse émettre. */
  commands?: CommandBus;
  /**
   * Dossier de la console compilée.
   *
   * Servie par le serveur lui-même : une seule adresse, un seul certificat,
   * un seul endroit à ouvrir. Deux serveurs distincts obligeraient à retenir
   * deux URL et à gérer du CORS pour rien.
   */
  consoleDir?: string;
  /**
   * Coupe la vérification des signatures.
   * Réservé aux tests qui portent sur autre chose : en production, une
   * requête d'appareil non signée n'a aucune raison d'exister.
   */
  trustUnsignedDevices?: boolean;
  /** Ouvre les routes de publication de développement. */
  devRoutes?: boolean;
  /** Le connecteur d'actualités. Absent = la route rend une liste vide. */
  actualites?: ServiceActualites;
  /** L'identité de l'établissement, inscrite dans chaque manifeste. */
  identite?: ServiceIdentite;
  /** Le branchement sur NetYPareo. Absent = l'emploi du temps reste local. */
  netypareo?: ServiceNetypareo;
  /**
   * Les comptes nominatifs.
   *
   * Absent — serveur en mémoire, tests — la clé de secours reste la seule
   * clé et ouvre tout, comme avant les comptes.
   */
  comptes?: DepotComptes;
  /** Faux en développement : un cookie `Secure` ne survit pas à HTTP. */
  cookieSécurisé?: boolean;
}

/** ETag calculé sur le contenu : deux manifestes identiques donnent le même. */
function etagOf(manifest: Manifest): string {
  const hash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  return `"${hash.slice(0, 32)}"`;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const store: Store = options.store ?? new MemoryStore();
  const commandBus = options.commands ?? new CommandBus();
  const media_ = options.media ?? new MediaStore("./data/media");
  const app = Fastify({
    logger: options.logger ?? false,
    // Le canal de commandes tient une connexion ouverte par écran, et
    // chaque agent en rouvre une aussitôt la précédente rendue. Sans cette
    // option, l'arrêt du serveur attendrait indéfiniment un flux qui se
    // renouvelle tout seul.
    forceCloseConnections: true,
  });

  app.decorate("store", store);
  app.decorate("media", media_);
  app.decorate("commands", commandBus);

  // `preClose`, pas `onClose` : Fastify attend d'abord la fin des requêtes
  // en cours, et une interrogation longue en est une. Libérer les attentes
  // après coup produirait un interblocage — l'arrêt attendrait la requête,
  // qui n'attend que l'arrêt.
  app.addHook("preClose", async () => commandBus.close());

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

  // --- Canal de commandes ----------------------------------------------

  /**
   * Interrogation longue : l'écran demande ses commandes, le serveur retient
   * la réponse jusqu'à en avoir une ou jusqu'au délai. Une liste vide est un
   * succès, pas une erreur — l'agent reboucle sans rien interpréter.
   */
  app.get<{ Querystring: { wait?: string } }>(ROUTES.commands, async (request, reply) => {
    const screenId = (request as { screenId?: string }).screenId;
    if (!screenId) {
      return reply.code(401).send({ code: "unauthenticated", message: "Appareil non identifié.", retryable: false });
    }

    const requested = Number(request.query.wait);
    const waitSec = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 60) : COMMAND_WAIT_SEC;

    return { commands: await commandBus.wait(screenId, waitSec) };
  });

  app.post(ROUTES.commandResult, async (request, reply) => {
    const screenId = (request as { screenId?: string }).screenId;
    if (!screenId) {
      return reply.code(401).send({ code: "unauthenticated", message: "Appareil non identifié.", retryable: false });
    }

    const parsed = CommandResult.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: "Compte rendu de commande invalide.",
        retryable: false,
        details: parsed.error.flatten(),
      });
    }

    commandBus.recordResult(screenId, parsed.data);
    request.log.info(
      { screenId, commandId: parsed.data.commandId, outcome: parsed.data.outcome },
      "commande exécutée",
    );
    return reply.code(204).send();
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

  // Bouchon conservé pour les démonstrations sans base : le vrai emploi du
  // temps est servi par /v1/timetable.
  app.get("/connectors/timetable", async () => ({
    days: [
      {
        classId: "demo",
        classLabel: "Terminale G1",
        date: new Date().toISOString().slice(0, 10),
        entries: [
          { time: "08:00", endTime: "08:55", subject: "Mathématiques", room: "B 204", change: "none" },
          { time: "09:00", endTime: "09:55", subject: "Histoire-géo", room: "A 112", change: "none" },
          { time: "10:15", endTime: "11:10", subject: "Physique-chimie", room: "C 007", change: "room", note: "salle changée" },
          { time: "11:15", endTime: "12:10", subject: "Anglais", room: "B 118", change: "none" },
          { time: "13:30", endTime: "14:25", subject: "EPS", room: "Gymnase", change: "none" },
          { time: "14:30", endTime: "15:25", subject: "SVT", room: "C 102", change: "cancelled", note: "annulé" },
          { time: "15:30", endTime: "16:25", subject: "Philosophie", room: "A 210", change: "none" },
        ],
      },
    ],
  }));

  /**
   * Les actualités, telles que les écrans les lisent.
   *
   * Sans configuration, la route rend une liste vide plutôt qu'une erreur :
   * un écran ne doit pas se mettre en repli parce qu'une source facultative
   * n'a pas encore été branchée.
   *
   * Route publique, comme toutes les sources de données : elle ne dit rien
   * que le site de l'école ne publie déjà. Les écrans ne portent pas de
   * jeton de console, et leur en donner un serait le disséminer dans le
   * couloir.
   */
  /**
   * Les illustrations, relayées par le serveur.
   *
   * Seules les adresses vues dans la charge courante sont servies : la route
   * n'accepte pas d'adresse, seulement une clé. Un relais qui prendrait une
   * adresse arbitraire permettrait d'atteindre depuis le serveur ce qu'on ne
   * peut pas atteindre de l'extérieur.
   */
  app.get<{ Params: { clef: string } }>("/connectors/news/image/:clef", async (request, reply) => {
    const image = await options.actualites?.image(request.params.clef);
    if (!image) {
      // 404 franc : le rendu retire l'illustration et garde le texte.
      return reply.code(404).send({ code: "image-inconnue", message: "Image indisponible.", retryable: false });
    }
    return reply
      .type(image.type)
      // Les illustrations changent quand l'article change, et l'article
      // change d'adresse : on peut donc les garder longtemps.
      .header("cache-control", "public, max-age=86400")
      .send(image.octets);
  });

  /**
   * L'emploi du temps d'un afficheur NetYPareo, tel que les écrans le lisent.
   *
   * Rendu au format que le noyau de rendu connaît déjà : le connecteur
   * traduit NetYPareo en emploi du temps, et le rendu ignore d'où ça vient.
   * Le jour où l'établissement change de logiciel, seul ce connecteur bouge.
   */
  app.get<{ Params: { afficheur: string } }>(
    "/connectors/netypareo/:afficheur",
    async (request, reply) => {
      if (!options.netypareo) {
        return reply.code(503).send({
          code: "non-configure",
          message: "NetYPareo n'est pas configuré.",
          retryable: false,
        });
      }
      try {
        const journee = await options.netypareo.journee(request.params.afficheur);
        return {
          days: [
            {
              classId: `afficheur-${journee.afficheur}`,
              classLabel: journee.titre,
              date: journee.date,
              entries: journee.seances,
              ...(journee.seances.length === 0
                ? // Une liste vide ressemble à une panne. On dit pourquoi.
                  { notice: "Aucun cours prévu aujourd'hui." }
                : {}),
            },
          ],
        };
      } catch (cause) {
        request.log.warn({ err: cause }, "emploi du temps NetYPareo indisponible");
        return reply.code(503).send({
          code: "source-indisponible",
          message: cause instanceof Error ? cause.message : "Emploi du temps indisponible.",
          retryable: true,
        });
      }
    },
  );

  /**
   * L'installateur d'un boîtier, servi par le serveur lui-même.
   *
   * Poser un écran devient une commande à recopier, l'adresse du serveur
   * déjà dedans. Sans ça il faudrait construire un artefact sur un poste de
   * développement, le copier sur une clé, et retaper une adresse à la main
   * devant un écran — trois occasions de se tromper, dont une silencieuse.
   *
   * Servir aussi le lecteur depuis ici garantit que le serveur et les
   * boîtiers ne peuvent pas se désynchroniser : c'est le même dépôt qui
   * fournit les deux.
   *
   * Route publique : elle ne contient aucun secret, et un boîtier tout juste
   * sorti du carton n'a pas d'identité à présenter. C'est l'appairage, plus
   * tard, qui fait le pont de confiance.
   */
  app.get("/installer.sh", async (request, reply) => {
    const script = await lireInstallateur();
    if (!script) {
      return reply.code(404).send("Installateur indisponible sur ce serveur.\n");
    }
    const adresse = options.publicUrl ?? `http://${request.headers.host ?? "localhost:3000"}`;
    return reply
      .type("text/x-shellscript; charset=utf-8")
      .header("cache-control", "no-store")
      // L'adresse est inscrite en tête plutôt que passée en argument : une
      // commande à recopier ne doit pas dépendre de ce qu'on tape après.
      .send(script.replace(/^SERVER="\$\{1:-\}"$/m, `SERVER="\${1:-${adresse}}"`));
  });

  /**
   * La version du lecteur que ce serveur sert.
   *
   * Sans elle, mettre à jour douze écrans veut dire se brancher sur douze
   * Raspberry : le lecteur est téléchargé une seule fois, à l'installation.
   * Les boîtiers la relisent et vont chercher ce qui a changé.
   *
   * L'empreinte est calculée sur le contenu réellement servi, à chaque appel.
   * La déduire d'un numéro de version écrit à la main laisserait un fichier
   * remplacé sans que personne ne s'en aperçoive.
   */
  app.get("/telechargements/version.json", async (_request, reply) => {
    const fichiers: { nom: string; sha256: string; octets: number }[] = [];
    for (const nom of ["couloir-player.mjs", "couloir.js"]) {
      const contenu = await lireArtefact(nom);
      if (contenu === null) continue;
      const octets = Buffer.byteLength(contenu, "utf8");
      fichiers.push({ nom, sha256: createHash("sha256").update(contenu).digest("hex"), octets });
    }
    /*
     * Jamais mise en cache, y compris quand il n'y a rien à servir.
     *
     * Un intermédiaire qui garderait ce 503 figerait le parc sur « pas de
     * lecteur » alors que le serveur en sert un depuis une heure — et rien
     * ne le signalerait, puisque les écrans continueraient d'afficher.
     */
    reply.header("cache-control", "no-store");
    if (fichiers.length === 0) {
      return reply.code(503).send({
        code: "artefact-absent",
        message: "Le lecteur n'a pas été construit sur ce serveur.",
        retryable: false,
      });
    }
    /*
     * La version est l'empreinte de l'ensemble, pas un numéro déclaré.
     *
     * Deux fichiers changés d'un côté, un numéro oublié de l'autre, et les
     * écrans resteraient sur l'ancien lecteur en croyant être à jour. Ici,
     * changer un octet change la version.
     */
    const version = createHash("sha256")
      .update(fichiers.map((f) => `${f.nom}:${f.sha256}`).join("\n"))
      .digest("hex")
      .slice(0, 12);
    return reply.send({ version, fichiers });
  });

  /** Le lecteur déployable, que l'installateur va chercher. */
  app.get<{ Params: { fichier: string } }>("/telechargements/:fichier", async (request, reply) => {
    const permis = new Set(["couloir-player.mjs", "couloir.js"]);
    if (!permis.has(request.params.fichier)) {
      return reply.code(404).send({ code: "inconnu", message: "Fichier inconnu.", retryable: false });
    }
    const contenu = await lireArtefact(request.params.fichier);
    if (!contenu) {
      return reply.code(503).send({
        code: "artefact-absent",
        message: "Le lecteur n'a pas été construit sur ce serveur.",
        retryable: false,
      });
    }
    return reply.type("application/javascript; charset=utf-8").send(contenu);
  });

  app.get("/connectors/news", async (request, reply) => {
    if (!options.actualites) {
      return reply.send({
        articles: [],
        source: "aucune",
        recupereLe: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      });
    }
    try {
      // La même adresse que celle inscrite dans les manifestes : c'est par
      // elle que l'écran reviendra chercher les illustrations.
      const base = options.publicUrl ?? `http://${request.headers.host ?? "localhost:3000"}`;
      return await options.actualites.charge(base);
    } catch (cause) {
      // Site injoignable et aucun cache : on le dit franchement. L'agent
      // gardera sa dernière copie, et le rendu décidera quoi en faire.
      request.log.warn({ err: cause }, "actualités indisponibles");
      return reply.code(503).send({
        code: "source-indisponible",
        message: cause instanceof Error ? cause.message : "Actualités indisponibles.",
        retryable: true,
      });
    }
  });

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

  if (options.timetable) {
    registerTimetableRoutes(app, { timetable: options.timetable });
  }

  if (options.consoleToken !== undefined || options.devRoutes) {
    // Le greffon cookie ne sert qu'à la console : les écrans s'authentifient
    // par signature, ils n'en ont aucun.
    void app.register(fastifyCookie);
    registerConsoleApi(app, {
      store,
      media: media_,
      ...(options.consoleToken !== undefined ? { adminToken: options.consoleToken } : {}),
      ...(options.timetableUrl !== undefined ? { timetableUrl: options.timetableUrl } : {}),
      ...(options.publicUrl !== undefined ? { publicUrl: options.publicUrl } : {}),
      ...(options.timetable ? { timetable: options.timetable } : {}),
      commands: commandBus,
      ...(options.comptes ? { comptes: options.comptes } : {}),
      ...(options.actualites ? { actualites: options.actualites } : {}),
      ...(options.identite ? { identite: options.identite } : {}),
      ...(options.netypareo ? { netypareo: options.netypareo } : {}),
      ...(options.cookieSécurisé !== undefined ? { cookieSécurisé: options.cookieSécurisé } : {}),
    });
  }

  // --- La console ------------------------------------------------------
  // Enregistrée en dernier : elle capte tout ce que les routes précédentes
  // n'ont pas pris, et sert `index.html` pour que la navigation interne
  // fonctionne au rechargement.

  const consoleDir = options.consoleDir ?? defaultConsoleDir();
  if (consoleDir && existsSync(consoleDir)) {
    // `wildcard: true` résout les fichiers À LA REQUÊTE. Avec `false`,
    // Fastify indexe le dossier au démarrage : reconstruire la console
    // pendant que le serveur tourne servait alors la page de repli à la
    // place des fichiers, avec un type MIME faux.
    void app.register(fastifyStatic, { root: consoleDir, wildcard: true });

    app.setNotFoundHandler((request, reply) => {
      // Les chemins d'API restent des 404 francs : renvoyer la console à un
      // player qui se trompe d'adresse le laisserait deviner longtemps.
      if (request.url.startsWith(API_PREFIX) || request.url.startsWith("/connectors")) {
        return reply.code(404).send({
          code: "not-found",
          message: "Route inconnue.",
          retryable: false,
        });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

/**
 * L'installateur et le lecteur déployable.
 *
 * Cherchés à côté du serveur une fois déployé, dans le dépôt en
 * développement — le même schéma que la console. Absents, les routes le
 * disent franchement plutôt que de servir un script tronqué qu'on
 * exécuterait en confiance sur un boîtier.
 */
async function lireDepuis(candidats: readonly string[]): Promise<string | null> {
  for (const chemin of candidats) {
    try {
      return await readFile(chemin, "utf8");
    } catch {
      // absent ici, on essaie le suivant
    }
  }
  return null;
}

function lireInstallateur(): Promise<string | null> {
  return lireDepuis([
    fileURLToPath(new URL("./install.sh", import.meta.url)),
    fileURLToPath(new URL("../../player-linux/scripts/install.sh", import.meta.url)),
    fileURLToPath(new URL("../../../apps/player-linux/scripts/install.sh", import.meta.url)),
  ]);
}

function lireArtefact(fichier: string): Promise<string | null> {
  return lireDepuis([
    fileURLToPath(new URL(`./telechargements/${fichier}`, import.meta.url)),
    fileURLToPath(new URL(`../../player-linux/dist-bundle/${fichier}`, import.meta.url)),
    fileURLToPath(new URL(`../../../apps/player-linux/dist-bundle/${fichier}`, import.meta.url)),
  ]);
}

/** La console compilée, telle qu'elle est déposée à côté du serveur. */
function defaultConsoleDir(): string | null {
  const candidates = [
    fileURLToPath(new URL("./console", import.meta.url)),
    fileURLToPath(new URL("../../console/dist", import.meta.url)),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
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
    commands: CommandBus;
  }
}
