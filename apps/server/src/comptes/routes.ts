import "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { DUREE_SESSION_MS, type DepotComptes, type Utilisateur } from "./depot.js";
import { LONGUEUR_MINIMALE, problèmeDeMotDePasse } from "./mots-de-passe.js";
import { ROLES, type Pouvoir, peut } from "./roles.js";

/**
 * Les comptes, côté HTTP.
 *
 * Deux façons d'entrer, et une seule sert au quotidien :
 *
 *   — une session nommée, ouverte par mot de passe, portée par un cookie ;
 *   — le jeton partagé, qui ne donne plus accès qu'aux comptes.
 *
 * Le second est une clé de secours, pas un mode d'usage. Il crée le premier
 * administrateur d'une installation neuve, et rouvre la porte le jour où
 * l'unique administrateur a perdu son mot de passe. Il ne publie rien et ne
 * voit aucun écran : quelqu'un qui le connaîtrait ne peut pas s'en servir
 * pour afficher quoi que ce soit dans un couloir.
 */

const NOM_COOKIE = "couloir_session";

export const Connexion = z.object({
  courriel: z.string().min(3),
  motDePasse: z.string().min(1),
});

export const NouvelUtilisateur = z.object({
  courriel: z.string().email("Adresse électronique invalide."),
  nom: z.string().min(1, "Le nom ne peut pas être vide."),
  motDePasse: z.string().min(LONGUEUR_MINIMALE),
  role: z.enum(ROLES),
});

/** L'identité portée par une requête, une fois le garde passé. */
export interface Identité {
  utilisateur: Utilisateur | null;
  /** Vrai quand on est entré par la clé de secours. */
  clefDeSecours: boolean;
  /** Ce qu'on écrit dans le journal. */
  auteur: string;
}

declare module "fastify" {
  interface FastifyRequest {
    identité?: Identité;
  }
}

/**
 * Le pouvoir qu'exige une requête.
 *
 * Déduit du chemin et de la méthode plutôt que déclaré route par route :
 * une règle unique ne peut pas être oubliée en ajoutant une route, alors
 * qu'une annotation à recopier finit toujours par manquer quelque part.
 */
export function pouvoirRequis(méthode: string, chemin: string): Pouvoir {
  if (chemin.includes("/utilisateurs") || chemin.includes("/journal")) return "administrer";
  return méthode === "GET" || méthode === "HEAD" ? "consulter" : "publier";
}

function poserCookie(reply: FastifyReply, jeton: string, sécurisé: boolean): void {
  reply.setCookie(NOM_COOKIE, jeton, {
    path: "/",
    httpOnly: true,
    // `Strict` : le cookie ne part jamais depuis un autre site, ce qui règle
    // la falsification de requête sans avoir à porter un jeton anti-CSRF.
    sameSite: "strict",
    // Hors HTTPS, un cookie `Secure` n'est tout simplement pas posé — et la
    // console de développement deviendrait impossible à utiliser.
    secure: sécurisé,
    maxAge: Math.floor(DUREE_SESSION_MS / 1000),
  });
}

export interface OptionsComptes {
  depot: DepotComptes;
  prefixe: string;
  /** L'identité de l'établissement, montrée avant la connexion. */
  identite?: { lire: () => Promise<{ nom: string; accent: string | null }> };
  /** La clé de secours. Absente = seuls les comptes existants entrent. */
  clefDeSecours?: string;
  /** Faux en développement : un cookie `Secure` ne survit pas à HTTP. */
  cookieSécurisé: boolean;
}

export function enregistrerRoutesComptes(app: FastifyInstance, options: OptionsComptes): void {
  const { depot, prefixe } = options;

  // --- Entrer et sortir -------------------------------------------------

  app.post(`${prefixe}/session`, async (request, reply) => {
    const analyse = Connexion.safeParse(request.body);
    if (!analyse.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: "Adresse et mot de passe sont attendus.",
        retryable: false,
      });
    }

    const utilisateur = await depot.authentifier(analyse.data.courriel, analyse.data.motDePasse);
    if (!utilisateur) {
      // Le même message pour une adresse inconnue et un mot de passe faux.
      return reply.code(401).send({
        code: "identifiants-invalides",
        message: "Adresse ou mot de passe incorrect.",
        retryable: false,
      });
    }

    const agent = request.headers["user-agent"];
    const jeton = await depot.ouvrirSession(utilisateur.id, typeof agent === "string" ? agent : null);
    poserCookie(reply, jeton, options.cookieSécurisé);
    await depot.journaliser({
      utilisateurId: utilisateur.id,
      auteur: utilisateur.nom,
      action: "connexion",
    });
    return { utilisateur };
  });

  app.delete(`${prefixe}/session`, async (request, reply) => {
    const jeton = request.cookies[NOM_COOKIE];
    if (jeton) await depot.fermerSession(jeton);
    reply.clearCookie(NOM_COOKIE, { path: "/" });
    return { fermée: true };
  });

  app.get(`${prefixe}/moi`, async (request, reply) => {
    const identité = request.identité;
    if (!identité?.utilisateur) {
      return reply.code(401).send({
        code: "non-authentifie",
        message: "Aucune session ouverte.",
        retryable: false,
      });
    }
    return { utilisateur: identité.utilisateur };
  });

  /**
   * L'état de l'installation, avant toute authentification.
   *
   * Permet à la console de savoir s'il faut demander de se connecter ou de
   * créer le premier compte, sans laisser deviner autre chose.
   */
  app.get(`${prefixe}/amorce`, async () => ({
    comptesExistants: (await depot.compter()) > 0,
    /**
     * Le nom et la couleur de l'établissement, avant toute connexion.
     *
     * Publics, et il n'y a pas à hésiter : ce nom est écrit en grand sur
     * chaque écran de chaque couloir. Le taire à la page d'entrée
     * ne protégerait rien et donnerait une console qui ne sait pas chez qui
     * elle est.
     */
    ...(options.identite ? await options.identite.lire() : {}),
  }));

  // --- Le premier compte ------------------------------------------------

  app.post(`${prefixe}/utilisateurs/premier`, async (request, reply) => {
    if ((await depot.compter()) > 0) {
      return reply.code(409).send({
        code: "deja-amorce",
        message: "Un compte existe déjà. Connectez-vous, ou faites-vous créer un compte.",
        retryable: false,
      });
    }
    if (!request.identité?.clefDeSecours) {
      return reply.code(401).send({
        code: "clef-requise",
        message: "La création du premier compte demande la clé de secours du serveur.",
        retryable: false,
      });
    }

    const analyse = NouvelUtilisateur.safeParse({ ...(request.body as object), role: "administrateur" });
    if (!analyse.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: analyse.error.issues[0]?.message ?? "Compte incomplet.",
        retryable: false,
      });
    }
    const problème = problèmeDeMotDePasse(analyse.data.motDePasse);
    if (problème) {
      return reply.code(400).send({ code: "mot-de-passe-faible", message: problème, retryable: false });
    }

    const utilisateur = await depot.creer(analyse.data);
    await depot.journaliser({
      utilisateurId: utilisateur.id,
      auteur: utilisateur.nom,
      action: "création du premier compte",
      cible: utilisateur.courriel,
    });
    request.log.info({ courriel: utilisateur.courriel }, "premier administrateur créé");
    return { utilisateur };
  });

  // --- Les comptes ------------------------------------------------------

  app.get(`${prefixe}/utilisateurs`, async () => ({ utilisateurs: await depot.lister() }));

  app.post(`${prefixe}/utilisateurs`, async (request, reply) => {
    const analyse = NouvelUtilisateur.safeParse(request.body);
    if (!analyse.success) {
      return reply.code(400).send({
        code: "invalid-body",
        message: analyse.error.issues[0]?.message ?? "Compte incomplet.",
        retryable: false,
      });
    }
    const problème = problèmeDeMotDePasse(analyse.data.motDePasse);
    if (problème) {
      return reply.code(400).send({ code: "mot-de-passe-faible", message: problème, retryable: false });
    }

    try {
      const utilisateur = await depot.creer(analyse.data);
      await journaliserAction(request, depot, "création d'un compte", utilisateur.courriel, {
        role: utilisateur.role,
      });
      return { utilisateur };
    } catch (erreur) {
      if (String(erreur).includes("utilisateurs_courriel_key")) {
        return reply.code(409).send({
          code: "courriel-pris",
          message: "Un compte existe déjà avec cette adresse.",
          retryable: false,
        });
      }
      throw erreur;
    }
  });

  const Modification = z.object({
    role: z.enum(ROLES).optional(),
    actif: z.boolean().optional(),
    motDePasse: z.string().optional(),
  });

  app.patch<{ Params: { id: string } }>(`${prefixe}/utilisateurs/:id`, async (request, reply) => {
    const analyse = Modification.safeParse(request.body);
    if (!analyse.success) {
      return reply.code(400).send({ code: "invalid-body", message: "Modification invalide.", retryable: false });
    }

    const cible = await depot.parId(request.params.id);
    if (!cible) {
      return reply.code(404).send({ code: "inconnu", message: "Compte inconnu.", retryable: false });
    }

    const { role, actif, motDePasse } = analyse.data;

    /**
     * On ne se retire pas soi-même.
     *
     * Sans ce garde, le dernier administrateur peut se rétrograder ou se
     * désactiver, et plus personne ne peut créer de compte. La clé de secours
     * rattraperait le coup, mais il vaut mieux ne pas en arriver là.
     */
    const soiMême = request.identité?.utilisateur?.id === cible.id;
    if (soiMême && (role !== undefined || actif === false)) {
      return reply.code(409).send({
        code: "auto-retrait",
        message: "Vous ne pouvez pas modifier votre propre rôle ni vous désactiver.",
        retryable: false,
      });
    }

    if (motDePasse !== undefined) {
      const problème = problèmeDeMotDePasse(motDePasse);
      if (problème) {
        return reply.code(400).send({ code: "mot-de-passe-faible", message: problème, retryable: false });
      }
      await depot.changerMotDePasse(cible.id, motDePasse);
      await journaliserAction(request, depot, "changement de mot de passe", cible.courriel);
    }
    if (role !== undefined) {
      await depot.changerRole(cible.id, role);
      await journaliserAction(request, depot, "changement de rôle", cible.courriel, { role });
    }
    if (actif !== undefined) {
      await depot.definirActif(cible.id, actif);
      await journaliserAction(
        request,
        depot,
        actif ? "réactivation d'un compte" : "désactivation d'un compte",
        cible.courriel,
      );
    }

    return { utilisateur: await depot.parId(cible.id) };
  });

  // --- Le journal -------------------------------------------------------

  app.get(`${prefixe}/journal`, async () => ({ entrees: await depot.lireJournal() }));
}

/** Écrit une ligne au journal en la rattachant à qui a fait la requête. */
export async function journaliserAction(
  request: FastifyRequest,
  depot: DepotComptes,
  action: string,
  cible?: string,
  details?: unknown,
): Promise<void> {
  const identité = request.identité;
  await depot.journaliser({
    utilisateurId: identité?.utilisateur?.id ?? null,
    auteur: identité?.auteur ?? "inconnu",
    action,
    ...(cible !== undefined ? { cible } : {}),
    ...(details !== undefined ? { details } : {}),
  });
}

export { NOM_COOKIE, peut };
