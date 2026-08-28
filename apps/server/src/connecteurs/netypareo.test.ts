import { describe, expect, it } from "vitest";
import { precision, separerLignes, versDateIso, versHeure, decoderEntites } from "./netypareo.js";

/**
 * L'adaptateur NetYPareo.
 *
 * On ne teste pas la récupération réseau — elle dépend d'un serveur qu'on ne
 * contrôle pas — mais les trois traductions qui se glissent entre le
 * logiciel de gestion et la dalle. Chacune échoue silencieusement quand elle
 * échoue : une heure mal lue s'affiche quand même, et personne ne s'en
 * aperçoit avant qu'un élève ne se présente à la mauvaise heure.
 */

describe("les heures", () => {
  it("traduisent la notation française", () => {
    expect(versHeure("08h30")).toBe("08:30");
    expect(versHeure("13h30")).toBe("13:30");
    expect(versHeure("9h05")).toBe("09:05");
  });

  it("acceptent une heure pile sans minutes", () => {
    expect(versHeure("8h")).toBe("08:00");
  });

  it("retombent sur les minutes depuis minuit si la notation surprend", () => {
    // NetYPareo fournit les deux représentations : l'une rattrape l'autre.
    expect(versHeure("huit heures et demie", 510)).toBe("08:30");
    expect(versHeure("???", 1110)).toBe("18:30");
  });

  it("ne fabriquent pas une heure à partir de rien", () => {
    // Mieux vaut rendre l'entrée telle quelle que d'inventer « 00:00 » :
    // une heure fausse est pire qu'une heure visiblement bizarre.
    expect(versHeure("indisponible")).toBe("indisponible");
  });
});

describe("les dates", () => {
  it("traduisent le format français", () => {
    expect(versDateIso("24/08/2026")).toBe("2026-08-24");
    expect(versDateIso("01/01/2027")).toBe("2027-01-01");
  });

  it("refusent ce qui n'est pas une date", () => {
    expect(versDateIso("2026-08-24")).toBeNull();
    expect(versDateIso("")).toBeNull();
  });
});

describe("la précision sous l'intitulé", () => {
  it("garde le module seul quand il n'y a pas de commentaire", () => {
    expect(precision("Architectures de données décisionnelles", "")).toBe(
      "Architectures de données décisionnelles",
    );
  });

  it("ajoute un commentaire court", () => {
    expect(precision("AC3.1 Portefeuille", "Bureautique appliquée")).toBe(
      "AC3.1 Portefeuille · Bureautique appliquée",
    );
  });

  it("laisse tomber un commentaire qui ne tiendrait pas", () => {
    // Le premier jet le versait dans la pastille « salle changée » : un
    // paragraphe entier s'y déployait et poussait la journée hors de l'écran.
    const long =
      "Prépa Powerpoint pour l'oral du Bloc 3 : présentation orale des livrables du Bloc 3";
    expect(precision("ACBloc3 Evaluations", long)).toBe("ACBloc3 Evaluations");
  });

  it("ne répète pas le module quand le commentaire le redit", () => {
    expect(precision("Anglais professionnel", "anglais PROFESSIONNEL")).toBe(
      "Anglais professionnel",
    );
  });

  it("ne rend rien plutôt qu'une ligne vide", () => {
    expect(precision("", "  ")).toBeUndefined();
  });

  it("réduit les blancs et les retours à la ligne", () => {
    expect(precision("Module", "deux\r\nlignes")).toBe("Module · deux lignes");
  });
});

describe("la séparation salle / enseignant", () => {
  it("reconnaît l'enseignant à sa civilité, pas à sa position", () => {
    // Se fier à l'ordre ferait passer une salle pour un nom le jour où
    // l'enseignant n'est pas renseigné.
    expect(separerLignes(["CCI SALLE A21", "M. TORRES J."])).toEqual({
      room: "CCI SALLE A21",
      teacher: "M. TORRES J.",
    });
    expect(separerLignes(["Mme CABANNES C.", "A distance"])).toEqual({
      room: "A distance",
      teacher: "Mme CABANNES C.",
    });
  });

  it("regroupe plusieurs salles", () => {
    expect(separerLignes(["CCI SALLE B01, CCI SALLE C06", "M. COLLARD S."]).room).toBe(
      "CCI SALLE B01, CCI SALLE C06",
    );
  });

  it("accepte une séance sans enseignant", () => {
    expect(separerLignes(["CCI SALLE B11"])).toEqual({ room: "CCI SALLE B11" });
  });

  it("ne laisse jamais la salle vide", () => {
    // Une colonne vide dans un couloir ressemble à une donnée perdue.
    expect(separerLignes([]).room).toBe("—");
    expect(separerLignes(["M. COLLARD S."]).room).toBe("—");
  });

  it("garde « A distance », qui n'est pas une salle mais se lit comme telle", () => {
    expect(separerLignes(["A distance", "Mme REGAN O."])).toEqual({
      room: "A distance",
      teacher: "Mme REGAN O.",
    });
  });
});

describe("decoderEntites", () => {
  it("décode l'espace insécable que NetYPareo laisse passer", () => {
    // « &nbsp; · Réunion Equipe Campus » s'affichait tel quel sur la dalle,
    // entité comprise. Personne dans un couloir ne sait lire ça.
    expect(decoderEntites("&nbsp; · Réunion Equipe Campus")).toBe("· Réunion Equipe Campus");
  });

  it("décode les entités nommées et numériques", () => {
    expect(decoderEntites("Fran&ccedil;ais &amp; math&eacute;matiques")).toBe(
      "Français & mathématiques",
    );
    expect(decoderEntites("caf&#233; &#x41;")).toBe("café A");
  });

  it("laisse intact ce qui n'est pas une entité", () => {
    expect(decoderEntites("BTS SIO 1 & 2")).toBe("BTS SIO 1 & 2");
    expect(decoderEntites("R&D")).toBe("R&D");
  });

  it("réduit les espaces multiples que le décodage laisse", () => {
    expect(decoderEntites("A&nbsp;&nbsp;&nbsp;B")).toBe("A B");
  });
});
