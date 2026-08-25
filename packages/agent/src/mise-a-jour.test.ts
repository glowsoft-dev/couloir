import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { VersionDuLecteur } from "@couloir/protocol";
import type { NetPort, UpdatePort } from "./ports.js";
import { mettreAJourLeLecteur, verifierLeDemarrage } from "./mise-a-jour.js";

/*
 * La mise à jour du lecteur.
 *
 * Chaque chemin d'échec compte double : ce n'est pas une image qu'on rate,
 * c'est le programme qui affiche les images. Un couloir noir ne se rallume
 * qu'en montant à l'échelle.
 */

const octets = (texte: string) => new TextEncoder().encode(texte);
const sha = (texte: string) => createHash("sha256").update(octets(texte)).digest("hex");

function faussePorte(installee: string | null = "v1") {
  const etat = { installee, pose: null as null | { version: string; noms: string[] }, rates: 0 };
  const update: UpdatePort = {
    versionInstallee: async () => etat.installee,
    installer: async (version, fichiers) => {
      etat.pose = { version, noms: fichiers.map((f) => f.nom) };
      etat.installee = version;
    },
    revenirEnArriere: async () => true,
    demarragesRates: async () => etat.rates,
    marquerDemarrageReussi: async () => {
      etat.rates = 0;
    },
  };
  return { etat, update };
}

function fauxReseau(servie: VersionDuLecteur | null, contenus: Record<string, string>) {
  return {
    fetchVersionDuLecteur: async () => servie,
    fetchFichierDuLecteur: async (nom: string) => {
      if (!(nom in contenus)) throw new Error(`HTTP 404 pour ${nom}`);
      return octets(contenus[nom]!);
    },
  } as unknown as NetPort;
}

describe("mettreAJourLeLecteur", () => {
  it("pose la version servie quand elle diffère", async () => {
    const { etat, update } = faussePorte("v1");
    const net = fauxReseau(
      { version: "v2", fichiers: [{ nom: "p.mjs", sha256: sha("neuf"), octets: 4 }] },
      { "p.mjs": "neuf" },
    );

    const resultat = await mettreAJourLeLecteur(net, update, { deviceId: "hall" });

    expect(resultat).toEqual({ fait: "installee", version: "v2" });
    expect(etat.pose).toEqual({ version: "v2", noms: ["p.mjs"] });
  });

  it("ne bouge pas quand la version est la même", async () => {
    const { etat, update } = faussePorte("v2");
    const net = fauxReseau(
      { version: "v2", fichiers: [{ nom: "p.mjs", sha256: sha("neuf"), octets: 4 }] },
      { "p.mjs": "neuf" },
    );

    expect(await mettreAJourLeLecteur(net, update, { deviceId: "hall" })).toMatchObject({
      fait: "rien",
    });
    expect(etat.pose).toBeNull();
  });

  it("refuse un contenu dont l'empreinte ne correspond pas", async () => {
    /*
     * Le cas qui justifie tout le reste : un portail captif répond 200 avec
     * une page de connexion. Bonne apparence, mauvais contenu — et sans ce
     * contrôle, on écraserait le lecteur avec du HTML.
     */
    const { etat, update } = faussePorte("v1");
    const net = fauxReseau(
      { version: "v2", fichiers: [{ nom: "p.mjs", sha256: sha("neuf"), octets: 4 }] },
      { "p.mjs": "<html>portail captif</html>" },
    );

    const resultat = await mettreAJourLeLecteur(net, update, { deviceId: "hall" });

    expect(resultat).toMatchObject({ fait: "echec" });
    expect(etat.pose).toBeNull();
    expect(etat.installee).toBe("v1");
  });

  it("n'installe rien si un seul des fichiers manque", async () => {
    // Poser la moitié d'un lecteur est pire que ne rien poser.
    const { etat, update } = faussePorte("v1");
    const net = fauxReseau(
      {
        version: "v2",
        fichiers: [
          { nom: "p.mjs", sha256: sha("un"), octets: 2 },
          { nom: "c.js", sha256: sha("deux"), octets: 4 },
        ],
      },
      { "p.mjs": "un" },
    );

    expect(await mettreAJourLeLecteur(net, update, { deviceId: "hall" })).toMatchObject({
      fait: "echec",
    });
    expect(etat.pose).toBeNull();
  });

  it("ne fait rien quand le serveur n'annonce pas de version", async () => {
    // Un serveur plus ancien que le boîtier ne doit surtout pas déclencher un
    // remplacement.
    const { etat, update } = faussePorte("v1");
    expect(
      await mettreAJourLeLecteur(fauxReseau(null, {}), update, { deviceId: "hall" }),
    ).toMatchObject({ fait: "rien" });
    expect(etat.pose).toBeNull();
  });

  it("ne fait rien quand le serveur est injoignable", async () => {
    const { update } = faussePorte("v1");
    const net = {
      fetchVersionDuLecteur: async () => {
        throw new Error("réseau coupé");
      },
    } as unknown as NetPort;

    expect(await mettreAJourLeLecteur(net, update, { deviceId: "hall" })).toMatchObject({
      fait: "rien",
    });
  });

  it("ne fait rien sur une plateforme sans mise à jour", async () => {
    const net = fauxReseau({ version: "v2", fichiers: [] } as never, {});
    expect(await mettreAJourLeLecteur(net, undefined, { deviceId: "hall" })).toMatchObject({
      fait: "rien",
      pourquoi: "plateforme sans mise à jour",
    });
  });

  it("attend son rang avant de télécharger", async () => {
    /*
     * L'attente vient AVANT le téléchargement : attendre après ferait
     * basculer tous les boîtiers ensemble malgré tout.
     */
    const { update } = faussePorte("v1");
    const attendre = vi.fn(async () => {});
    const net = fauxReseau(
      { version: "v2", fichiers: [{ nom: "p.mjs", sha256: sha("neuf"), octets: 4 }] },
      { "p.mjs": "neuf" },
    );

    await mettreAJourLeLecteur(net, update, {
      deviceId: "hall",
      fenetreDeBasculeMs: 600_000,
      attendre,
    });

    expect(attendre).toHaveBeenCalledOnce();
    expect(attendre.mock.calls[0]![0]).toBeGreaterThan(0);
  });
});

describe("verifierLeDemarrage", () => {
  it("laisse passer un premier démarrage raté", async () => {
    const update = { ...faussePorte().update, demarragesRates: async () => 1 };
    expect(await verifierLeDemarrage(update)).toEqual({ revenu: false });
  });

  it("revient en arrière au deuxième", async () => {
    const update = { ...faussePorte().update, demarragesRates: async () => 2 };
    expect(await verifierLeDemarrage(update)).toEqual({ revenu: true });
  });

  it("ne revient nulle part quand il n'y a pas de version précédente", async () => {
    const update = {
      ...faussePorte().update,
      demarragesRates: async () => 5,
      revenirEnArriere: async () => false,
    };
    expect(await verifierLeDemarrage(update)).toEqual({ revenu: false });
  });
});
