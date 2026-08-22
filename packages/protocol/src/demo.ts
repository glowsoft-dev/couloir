import type { Manifest } from "./manifest.js";

/**
 * Un manifeste de référence, valide et complet.
 *
 * Il sert de jeu d'essai partagé : le serveur s'en sert pour amorcer un écran
 * de démonstration, le noyau de rendu pour son harnais de développement, et
 * les tests des deux côtés pour vérifier qu'ils parlent bien de la même chose.
 *
 * Il décrit le hall du bâtiment A : le contenu éditorial en grand, les cours
 * dans une colonne, un bandeau en bas, et une playlist de repli pour les
 * longues coupures.
 */
export function demoManifest(screenId: string, version = 1): Manifest {
  return {
    schemaVersion: 1,
    screenId,
    version,
    issuedAt: "2026-08-21T06:00:00Z",
    settings: {
      pollIntervalSec: 60,
      cacheBudgetBytes: 8 * 1024 ** 3,
      offlineGraceDays: 7,
      timezone: "Europe/Paris",
      displayOff: [{ daysOfWeek: [1, 2, 3, 4, 5], from: "20:00", to: "06:00" }],
      showScreenCodeWatermark: true,
    },
    layout: {
      id: "deux-tiers-un-tiers",
      orientation: "landscape",
      zones: [
        {
          id: "principal",
          rect: { xPercent: 0, yPercent: 0, widthPercent: 66, heightPercent: 91 },
          playlistId: "rotation-generale",
        },
        {
          id: "cours",
          rect: { xPercent: 66, yPercent: 0, widthPercent: 34, heightPercent: 91 },
          playlistId: "colonne-cours",
        },
        {
          id: "bandeau",
          rect: { xPercent: 0, yPercent: 91, widthPercent: 100, heightPercent: 9 },
          playlistId: "bandeau",
        },
      ],
    },
    playlists: [
      { id: "rotation-generale", slideIds: ["actu-du-jour", "affiche-portes-ouvertes", "mise-a-lhonneur"] },
      { id: "colonne-cours", slideIds: ["cours-du-jour"] },
      { id: "bandeau", slideIds: ["ticker"] },
      { id: "repli", slideIds: ["repli-identite"] },
    ],
    slides: [
      { kind: "data", id: "actu-du-jour", sourceId: "actus-site", view: "news-list", params: {}, durationMs: 14_000 },
      { kind: "media", id: "affiche-portes-ouvertes", assetId: "affiche-po-2026", durationMs: 9_000 },
      {
        kind: "template",
        id: "mise-a-lhonneur",
        templateId: "mise-a-lhonneur",
        fields: {
          eyebrow: "Concours national",
          titre: "Deux élèves de terminale sur le podium",
          texte: "Félicitations à l'équipe du club robotique, deuxième au concours national de Nantes.",
        },
        assetIds: [],
        durationMs: 11_000,
      },
      { kind: "data", id: "cours-du-jour", sourceId: "edt", view: "timetable-day", params: {}, durationMs: 20_000 },
      {
        kind: "widget",
        id: "ticker",
        widget: "ticker",
        config: { text: "Conseil de classe des terminales jeudi 17 · Inscriptions au voyage à Berlin jusqu'au 30 septembre · Le CDI ferme à 17 h cette semaine" },
        durationMs: 30_000,
      },
      {
        kind: "template",
        id: "repli-identite",
        templateId: "identite-ecole",
        fields: { eyebrow: "Bienvenue", titre: "Bâtiment A", texte: "Hall central, face à l'accueil." },
        assetIds: [],
        durationMs: 20_000,
      },
    ],
    assets: [
      {
        id: "affiche-po-2026",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        bytes: 842_113,
        mime: "image/jpeg",
        url: "http://localhost:3000/v1/assets/affiche-po-2026",
        urlExpiresAt: "2026-08-22T06:00:00Z",
      },
    ],
    dataSources: [
      {
        id: "edt",
        kind: "timetable",
        url: "http://localhost:3000/connectors/timetable",
        ttlSec: 900,
        // Un emploi du temps de plus de quatre heures se retire de lui-même
        // plutôt que de laisser croire qu'il est à jour.
        maxStaleSec: 14_400,
        stalePolicy: "hide",
      },
      {
        id: "actus-site",
        kind: "news",
        url: "http://localhost:3000/connectors/news",
        ttlSec: 1_800,
        maxStaleSec: 604_800,
        stalePolicy: "keep-with-date",
      },
    ],
    schedules: [
      { id: "s-principal", zoneId: "principal", playlistId: "rotation-generale", priority: 0 },
      { id: "s-cours", zoneId: "cours", playlistId: "colonne-cours", priority: 0 },
      { id: "s-bandeau", zoneId: "bandeau", playlistId: "bandeau", priority: 0 },
    ],
    emergency: null,
    fallbackPlaylistId: "repli",
  };
}
