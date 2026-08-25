import type { Manifest } from "@couloir/protocol";

/**
 * Ce que contenait une publication, en une ligne.
 *
 * L'historique disait « v4, hier à 16:41 ». Devant trois versions d'une même
 * journée, ça ne dit pas laquelle remettre en ligne. On relit donc le
 * document déjà enregistré — rien à stocker de plus — pour en tirer ce qu'un
 * humain reconnaîtrait : combien de contenus tournaient, et si le bandeau et
 * la colonne des cours étaient là.
 *
 * On compte les diapositives et non les zones : c'est ce qu'on a composé.
 * Les diapositives d'emploi du temps et le bandeau en sont retirés, sans quoi
 * « 5 contenus » désignerait deux affiches et trois colonnes de cours.
 */
export function resumeDePublication(manifest: Manifest): string {
  const cours = new Set(
    manifest.slides.filter((s) => s.kind === "data" && s.view.startsWith("timetable")).map((s) => s.id),
  );
  const bandeaux = new Set(manifest.slides.filter((s) => s.kind === "widget").map((s) => s.id));

  /*
   * Le repli n'est pas un contenu.
   *
   * Le composeur y pose la carte d'identité de l'écran, que personne n'a
   * choisie : la compter ferait dire « 2 contenus » à une publication qui en
   * porte un. On ne retient donc que ce qui tourne hors du repli.
   */
  const composés = new Set(
    manifest.playlists
      .filter((p) => p.id !== manifest.fallbackPlaylistId)
      .flatMap((p) => p.slideIds),
  );

  const contenus = manifest.slides.filter(
    (s) => composés.has(s.id) && !cours.has(s.id) && !bandeaux.has(s.id),
  ).length;

  const morceaux: string[] = [
    contenus === 0 ? "aucun contenu" : `${contenus} contenu${contenus > 1 ? "s" : ""}`,
  ];
  if (cours.size > 0) morceaux.push("emploi du temps");
  if (bandeaux.size > 0) morceaux.push("bandeau");
  return morceaux.join(", ");
}
