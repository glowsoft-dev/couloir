import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { API_PREFIX, CommandKind } from "@couloir/protocol";
import { CompositionError, type PublishSpec, compose } from "./composer.js";
import type { MediaStore } from "./media.js";
import type { Store } from "./store.js";
import type { CommandBus } from "./commands.js";
import type { Manifest } from "@couloir/protocol";
import type { TimetableRepository } from "./timetable/repository.js";
import type { DepotComptes } from "./comptes/depot.js";
import {
  ErreurConnecteur,
  type ServiceActualites,
  type ServiceIdentite,
} from "./connecteurs/service.js";
import type { ServiceNetypareo } from "./connecteurs/service-netypareo.js";
import { NOM_COOKIE, enregistrerRoutesComptes, journaliserAction, pouvoirRequis } from "./comptes/routes.js";
import { peut } from "./comptes/roles.js";

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

/**
 * Comparaison du jeton à temps constant.
 *
 * `!==` s'arrête au premier caractère qui diffère : le temps de réponse
 * renseigne alors sur le nombre de caractères déjà justes, et le jeton se
 * devine caractère par caractère. Sur un réseau local l'écart est noyé dans
 * le bruit, mais ce serveur va être exposé — autant ne pas laisser la porte
 * entrouverte.
 */
function jetonValide(entete: string | undefined, attendu: string): boolean {
  if (typeof entete !== "string") return false;
  const fourni = Buffer.from(entete);
  const référence = Buffer.from(`Bearer ${attendu}`);
  // `timingSafeEqual` exige des longueurs égales ; on compare donc d'abord
  // la longueur, qui n'est pas un secret.
  return fourni.length === référence.length && timingSafeEqual(fourni, référence);
}

export const CONSOLE_PREFIX = `${API_PREFIX}/console` as const;

/**
 * Le corps d'une publication.
 *
 * `items` peut être vide : un écran qui ne diffuse que les actualités du site
 * est légitime — c'est la configuration d'un hall d'accueil. C'est le
 * composeur qui refuse un écran sans rien du tout, parce que lui seul sait ce
 * qui alimente la rotation.
 */
const PublishBody = z.object({
  layout: z.enum(["plein-ecran", "principal-et-cours", "emploi-du-temps"]),
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
        /** `remplir` rogne les bords. Défaut : l'image tient en entier. */
        fit: z.enum(["entier", "remplir"]).optional(),
        /**
         * Quand cette affiche fait partie de la rotation.
         *
         * Les bornes sont des instants absolus : la console convertit
         * « jusqu'au 15 septembre » en fin de journée locale avant d'envoyer.
         */
        visibility: z
          .object({
            startsAt: z.string().datetime().optional(),
            endsAt: z.string().datetime().optional(),
            daysOfWeek: z.array(z.number().int().min(1).max(7)).optional(),
            dailyStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
            dailyEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          })
          .optional(),
      }),
    ),
  ticker: z.string().max(500).optional(),
  timetableUrl: z.string().url().optional(),
  /**
   * Les classes affichées dans la colonne des cours.
   *
   * Une seule : écran « fixe », toujours la même classe. Plusieurs, ou
   * absent : l'écran les fait défiler, dans l'ordre de la console.
   */
  timetableClassIds: z.array(z.string().uuid()).optional(),
  /**
   * Quels afficheurs NetYPareo cet écran montre.
   *
   * Absent : celui de son bâtiment, déduit tout seul. Un seul : il s'y
   * tient. Plusieurs : ils défilent. Mêmes règles que pour les classes.
   */
  timetableAfficheurs: z.array(z.string()).optional(),
  /**
   * Ce que la colonne des cours montre sur cet écran.
   *
   * Absent = tout, comme avant ce réglage. Liste vide = seulement l'heure et
   * l'intitulé.
   */
  timetableChamps: z.array(z.enum(["heureFin", "module", "salle", "enseignant"])).optional(),
  /** Combien d'actualités du site tournent avec le reste. 0 = aucune. */
  actualites: z.number().int().min(0).max(10).optional(),
  /** Ce que l'écran montre quand rien n'est programmé pour maintenant. */
  parDefaut: z
    .object({
      assetId: z.string().optional(),
      emploiDuTemps: z.boolean().optional(),
    })
    .optional(),
  /**
   * Plages d'extinction de la dalle, en heure locale.
   *
   * Une dalle qui reste allumée la nuit s'use et consomme pour personne. Un
   * message d'urgence la rallume — c'est le rendu qui s'en charge.
   */
  displayOff: z
    .array(
      z.object({
        daysOfWeek: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5]),
        from: z.string().regex(/^\d{2}:\d{2}$/),
        to: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .optional(),
});

const EmergencyBody = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(400).optional(),
  /** Vide = tout le parc. */
  screenIds: z.array(z.string().uuid()).optional(),
  /**
   * Au-delà, un écran qui reçoit le message en différé l'ignore. Ce n'est
   * PAS une durée d'affichage : seule une action explicite le retire.
   */
  validHours: z.number().int().min(1).max(72).default(12),
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
  /** Source d'emploi du temps proposée par défaut à la publication. */
  timetableUrl?: string;
  /**
   * L'adresse par laquelle LES ÉCRANS joignent le serveur.
   *
   * Elle ne peut pas se déduire de l'en-tête `Host` de la requête : c'est
   * l'adresse de la personne qui publie, pas celle des écrans. Publier
   * depuis `localhost` produisait des URL de médias que les écrans ne
   * savaient pas joindre — constaté sur une VM, et c'est exactement ce qui
   * arriverait dès que la console et les écrans n'entrent pas par la même
   * porte.
   */
  publicUrl?: string;
  /** Pour résoudre les classes à afficher dans la colonne des cours. */
  timetable?: TimetableRepository;
  /** Canal de commandes. Absent = les boutons d'action restent inertes. */
  commands?: CommandBus;
  /**
   * Les comptes nominatifs. Absent = pas de base, la clé de secours seule
   * ouvre la console, comme avant.
   */
  comptes?: DepotComptes;
  /** Faux en développement : un cookie `Secure` ne survit pas à HTTP. */
  cookieSécurisé?: boolean;
  /** Le connecteur d'actualités. Absent = l'onglet reste indisponible. */
  actualites?: ServiceActualites;
  /** L'identité de l'établissement, inscrite dans chaque manifeste. */
  identite?: ServiceIdentite;
  /** Le branchement sur NetYPareo. */
  netypareo?: ServiceNetypareo;
}

export function registerConsoleApi(app: FastifyInstance, options: ConsoleApiOptions): void {
  const { store, media } = options;

  /** Ouvertes à tous : sans elles, personne ne pourrait jamais entrer. */
  const LIBRES = new Set([`${CONSOLE_PREFIX}/session`, `${CONSOLE_PREFIX}/amorce`]);

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith(CONSOLE_PREFIX)) return;

    if (!options.adminToken) {
      return reply.code(503).send({
        code: "console-disabled",
        message: "La console n'est pas activée sur ce serveur.",
        retryable: false,
      });
    }

    const chemin = request.url.split("?")[0]!;
    const clefDeSecours = jetonValide(request.headers.authorization, options.adminToken);

    // Sans base de comptes, la clé de secours reste la seule clé, et elle
    // ouvre tout. C'est le mode d'avant, conservé pour que le serveur en
    // mémoire — démonstrations, tests — continue de fonctionner.
    if (!options.comptes) {
      if (!clefDeSecours) {
        return reply.code(401).send({
          code: "unauthorized",
          message: "Jeton d'accès invalide.",
          retryable: false,
        });
      }
      request.identité = { utilisateur: null, clefDeSecours: true, auteur: "jeton partagé" };
      return;
    }

    const jetonDeSession = request.cookies[NOM_COOKIE];
    const utilisateur = jetonDeSession
      ? await options.comptes.utilisateurDeSession(jetonDeSession)
      : null;

    request.identité = {
      utilisateur,
      clefDeSecours,
      auteur: utilisateur?.nom ?? (clefDeSecours ? "clé de secours" : "inconnu"),
    };

    if (LIBRES.has(chemin)) return;

    /**
     * La clé de secours ne publie rien.
     *
     * Elle sert à créer le premier administrateur, et à rouvrir la porte le
     * jour où le dernier a perdu son mot de passe. Quelqu'un qui la
     * connaîtrait ne peut donc pas s'en servir pour afficher quoi que ce soit
     * dans un couloir — il ne peut que se donner un compte, ce qui laisse
     * une trace au journal.
     */
    if (!utilisateur) {
      const pouvoir = pouvoirRequis(request.method, chemin);
      if (clefDeSecours && pouvoir === "administrer") return;
      return reply.code(401).send({
        code: "non-authentifie",
        message: clefDeSecours
          ? "La clé de secours ne donne accès qu'aux comptes. Connectez-vous avec le vôtre."
          : "Connectez-vous pour accéder à la console.",
        retryable: false,
      });
    }

    const pouvoir = pouvoirRequis(request.method, chemin);
    if (!peut(utilisateur.role, pouvoir)) {
      return reply.code(403).send({
        code: "role-insuffisant",
        message:
          pouvoir === "administrer"
            ? "Les comptes et le journal sont réservés aux administrateurs."
            : "Votre compte est en lecture seule.",
        retryable: false,
      });
    }
  });

  if (options.comptes) {
    enregistrerRoutesComptes(app, {
      depot: options.comptes,
      prefixe: CONSOLE_PREFIX,
      ...(options.identite ? { identite: options.identite } : {}),
      ...(options.adminToken ? { clefDeSecours: options.adminToken } : {}),
      cookieSécurisé: options.cookieSécurisé ?? false,
    });
  }

  // --- Le parc ---------------------------------------------------------

  /**
   * Le parc.
   *
   * `?avecManifeste=1` joint à chaque écran ce qu'il diffuse. C'est ce qui
   * permet à la console de dessiner le mur d'aperçus en UNE requête : vingt
   * écrans feraient sinon vingt allers-retours, et la page se remplirait par
   * à-coups sous les yeux de l'utilisateur.
   *
   * `?avecComposition=1` joint ce qui a été SAISI, et non ce qui en a été
   * composé. C'est ce qui permet de répondre à « quels écrans montrent
   * l'emploi du temps de cette classe ? » — une question qui se lit dans les
   * réglages, pas dans le manifeste, où les classes ont déjà été résolues en
   * diapositives.
   */
  app.get<{ Querystring: { avecManifeste?: string; avecComposition?: string } }>(
    `${CONSOLE_PREFIX}/screens`,
    async (request) => {
      const screens = await store.listScreenStatuses();
      const reponse: Record<string, unknown> = {
        screens,
        pending: await store.listPendingDevices(),
      };
      if (request.query.avecManifeste === "1") {
        const manifestes = await Promise.all(
          screens.map(async (screen) => [screen.id, await store.getManifest(screen.id)] as const),
        );
        reponse.manifestes = Object.fromEntries(manifestes);
      }
      if (request.query.avecComposition === "1") {
        const compositions = await Promise.all(
          screens.map(async (screen) => [screen.id, await store.getSpec(screen.id)] as const),
        );
        reponse.compositions = Object.fromEntries(compositions);
      }
      return reponse;
    },
  );


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

  /**
   * La composition actuellement en ligne.
   *
   * Sans elle, l'éditeur s'ouvre vide devant un écran qui affiche déjà
   * quelque chose : on ne peut que remplacer à l'aveugle, jamais corriger.
   */
  app.get<{ Params: { screenId: string } }>(
    `${CONSOLE_PREFIX}/screens/:screenId/composition`,
    async (request) => {
      const manifest = await store.getManifest(request.params.screenId);
      return {
        version: manifest?.version ?? null,
        spec: manifest ? await store.getSpec(request.params.screenId) : null,
      };
    },
  );

  // --- Poser un nouveau boîtier ------------------------------------------

  /**
   * Ce qu'il faut taper sur le boîtier, et si cette adresse tient debout.
   *
   * L'adresse est le point qui échoue en silence : un serveur configuré sur
   * « localhost » donne une commande qui s'exécute sans erreur et un boîtier
   * qui ne joindra jamais rien. On le dit ici plutôt que de le laisser
   * découvrir devant un écran monté à quatre mètres.
   */
  app.get(`${CONSOLE_PREFIX}/installation`, async (request) => {
    const adresse = resolvePublicUrl(options.publicUrl, request.headers.host);
    let hote = "";
    try {
      hote = new URL(adresse).hostname;
    } catch {
      // adresse malformée : le contrôle ci-dessous s'en chargera
    }
    const locale = /^(localhost|127\.|::1|0\.0\.0\.0)/.test(hote);
    return {
      adresse,
      commande: `curl -fsSL ${adresse}/installer.sh | sudo bash`,
      /** Vrai quand l'adresse ne désigne que la machine du serveur. */
      adresseLocale: locale,
      /** Sans TLS, la commande télécharge un script en clair. */
      sansTls: adresse.startsWith("http://"),
    };
  });

  // --- Identité de l'établissement ---------------------------------------

  const Identite = z.object({
    nom: z.string().min(1).max(80),
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "La couleur doit s'écrire « #11A6C4 ».")
      .nullable()
      .optional(),
  });

  app.get(`${CONSOLE_PREFIX}/identite`, async (_request, reply) => {
    if (!options.identite) {
      return reply.code(503).send({ code: "sans-base", message: "Indisponible.", retryable: false });
    }
    return { identite: await options.identite.lire() };
  });

  app.put(`${CONSOLE_PREFIX}/identite`, async (request, reply) => {
    if (!options.identite) {
      return reply.code(503).send({ code: "sans-base", message: "Indisponible.", retryable: false });
    }
    const parsed = Identite.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: parsed.error.issues[0]?.message ?? "Identité incomplète.",
        retryable: false,
      });
    }
    const identite = await options.identite.enregistrer(parsed.data);
    if (options.comptes) {
      await journaliserAction(request, options.comptes, "changement d'identité", identite.nom);
    }
    // Les manifestes déjà publiés portent l'ancienne identité : on ne les
    // réécrit pas dans le dos de qui a publié. Le prochain envoi la portera.
    return { identite };
  });

  // --- NetYPareo -----------------------------------------------------------

  const ReglagesNety = z.object({
    baseUrl: z.string().min(1),
    actif: z.boolean().default(true),
    afficheurs: z
      .array(
        z.object({
          afficheur: z.string().min(1),
          batiment: z.string().nullable().optional(),
          libelle: z.string().optional(),
        }),
      )
      .default([]),
  });

  app.get(`${CONSOLE_PREFIX}/netypareo`, async (_request, reply) => {
    if (!options.netypareo) {
      return reply.code(503).send({ code: "sans-base", message: "Indisponible.", retryable: false });
    }
    return { reglages: await options.netypareo.reglages() };
  });

  app.put(`${CONSOLE_PREFIX}/netypareo`, async (request, reply) => {
    if (!options.netypareo) {
      return reply.code(503).send({ code: "sans-base", message: "Indisponible.", retryable: false });
    }
    const parsed = ReglagesNety.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: "Réglage incomplet.",
        retryable: false,
        details: parsed.error.flatten(),
      });
    }
    const reglages = await options.netypareo.enregistrer(parsed.data);
    if (options.comptes) {
      await journaliserAction(request, options.comptes, "réglage de NetYPareo", reglages.baseUrl, {
        afficheurs: reglages.afficheurs.length,
      });
    }
    return { reglages };
  });

  /** L'essai avant de brancher : on voit ce que les écrans afficheraient. */
  app.post(`${CONSOLE_PREFIX}/netypareo/essai`, async (request, reply) => {
    if (!options.netypareo) {
      return reply.code(503).send({ code: "sans-base", message: "Indisponible.", retryable: false });
    }
    const Essai = z.object({ baseUrl: z.string().min(1), afficheur: z.string().min(1) });
    const parsed = Essai.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "invalid-body", message: "Essai incomplet.", retryable: false });
    }
    try {
      return { journee: await options.netypareo.essayer(parsed.data.baseUrl, parsed.data.afficheur) };
    } catch (cause) {
      if (cause instanceof ErreurConnecteur) {
        return reply.code(400).send({
          code: "source-refusee",
          message: cause.message,
          ...(cause.conseil ? { conseil: cause.conseil } : {}),
          retryable: false,
        });
      }
      throw cause;
    }
  });

  // --- Actualités du site ------------------------------------------------

  const Reglages = z.object({
    url: z.string().min(1),
    categorie: z.string().optional(),
    nombre: z.number().int().min(1).max(20).default(5),
    actif: z.boolean().default(true),
  });

  app.get(`${CONSOLE_PREFIX}/actualites`, async (_request, reply) => {
    if (!options.actualites) {
      return reply.code(503).send({
        code: "sans-base",
        message: "Les actualités demandent une base de données.",
        retryable: false,
      });
    }
    return { reglages: await options.actualites.reglages(), etat: options.actualites.etat() };
  });

  app.put(`${CONSOLE_PREFIX}/actualites`, async (request, reply) => {
    if (!options.actualites) {
      return reply.code(503).send({ code: "sans-base", message: "Indisponible.", retryable: false });
    }
    const parsed = Reglages.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: "Réglage incomplet.",
        retryable: false,
        details: parsed.error.flatten(),
      });
    }
    const reglages = await options.actualites.enregistrer(parsed.data);
    if (options.comptes) {
      await journaliserAction(request, options.comptes, "réglage des actualités", reglages.url, {
        actif: reglages.actif,
      });
    }
    return { reglages };
  });

  /**
   * L'essai avant enregistrement.
   *
   * On ne branche pas une source sur vingt écrans sans avoir vu ce qu'elle
   * rend. L'essai ne touche ni au cache ni aux réglages : il dit seulement
   * ce qu'on obtiendrait.
   */
  app.post(`${CONSOLE_PREFIX}/actualites/essai`, async (request, reply) => {
    if (!options.actualites) {
      return reply.code(503).send({ code: "sans-base", message: "Indisponible.", retryable: false });
    }
    const parsed = Reglages.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "invalid-body", message: "Réglage incomplet.", retryable: false });
    }
    try {
      return { charge: await options.actualites.essayer(parsed.data) };
    } catch (cause) {
      if (cause instanceof ErreurConnecteur) {
        return reply.code(400).send({
          code: "source-refusee",
          message: cause.message,
          ...(cause.conseil ? { conseil: cause.conseil } : {}),
          retryable: false,
        });
      }
      throw cause;
    }
  });

  // --- Historique des publications --------------------------------------

  app.get<{ Params: { screenId: string } }>(
    `${CONSOLE_PREFIX}/screens/:screenId/history`,
    async (request) => ({ versions: await store.listManifests(request.params.screenId) }),
  );

  /**
   * Republie une version passée.
   *
   * On ne réécrit pas l'ancienne ligne : on en crée une nouvelle avec le
   * même contenu. L'historique reste une suite de faits — « on est revenu à
   * ce contenu tel jour » — plutôt qu'un état qu'on remonterait en effaçant
   * ce qui s'est passé.
   */
  app.post<{ Params: { screenId: string; version: string } }>(
    `${CONSOLE_PREFIX}/screens/:screenId/history/:version/restore`,
    async (request, reply) => {
      const target = Number(request.params.version);
      const past = await store.getManifestVersion(request.params.screenId, target);
      if (!past) {
        return reply.code(404).send({
          code: "unknown-version",
          message: "Cette version n'existe plus.",
          retryable: false,
        });
      }

      const current = await store.getManifest(request.params.screenId);
      const manifest = {
        ...past,
        version: (current?.version ?? target) + 1,
        issuedAt: iso(new Date()),
      };
      const pastSpec = await store.getSpec(request.params.screenId, target);
      await store.putManifest(manifest, pastSpec ?? undefined);
      options.commands?.issue(request.params.screenId, "sync-now");

      if (options.comptes) {
        // Le code d'étiquette plutôt que l'identifiant : c'est ce qu'on lit
        // dans le couloir, et c'est ce qu'on cherchera dans le journal.
        const écran = await store.getScreen(request.params.screenId);
        await journaliserAction(request, options.comptes, "retour à une version", écran?.code, {
          depuis: target,
          vers: manifest.version,
        });
      }
      request.log.info({ screenId: request.params.screenId, from: target }, "retour à une version");
      return { version: manifest.version, restoredFrom: target };
    },
  );

  // --- Commandes vers un écran -----------------------------------------

  /**
   * Émet une commande et attend son compte rendu.
   *
   * On attend délibérément : « Identifier » sans retour laisserait l'opérateur
   * dans le doute devant un écran qui n'a peut-être rien fait. Le délai est
   * court — l'écran tient déjà une connexion ouverte.
   */
  app.post<{ Params: { screenId: string }; Body: { kind?: string; params?: Record<string, unknown> } }>(
    `${CONSOLE_PREFIX}/screens/:screenId/command`,
    async (request, reply) => {
      const bus = options.commands;
      if (!bus) {
        return reply.code(503).send({
          code: "no-command-channel",
          message: "Le canal de commandes n'est pas actif sur ce serveur.",
          retryable: false,
        });
      }

      const parsed = CommandKind.safeParse(request.body?.kind);
      if (!parsed.success) {
        return reply.code(400).send({ code: "unknown-command", message: "Commande inconnue.", retryable: false });
      }

      const screen = await store.getScreen(request.params.screenId);
      if (!screen) {
        return reply.code(404).send({ code: "unknown-screen", message: "Écran inconnu.", retryable: false });
      }

      // Un écran qui n'écoute pas ne répondra jamais : autant le dire tout
      // de suite plutôt que de faire patienter quinze secondes pour rien.
      if (!bus.isListening(screen.id)) {
        return reply.code(409).send({
          code: "screen-not-listening",
          message: "Cet écran ne répond pas. La commande n'a pas été envoyée.",
          retryable: true,
        });
      }

      const command = bus.issue(screen.id, parsed.data, request.body?.params ?? {});
      // On journalise ce qui change l'état d'un boîtier, pas ce qui le
      // consulte : redémarrer et couper une dalle laissent un couloir noir,
      // synchroniser et capturer ne changent rien.
      if (options.comptes && ["reboot", "restart-app", "display-power", "clear-cache"].includes(parsed.data)) {
        await journaliserAction(request, options.comptes, `commande : ${parsed.data}`, screen.code);
      }
      const result = await waitForResult(bus, command.id, 15_000);

      if (!result) {
        return reply.code(504).send({
          code: "no-answer",
          message: "L'écran n'a pas répondu à temps.",
          retryable: true,
        });
      }
      return { command, result };
    },
  );

  // --- Mode urgence ----------------------------------------------------

  /**
   * Prend possession des écrans avec un message plein écran.
   *
   * Le message est posé dans le manifeste de chaque écran visé, avec une
   * version incrémentée : sans ça, l'agent l'ignorerait, puisqu'il refuse
   * toute version qui n'augmente pas.
   *
   * Il ne disparaît jamais tout seul. `validUntil` sert uniquement de
   * garde-fou pour un écran rallumé trois jours plus tard — il ne doit pas
   * ressortir une alerte d'évacuation périmée.
   */
  app.post(`${CONSOLE_PREFIX}/emergency`, async (request, reply) => {
    const parsed = EmergencyBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: "Le message d'urgence est incomplet.",
        retryable: false,
        details: parsed.error.flatten(),
      });
    }

    const now = new Date();
    const emergency = {
      id: randomUUID(),
      title: parsed.data.title.trim(),
      ...(parsed.data.body?.trim() ? { body: parsed.data.body.trim() } : {}),
      issuedAt: iso(now),
      validUntil: iso(new Date(now.getTime() + parsed.data.validHours * 3_600_000)),
    };

    const touched = await applyToScreens(store, parsed.data.screenIds, (manifest) => ({
      ...manifest,
      version: manifest.version + 1,
      emergency,
    }));

    // C'est ce réveil qui fait passer l'urgence de la minute à la seconde.
    options.commands?.broadcast(touched.appliedIds, "sync-now");
    if (options.comptes) {
      await journaliserAction(request, options.comptes, "déclenchement d'une urgence", emergency.title, {
        ecrans: touched.applied.length,
      });
    }
    request.log.warn({ screens: touched.applied.length, title: emergency.title }, "message d'urgence");
    return { emergency, ...touched };
  });

  /** Sortie explicite : un message d'urgence ne s'efface jamais tout seul. */
  app.delete(`${CONSOLE_PREFIX}/emergency`, async (request) => {
    const touched = await applyToScreens(store, undefined, (manifest) =>
      manifest.emergency
        ? { ...manifest, version: manifest.version + 1, emergency: null }
        : null,
    );
    options.commands?.broadcast(touched.appliedIds, "sync-now");
    if (options.comptes) {
      await journaliserAction(request, options.comptes, "levée de l'urgence", undefined, {
        ecrans: touched.applied.length,
      });
    }
    request.log.info({ screens: touched.applied.length }, "fin du message d'urgence");
    return touched;
  });

  /** L'état courant, pour que la console sache quoi montrer. */
  app.get(`${CONSOLE_PREFIX}/emergency`, async () => {
    const screens = await store.listScreens();
    for (const screen of screens) {
      const manifest = await store.getManifest(screen.id);
      if (manifest?.emergency) return { emergency: manifest.emergency };
    }
    return { emergency: null };
  });

  // --- Aperçu ----------------------------------------------------------

  /**
   * Compose le manifeste SANS l'enregistrer.
   *
   * L'aperçu passe par le même composeur que la publication : il est donc
   * fidèle par construction. Un aperçu qui emprunterait un autre chemin
   * finirait par mentir le jour où les deux divergent.
   */
  app.post<{ Params: { screenId: string } }>(
    `${CONSOLE_PREFIX}/screens/:screenId/preview`,
    async (request, reply) => {
      const parsed = PublishBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          code: "invalid-body",
          message: "La composition est incomplète.",
          retryable: false,
          details: parsed.error.flatten(),
        });
      }

      const screen = await store.getScreen(request.params.screenId);
      if (!screen) {
        return reply.code(404).send({ code: "unknown-screen", message: "Écran inconnu.", retryable: false });
      }

      try {
        const spec = await resolveSpec(
          parsed.data,
          options,
          resolvePublicUrl(options.publicUrl, request.headers.host),
          screen.building,
        );
        const manifest = compose({
          screenId: screen.id,
          version: 0,
          issuedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
          spec,
          media: media.index(),
          baseUrl: resolvePublicUrl(options.publicUrl, request.headers.host),
        });
        return { manifest };
      } catch (error) {
        if (error instanceof CompositionError) {
          return reply.code(400).send({ code: "composition", message: error.message, retryable: false });
        }
        throw error;
      }
    },
  );

  // --- Publication sur plusieurs écrans ---------------------------------

  /**
   * Les réglages qui appartiennent à l'ÉCRAN, pas au contenu.
   *
   * Une même affiche part sur cinq couloirs, mais chacun garde sa mise en
   * page, son afficheur d'emploi du temps et son heure d'extinction. Les
   * écraser reviendrait à reconfigurer cinq écrans pour publier une image —
   * et personne ne s'en apercevrait avant de passer devant.
   */
  const REGLAGES_DE_L_ECRAN = [
    "layout",
    "timetableAfficheurs",
    "timetableChamps",
    "timetableClassIds",
    "displayOff",
    "parDefaut",
  ] as const;

  const PublicationGroupee = z.object({
    screenIds: z.array(z.string()).min(1),
    spec: PublishBody,
  });

  app.post(`${CONSOLE_PREFIX}/publications`, async (request, reply) => {
    const parsed = PublicationGroupee.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: "La publication est incomplète.",
        retryable: false,
        details: parsed.error.flatten(),
      });
    }

    const baseUrl = resolvePublicUrl(options.publicUrl, request.headers.host);
    const resultats: {
      screenId: string;
      code?: string;
      version?: number;
      erreur?: string;
    }[] = [];

    for (const screenId of parsed.data.screenIds) {
      const screen = await store.getScreen(screenId);
      if (!screen) {
        resultats.push({ screenId, erreur: "Écran inconnu." });
        continue;
      }

      // Le réglage propre de l'écran l'emporte sur celui de la composition.
      const ancienne = (await store.getSpec(screenId)) as Record<string, unknown> | null;
      const corps = { ...parsed.data.spec } as Record<string, unknown>;
      for (const clef of REGLAGES_DE_L_ECRAN) {
        if (ancienne?.[clef] !== undefined) corps[clef] = ancienne[clef];
      }

      const relu = PublishBody.safeParse(corps);
      if (!relu.success) {
        resultats.push({ screenId, code: screen.code, erreur: "Réglages de l'écran illisibles." });
        continue;
      }

      try {
        const spec = await resolveSpec(relu.data, options, baseUrl, screen.building);
        const existing = await store.getManifest(screenId);
        const manifest = compose({
          screenId,
          version: (existing?.version ?? 0) + 1,
          issuedAt: iso(new Date()),
          spec,
          media: media.index(),
          baseUrl,
        });
        await store.putManifest(manifest, relu.data);
        options.commands?.issue(screenId, "sync-now");
        resultats.push({ screenId, code: screen.code, version: manifest.version });
      } catch (error) {
        // Un écran qui refuse n'empêche pas les autres : on publie ce qu'on
        // peut et on rend le détail. Tout annuler pour une mise en page
        // impossible sur un seul écran serait pire.
        resultats.push({
          screenId,
          code: screen.code,
          erreur: error instanceof CompositionError ? error.message : "Composition impossible.",
        });
      }
    }

    const publies = resultats.filter((r) => r.version !== undefined);
    if (options.comptes && publies.length > 0) {
      await journaliserAction(
        request,
        options.comptes,
        "publication groupée",
        publies.map((r) => r.code).join(", "),
        { ecrans: publies.length },
      );
    }
    request.log.info({ ecrans: publies.length, total: resultats.length }, "publication groupée");
    return { resultats };
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

      const spec = await resolveSpec(
          parsed.data,
          options,
          resolvePublicUrl(options.publicUrl, request.headers.host),
          screen.building,
        );

      try {
        const existing = await store.getManifest(screen.id);
        const manifest = compose({
          screenId: screen.id,
          version: (existing?.version ?? 0) + 1,
          issuedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
          spec,
          media: media.index(),
          baseUrl: resolvePublicUrl(options.publicUrl, request.headers.host),
        });

        // On enregistre la composition SAISIE, pas la composition résolue :
        // rouvrir doit rendre « toutes les classes » et non la liste figée
        // des classes qui existaient ce jour-là.
        await store.putManifest(manifest, parsed.data);
        // On réveille l'écran plutôt que d'attendre son prochain cycle :
        // publier doit se voir dans la seconde, pas dans la minute.
        options.commands?.issue(screen.id, "sync-now");
        if (options.comptes) {
          await journaliserAction(request, options.comptes, "publication", screen.code, {
            version: manifest.version,
            miseEnPage: spec.layout,
          });
        }
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

/**
 * Applique une transformation aux manifestes des écrans visés.
 *
 * Un écran sans contenu publié ne peut pas recevoir de message : il n'a pas
 * de manifeste où le poser. On le signale plutôt que de le passer sous
 * silence — savoir quels couloirs n'ont pas été touchés fait partie de
 * l'information d'urgence.
 */
async function applyToScreens(
  store: Store,
  screenIds: string[] | undefined,
  transform: (manifest: Manifest) => Manifest | null,
): Promise<{ applied: string[]; appliedIds: string[]; skipped: string[] }> {
  const screens = await store.listScreens();
  const targets = screenIds?.length ? screens.filter((s) => screenIds.includes(s.id)) : screens;

  const applied: string[] = [];
  const appliedIds: string[] = [];
  const skipped: string[] = [];

  for (const screen of targets) {
    const manifest = await store.getManifest(screen.id);
    if (!manifest) {
      skipped.push(screen.code);
      continue;
    }
    const next = transform(manifest);
    if (!next) continue;
    await store.putManifest(next);
    applied.push(screen.code);
    appliedIds.push(screen.id);
  }

  return { applied, appliedIds, skipped };
}

/**
 * Attend le compte rendu d'une commande.
 *
 * Scrutation courte plutôt qu'un système d'événements : la fenêtre est de
 * quelques secondes, l'écran a déjà une connexion ouverte, et le code reste
 * lisible.
 */
async function waitForResult(bus: CommandBus, commandId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = bus.result(commandId);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return null;
}

/** Horodatage au format attendu par le protocole. */
function iso(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * Complète la demande de la console avec ce que seul le serveur connaît.
 *
 * Les classes sont résolues au moment de publier : la console n'envoie que
 * des identifiants, et une classe renommée n'oblige pas à republier tous les
 * écrans.
 *
 * Partagé entre la publication ET l'aperçu, délibérément : deux chemins
 * distincts finiraient par diverger, et l'aperçu se mettrait à mentir.
 */
async function resolveSpec(
  body: z.infer<typeof PublishBody>,
  options: ConsoleApiOptions,
  baseUrl: string,
  /** L'écran visé : son bâtiment décide de l'afficheur NetYPareo. */
  batiment?: string,
): Promise<PublishSpec> {
  let timetableClasses: { id: string; label: string }[] | undefined;

  /**
   * D'où vient l'emploi du temps.
   *
   * NetYPareo quand il est branché : c'est le logiciel où l'école tient
   * réellement ses plannings, et ressaisir à la main ce qui existe déjà
   * finirait par diverger. La grille locale reste le repli, et le seul
   * recours pour un établissement qui n'a pas ce logiciel.
   */
  /**
   * Les afficheurs d'emploi du temps de cet écran.
   *
   * Un choix explicite l'emporte sur la déduction par bâtiment : un écran
   * du hall peut vouloir l'établissement entier, un écran du bâtiment B
   * peut vouloir aussi celui du C. Sans choix, le bâtiment décide — c'est le
   * cas courant, et il ne demande aucun réglage.
   */
  const reglagesEdt = await options.netypareo?.reglages();
  const choisis = body.timetableAfficheurs ?? [];
  const afficheursRetenus =
    reglagesEdt?.actif && choisis.length > 0
      ? choisis
          .map((id) => reglagesEdt.afficheurs.find((a) => a.afficheur === id))
          .filter((a): a is NonNullable<typeof a> => a !== undefined)
          .map((a) => ({
            id: a.afficheur,
            url: `${baseUrl}/connectors/netypareo/${encodeURIComponent(a.afficheur)}`,
            label: a.libelle || `Afficheur ${a.afficheur}`,
          }))
      : [];

  if (choisis.length > 0 && afficheursRetenus.length === 0) {
    throw new CompositionError(
      "Les afficheurs choisis n'existent plus. Vérifiez le branchement NetYPareo dans les Réglages.",
    );
  }

  const afficheur =
    afficheursRetenus.length > 0
      ? afficheursRetenus[0]!.id
      : await options.netypareo?.afficheurPour(batiment);

  // Avec NetYPareo, l'afficheur porte déjà tout le bâtiment : il n'y a pas de
  // classes à choisir, et en exiger une bloquerait la publication.
  if (
    (body.layout === "principal-et-cours" || body.layout === "emploi-du-temps") &&
    options.timetable &&
    !afficheur
  ) {
    const all = await options.timetable.listClasses();
    const wanted = body.timetableClassIds;
    timetableClasses = wanted?.length ? all.filter((c) => wanted.includes(c.id)) : all;
    if (timetableClasses.length === 0) {
      throw new CompositionError(
        "Aucune classe à afficher. Créez-en une avant de publier cette mise en page.",
      );
    }
  }

  const timetableUrl = afficheur
    ? `${baseUrl}/connectors/netypareo/${encodeURIComponent(afficheur)}`
    : (body.timetableUrl ?? options.timetableUrl);
  // L'adresse que les ÉCRANS appellent, résolue exactement comme celle des
  // médias : une adresse configurée si elle existe, sinon l'en-tête `Host`.
  // Deux chemins distincts finiraient par diverger, et les actualités
  // deviendraient injoignables sur une installation où les médias marchent.
  const actualitesUrl = `${baseUrl}/connectors/news`;
  const identite = await options.identite?.lire();
  // Le corps porte des IDENTIFIANTS d'afficheurs, la composition porte leurs
  // adresses résolues. Même nom, deux formes : on retire le premier plutôt
  // que de laisser le hasard de l'ordre des propriétés en décider.
  const { timetableAfficheurs: _choisis, ...reste } = body;
  return {
    ...(identite ? { identite } : {}),
    ...reste,
    ...(afficheursRetenus.length > 0 ? { timetableAfficheurs: afficheursRetenus } : {}),
    ...(timetableUrl !== undefined ? { timetableUrl } : {}),
    ...(actualitesUrl !== undefined ? { actualitesUrl } : {}),
    ...(timetableClasses ? { timetableClasses } : {}),
  };
}

/**
 * L'adresse à inscrire dans les manifestes.
 *
 * Configurée de préférence. À défaut, on retombe sur l'en-tête `Host` — utile
 * en développement sur une seule machine, faux dès qu'il y en a deux.
 */
function resolvePublicUrl(configured: string | undefined, host: string | undefined): string {
  return configured ?? `http://${host ?? "localhost:3000"}`;
}
