import { X509Certificate } from "node:crypto";
import { request as requeteHttps } from "node:https";
import { connect as connexionTls, rootCertificates } from "node:tls";

/**
 * Récupérer un JSON, y compris derrière une chaîne de certificats incomplète.
 *
 * Beaucoup de serveurs scolaires n'envoient que leur propre certificat, sans
 * l'intermédiaire qui le relie à une autorité connue. Les navigateurs et
 * `curl` ne s'en aperçoivent pas : ils vont chercher l'intermédiaire manquant
 * à l'adresse que le certificat indique lui-même. Node, lui, refuse — et le
 * message qu'il rend, « unable to verify the first certificate », ne dit pas
 * à un administrateur d'établissement ce qu'il doit faire.
 *
 * On fait donc la même chose que les navigateurs, et **on ne baisse pas la
 * garde** : le certificat téléchargé ne sert qu'à compléter la chaîne, qui
 * reste vérifiée jusqu'à une racine du système. Un intermédiaire falsifié ne
 * remonterait à aucune racine connue et la connexion échouerait quand même —
 * c'est pourquoi le télécharger en clair ne coûte rien.
 *
 * La vraie correction est du côté du serveur : lui faire servir sa chaîne
 * complète. En attendant, personne ne devrait avoir à s'en occuper pour
 * afficher un emploi du temps dans un couloir.
 */

/** Un intermédiaire récupéré par hôte. Rare, et stable dans le temps. */
const intermediairesParHote = new Map<string, string | null>();

export interface ReponseJson {
  statut: number;
  corps: unknown;
  /** Vrai si la chaîne du serveur était incomplète et qu'on l'a complétée. */
  chaineCompletee: boolean;
}

function estChaineIncomplete(cause: unknown): boolean {
  const code = (cause as { cause?: { code?: string }; code?: string })?.cause?.code
    ?? (cause as { code?: string })?.code;
  return code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "SELF_SIGNED_CERT_IN_CHAIN";
}

/** L'adresse où le certificat dit que se trouve celui qui l'a signé. */
function adresseDeLEmetteur(pem: string): string | null {
  try {
    const acces = new X509Certificate(pem).infoAccess ?? "";
    const trouve = /CA Issuers - URI:(\S+)/.exec(acces);
    return trouve?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Ouvre la connexion sans vérifier, juste pour lire ce que le serveur présente. */
async function certificatPresente(hote: string, port: number): Promise<string | null> {
  return new Promise((resoudre) => {
    const socket = connexionTls(
      // On ne vérifie pas ici : on ne fait que regarder le certificat pour
      // savoir où trouver son émetteur. Aucune donnée n'est échangée, et la
      // vraie requête qui suit sera pleinement vérifiée.
      { host: hote, port, servername: hote, rejectUnauthorized: false, timeout: 8000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.destroy();
        resoudre(cert?.raw ? new X509Certificate(cert.raw).toString() : null);
      },
    );
    socket.on("error", () => resoudre(null));
    socket.on("timeout", () => {
      socket.destroy();
      resoudre(null);
    });
  });
}

/** Télécharge l'intermédiaire annoncé et le rend au format PEM. */
async function telechargerIntermediaire(url: string): Promise<string | null> {
  try {
    const reponse = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!reponse.ok) return null;
    const octets = Buffer.from(await reponse.arrayBuffer());
    // Les autorités distribuent tantôt du DER, tantôt du PEM.
    const texte = octets.toString("utf8");
    return new X509Certificate(texte.includes("BEGIN CERTIFICATE") ? texte : octets).toString();
  } catch {
    return null;
  }
}

async function intermediairePour(hote: string, port: number): Promise<string | null> {
  if (intermediairesParHote.has(hote)) return intermediairesParHote.get(hote) ?? null;

  const feuille = await certificatPresente(hote, port);
  const adresse = feuille ? adresseDeLEmetteur(feuille) : null;
  const pem = adresse ? await telechargerIntermediaire(adresse) : null;
  intermediairesParHote.set(hote, pem);
  return pem;
}

/** Une requête HTTPS ordinaire, avec une autorité supplémentaire. */
function getAvecCa(url: URL, ca: string, timeoutMs: number): Promise<ReponseJson> {
  return new Promise((resoudre, rejeter) => {
    const requete = requeteHttps(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { accept: "application/json", "user-agent": "Couloir/1.0 (affichage scolaire)" },
        // La chaîne reste vérifiée : on ajoute l'intermédiaire aux racines du
        // système, on ne remplace ni ne désactive rien.
        ca: [...rootCertificates, ca],
        timeout: timeoutMs,
      },
      (reponse) => {
        const morceaux: Buffer[] = [];
        reponse.on("data", (m: Buffer) => morceaux.push(m));
        reponse.on("end", () => {
          const texte = Buffer.concat(morceaux).toString("utf8");
          try {
            resoudre({
              statut: reponse.statusCode ?? 0,
              corps: texte ? JSON.parse(texte) : null,
              chaineCompletee: true,
            });
          } catch {
            resoudre({ statut: reponse.statusCode ?? 0, corps: null, chaineCompletee: true });
          }
        });
      },
    );
    requete.on("timeout", () => requete.destroy(new Error("délai dépassé")));
    requete.on("error", rejeter);
    requete.end();
  });
}

export async function recupererJson(url: URL, timeoutMs = 10_000): Promise<ReponseJson> {
  try {
    const reponse = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json", "user-agent": "Couloir/1.0 (affichage scolaire)" },
      redirect: "follow",
    });
    return {
      statut: reponse.status,
      corps: await reponse.json().catch(() => null),
      chaineCompletee: false,
    };
  } catch (cause) {
    if (!estChaineIncomplete(cause) || url.protocol !== "https:") throw cause;

    const port = Number(url.port || 443);
    const intermediaire = await intermediairePour(url.hostname, port);
    if (!intermediaire) throw cause;

    return getAvecCa(url, intermediaire, timeoutMs);
  }
}
