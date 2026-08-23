import { describe, expect, it } from "vitest";
import { enTexte, lireFlux, raccourcir } from "./actualites.js";

/**
 * Le connecteur d'actualités.
 *
 * On ne teste pas ici la récupération réseau — elle dépend d'un site qu'on ne
 * contrôle pas — mais les trois transformations qui se glissent entre le site
 * et la dalle, et qui échouent silencieusement quand elles échouent : du HTML
 * qui passerait tel quel, un extrait coupé au milieu d'un mot, un flux dont
 * la forme varie d'un moteur à l'autre.
 */

describe("le passage en texte", () => {
  it("retire les balises", () => {
    // Sinon « <p> » s'affiche en grand au-dessus d'un escalier.
    expect(enTexte("<p>Portes <strong>ouvertes</strong></p>")).toBe("Portes ouvertes");
  });

  it("décode les entités que WordPress produit", () => {
    expect(enTexte("Rentr&eacute;e des &#233;l&egrave;ves")).toBe("Rentrée des élèves");
    expect(enTexte("L&#8217;association")).toBe("L’association");
    expect(enTexte("Maths &amp; sciences")).toBe("Maths & sciences");
  });

  it("réduit les blancs, retours à la ligne compris", () => {
    expect(enTexte("Conseil\n\n  de   classe\t")).toBe("Conseil de classe");
  });

  it("ne laisse pas une entité inconnue à l'écran", () => {
    // Mieux vaut une espace qu'un « &zwnj; » affiché en quarante points.
    expect(enTexte("Avant&zwnj;après")).toBe("Avant après");
  });
});

describe("le raccourcissement", () => {
  it("laisse un texte court intact", () => {
    expect(raccourcir("Conseil de classe jeudi.")).toBe("Conseil de classe jeudi.");
  });

  it("coupe entre deux mots, jamais au milieu d'un", () => {
    // On lit un écran de couloir en marchant : un mot tronqué se remarque.
    const long = "Les portes ouvertes auront lieu samedi douze septembre de neuf heures à dix-sept heures dans tous les ateliers de l'établissement ainsi que dans la cour nord.";
    const court = raccourcir(long, 60);
    expect(court.endsWith("…")).toBe(true);
    expect(court.length).toBeLessThanOrEqual(61);
    expect(long.startsWith(court.slice(0, -1))).toBe(true);
    expect(court.slice(0, -1).trimEnd().split(" ").at(-1)).not.toBe("septemb");
  });
});

describe("la lecture d'un flux", () => {
  const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Le site de l'école</title>
  <item>
    <title><![CDATA[Portes ouvertes le 12 septembre]]></title>
    <link>https://ecole.fr/portes-ouvertes</link>
    <description><![CDATA[<p>Visite des ateliers de 9&nbsp;h à 17&nbsp;h.</p>]]></description>
    <category>Vie de l'école</category>
    <pubDate>Mon, 01 Sep 2026 08:00:00 +0200</pubDate>
    <enclosure url="https://ecole.fr/affiche.jpg" length="12345" type="image/jpeg"/>
  </item>
  <item>
    <title>Conseil de classe</title>
    <link>https://ecole.fr/conseil</link>
    <description>Jeudi 18 à 18 h.</description>
    <category>Non classé</category>
  </item>
</channel></rss>`;

  const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Voyage en Italie</title>
    <link rel="alternate" href="https://ecole.fr/voyage"/>
    <summary>Inscriptions jusqu'au 30 septembre.</summary>
    <published>2026-09-02T10:00:00Z</published>
  </entry>
</feed>`;

  it("lit un flux RSS", () => {
    const [premier, second] = lireFlux(RSS, 10);

    expect(premier!.titre).toBe("Portes ouvertes le 12 septembre");
    expect(premier!.extrait).toBe("Visite des ateliers de 9 h à 17 h.");
    expect(premier!.categorie).toBe("Vie de l'école");
    expect(premier!.image).toBe("https://ecole.fr/affiche.jpg");
    expect(second!.titre).toBe("Conseil de classe");
  });

  it("lit un flux Atom, dont l'adresse est dans un attribut", () => {
    const [entrée] = lireFlux(ATOM, 10);
    expect(entrée!.titre).toBe("Voyage en Italie");
    expect(entrée!.extrait).toBe("Inscriptions jusqu'au 30 septembre.");
  });

  it("écarte « Non classé », le défaut de WordPress", () => {
    // L'afficher n'apprend rien à personne et mange une ligne.
    expect(lireFlux(RSS, 10)[1]!.categorie).toBeUndefined();
  });

  it("respecte le nombre demandé", () => {
    expect(lireFlux(RSS, 1)).toHaveLength(1);
  });

  it("ne rend rien plutôt que du vide sur un document qui n'est pas un flux", () => {
    expect(lireFlux("<html><body>Page introuvable</body></html>", 5)).toEqual([]);
  });

  it("saute une entrée sans titre au lieu d'afficher une carte vide", () => {
    const boiteux = `<rss><channel>
      <item><description>Sans titre</description></item>
      <item><title>Avec titre</title></item>
    </channel></rss>`;
    const articles = lireFlux(boiteux, 10);
    expect(articles).toHaveLength(1);
    expect(articles[0]!.titre).toBe("Avec titre");
  });
});
