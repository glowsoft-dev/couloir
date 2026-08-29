import type { ResolutionEcran } from "@couloir/protocol";

/**
 * Ce qu'on écrit au journal quand la dalle se présente.
 *
 * Le boîtier ne peut rien corriger tout seul ici : si le navigateur tourne
 * en fenêtre, c'est le lanceur du kiosque ou le compositeur qu'il faut
 * reprendre, pas le rendu. Le seul geste utile est donc de le dire, assez
 * clairement pour qu'on n'ait pas à monter sur une échelle pour le
 * découvrir.
 */
export function journalDeResolution(resolution: ResolutionEcran): {
  level: "info" | "warn";
  code: string;
  message: string;
  context: Record<string, unknown>;
} {
  const dalle =
    resolution.largeurDallePx > 0
      ? `${resolution.largeurDallePx}×${resolution.hauteurDallePx}`
      : "inconnue";
  const vue = `${resolution.largeurPx}×${resolution.hauteurPx}`;

  if (!resolution.pleinEcran) {
    return {
      level: "warn",
      code: "affichage.fenetre",
      /*
       * Le message porte les deux tailles.
       *
       * « Le kiosque n'est pas en plein écran » laisserait chercher : sur
       * quelle dalle, et de combien ? Avec les deux nombres, on sait tout de
       * suite s'il manque une barre de tâches ou la moitié de l'écran.
       */
      message: `Le navigateur n'occupe pas toute la dalle : ${vue} affiché sur ${dalle}.`,
      context: { ...resolution },
    };
  }

  return {
    level: "info",
    code: "affichage.resolution",
    message:
      resolution.densite > 1
        ? `Dalle ${vue} en densité ${resolution.densite}.`
        : `Dalle ${vue}.`,
    context: { ...resolution },
  };
}
