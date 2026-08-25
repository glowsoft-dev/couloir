import type { Manifest } from "@couloir/protocol";

/**
 * Le manifeste d'un aperçu d'emploi du temps.
 *
 * L'aperçu des changements du jour ne redessine pas la colonne des cours à
 * la main : il en fabrique un manifeste minuscule et le donne au vrai noyau
 * de rendu. Une imitation dériverait — le jour où la colonne change de
 * typographie ou de mention, l'aperçu montrerait l'ancienne, et c'est
 * exactement au moment où l'on vérifie une faute de frappe qu'il ne faut pas
 * mentir.
 *
 * L'écran n'existe pas : ce manifeste ne part sur aucun boîtier, il ne sert
 * qu'à faire tourner le rendu dans la console.
 */
export function manifesteApercuEdt(options: {
  classId: string;
  /** AAAA-MM-JJ. La source est interrogée pour ce jour-là. */
  date: string;
  nom?: string;
  accent?: string | null;
  /** Les colonnes montrées. Absent = toutes. */
  champs?: readonly string[];
  timezone?: string;
}): Manifest {
  const params: Record<string, string> = { classId: options.classId };
  if (options.champs) params["champs"] = options.champs.join(",");

  return {
    schemaVersion: 1,
    screenId: "apercu",
    version: 1,
    issuedAt: new Date(0).toISOString(),
    settings: {
      pollIntervalSec: 60,
      cacheBudgetBytes: 1,
      offlineGraceDays: 7,
      timezone: options.timezone ?? "Europe/Paris",
      // Aucune extinction : on regarde la journée, pas la dalle.
      displayOff: [],
      showScreenCodeWatermark: false,
      ...(options.nom || options.accent
        ? {
            branding: {
              ...(options.nom ? { nom: options.nom } : {}),
              ...(options.accent ? { accent: options.accent } : {}),
            },
          }
        : {}),
    },
    layout: {
      id: "apercu",
      orientation: "landscape",
      zones: [
        {
          id: "plein",
          rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
          playlistId: "cours",
        },
      ],
    },
    playlists: [{ id: "cours", slideIds: ["cours-du-jour"] }],
    slides: [
      {
        kind: "data",
        id: "cours-du-jour",
        sourceId: "edt",
        view: "timetable-day",
        params,
        durationMs: 20_000,
      },
    ],
    assets: [],
    dataSources: [
      {
        id: "edt",
        kind: "timetable",
        // Interrogée pour la journée regardée, et non pour aujourd'hui : sans
        // la date, feuilleter le calendrier montrerait cinq fois le même jour.
        url: `/v1/timetable/day?date=${options.date}`,
        ttlSec: 300,
        maxStaleSec: 3600,
        // La journée porte sa date : périmée, le noyau la retire de lui-même.
        stalePolicy: "keep-with-date",
      },
    ],
    schedules: [{ id: "toujours", zoneId: "plein", playlistId: "cours", priority: 0 }],
    emergency: null,
    fallbackPlaylistId: "cours",
  };
}

/**
 * L'instant à jouer pour voir une journée donnée.
 *
 * Midi, en heure locale du navigateur. Le noyau écarte un emploi du temps
 * dont la date n'est pas celle du jour joué ; regarder demain suppose donc
 * de lui donner demain comme instant. Midi plutôt que minuit : on tombe au
 * milieu de la journée, loin des bascules de fuseau et des plages
 * d'extinction du soir.
 */
export function midiDe(date: string): number {
  return new Date(`${date}T12:00:00`).getTime();
}
