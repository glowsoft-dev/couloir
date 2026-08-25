import type { PublishSpec, ScreenStatus } from "./api.js";

/**
 * Où passe chaque média.
 *
 * La bibliothèque grossit vite : une affiche de portes ouvertes, sa version
 * corrigée, celle de l'an dernier. Sans cette colonne, plus personne ne sait
 * laquelle tourne encore, et on n'ose plus rien retirer.
 *
 * On lit les compositions saisies et non les manifestes : le manifeste a déjà
 * résolu le contenu par défaut en diapositive, et on ne distinguerait plus
 * « il tourne dans la rotation » de « il attend qu'il n'y ait rien d'autre ».
 * Les deux comptent — un média qui ne sert que de repli passe quand même.
 */

export function usageDesMedias(
  screens: readonly ScreenStatus[],
  compositions: Record<string, PublishSpec | null> | undefined,
): Map<string, ScreenStatus[]> {
  const usage = new Map<string, ScreenStatus[]>();

  const noter = (assetId: string | undefined, screen: ScreenStatus) => {
    if (!assetId) return;
    const déjà = usage.get(assetId);
    // Un média posé deux fois sur le même écran — dans la rotation ET en
    // repli — ne le compte qu'une fois : c'est un écran, pas deux.
    if (déjà) {
      if (!déjà.some((s) => s.id === screen.id)) déjà.push(screen);
    } else {
      usage.set(assetId, [screen]);
    }
  };

  for (const screen of screens) {
    const spec = compositions?.[screen.id];
    if (!spec) continue;
    for (const item of spec.items) noter(item.assetId, screen);
    noter(spec.parDefaut?.assetId, screen);
  }

  return usage;
}

/** « sur 5 écrans », « sur 1 écran », « nulle part ». */
export function phraseDUsage(nombre: number): string {
  if (nombre === 0) return "nulle part";
  return nombre === 1 ? "sur 1 écran" : `sur ${nombre} écrans`;
}
