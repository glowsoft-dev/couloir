import { z } from "zod";
import { IsoDateTime, Orientation, ScreenId, Sha256 } from "./common.js";
import { VideoCodec } from "./capabilities.js";

/**
 * Le manifeste : tout ce qu'un écran doit afficher, figé et versionné.
 *
 * C'est la pièce centrale du protocole. Le serveur décide, le player exécute
 * avec ce qu'il a en local. Le manifeste est autoportant : il contient la
 * liste complète des fichiers nécessaires, si bien que l'agent peut calculer
 * hors ligne ce qui lui manque encore.
 *
 * Règle d'or : on ne bascule sur une nouvelle version que lorsque 100 % des
 * médias requis sont présents et vérifiés localement. Sinon on continue la
 * version précédente — jamais de trou à l'écran.
 */

/** Un fichier à télécharger et à garder en cache. */
export const AssetRef = z.object({
  id: z.string(),
  /** Vérifiée après téléchargement : un fichier corrompu n'est jamais joué. */
  sha256: Sha256,
  bytes: z.number().int().nonnegative(),
  mime: z.string(),
  /** URL signée, à durée de vie limitée. Supporte les requêtes Range. */
  url: z.string().url(),
  urlExpiresAt: IsoDateTime,
  /** Renseigné pour les vidéos : sert à tracer le dérivé retenu. */
  video: z
    .object({ codec: VideoCodec, heightPx: z.number().int().positive(), durationMs: z.number().int().positive() })
    .optional(),
});
export type AssetRef = z.infer<typeof AssetRef>;

/**
 * Que faire d'une donnée vivante devenue périmée.
 * Chaque source choisit : c'est ce qui évite d'afficher un emploi du temps
 * d'hier comme s'il était celui d'aujourd'hui.
 */
export const StalePolicy = z.enum([
  /** On garde à l'écran, en affichant la date de dernière mise à jour. */
  "keep-with-date",
  /** On retire le bloc de la rotation. */
  "hide",
  /** On remplace par le contenu de repli de la source. */
  "fallback",
]);
export type StalePolicy = z.infer<typeof StalePolicy>;

/** Une source de données rafraîchie en continu (cours, actualités, météo…). */
export const DataSourceRef = z.object({
  id: z.string(),
  kind: z.enum(["timetable", "news", "weather", "menu", "transit", "social", "custom"]),
  url: z.string().url(),
  /** Fréquence de rafraîchissement souhaitée quand tout va bien. */
  ttlSec: z.number().int().positive(),
  /** Au-delà, la donnée est considérée périmée et la politique s'applique. */
  maxStaleSec: z.number().int().positive(),
  stalePolicy: StalePolicy,
});
export type DataSourceRef = z.infer<typeof DataSourceRef>;

/** Une diapositive. Le rendu est identique sur toutes les plateformes. */
/**
 * La période pendant laquelle une diapositive fait partie de la rotation.
 *
 * Absente, elle passe toujours. C'est le cas courant, et il ne coûte rien.
 *
 * Attachée à la DIAPOSITIVE et non à la playlist, délibérément : une affiche
 * de portes ouvertes doit REJOINDRE la rotation du 1er au 15 septembre, pas
 * s'y substituer. Le mécanisme de programmation existant, qui fait occuper
 * une zone par une playlist entière, aurait fait disparaître tout le reste
 * pendant la quinzaine.
 *
 * C'est l'écran qui décide, pas le serveur au moment de publier : un boîtier
 * coupé du réseau pendant une semaine doit voir arriver et repartir ses
 * affiches tout seul.
 */
export const Visibility = z.object({
  /** Premier instant d'affichage. Absent = depuis toujours. */
  startsAt: IsoDateTime.optional(),
  /** Dernier instant. Absent = pour toujours. */
  endsAt: IsoDateTime.optional(),
  /** 1 = lundi … 7 = dimanche. Vide ou absent = tous les jours. */
  daysOfWeek: z.array(z.number().int().min(1).max(7)).optional(),
  /** Heure locale de l'école, format HH:MM. Passe minuit si fin < début. */
  dailyStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  dailyEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});
export type Visibility = z.infer<typeof Visibility>;

export const Slide = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("media"),
    id: z.string(),
    assetId: z.string(),
    visibility: Visibility.optional(),
    /**
     * Comment l'image occupe sa zone.
     *
     * `entier` par défaut : l'image tient en entier, quitte à laisser des
     * bandes. `remplir` la fait couvrir toute la zone, en rognant les bords.
     *
     * Le défaut n'est pas neutre. Une affiche est faite pour une dalle
     * entière ; posée dans une colonne de deux tiers, « remplir » lui coupe
     * les côtés — et c'est le titre qui part en premier. Perdre du texte est
     * pire qu'une bande de fond.
     */
    fit: z.enum(["entier", "remplir"]).optional(),
    /** Absent pour une vidéo : elle dure le temps qu'elle dure. */
    durationMs: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("template"),
    id: z.string(),
    templateId: z.string(),
    visibility: Visibility.optional(),
    fields: z.record(z.union([z.string(), z.number(), z.boolean()])),
    /** Médias référencés par les champs, à télécharger comme les autres. */
    assetIds: z.array(z.string()).default([]),
    durationMs: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("widget"),
    id: z.string(),
    visibility: Visibility.optional(),
    widget: z.enum(["clock", "weather", "ticker", "menu", "transit", "countdown", "social"]),
    config: z.record(z.unknown()).default({}),
    durationMs: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("data"),
    id: z.string(),
    visibility: Visibility.optional(),
    sourceId: z.string(),
    view: z.enum(["timetable-day", "timetable-room", "timetable-next", "news-list", "news-single"]),
    /**
     * Sélecteur dans la charge utile de la source.
     *
     * Un écran qui fait défiler trente classes partage UNE source et trente
     * diapositives qui y piochent — plutôt que trente sources interrogées
     * séparément par l'agent.
     */
    params: z.record(z.string()).default({}),
    durationMs: z.number().int().positive(),
  }),
]);
export type Slide = z.infer<typeof Slide>;

export const Playlist = z.object({
  id: z.string(),
  slideIds: z.array(z.string()),
  /** Part maximale de contenu partenaire dans la rotation, en pourcentage. */
  sponsoredCapPercent: z.number().int().min(0).max(100).optional(),
});
export type Playlist = z.infer<typeof Playlist>;

/** Découpage de la dalle. Chaque zone tourne indépendamment des autres. */
export const Zone = z.object({
  id: z.string(),
  /** Position en pourcentage de la dalle, pour rester indépendant de la résolution. */
  rect: z.object({
    xPercent: z.number().min(0).max(100),
    yPercent: z.number().min(0).max(100),
    widthPercent: z.number().min(0).max(100),
    heightPercent: z.number().min(0).max(100),
  }),
  playlistId: z.string(),
});
export type Zone = z.infer<typeof Zone>;

export const Layout = z.object({
  id: z.string(),
  orientation: Orientation,
  zones: z.array(Zone).min(1),
});
export type Layout = z.infer<typeof Layout>;

/** Quand une playlist prend la main. La priorité départage les conflits. */
export const Schedule = z.object({
  id: z.string(),
  zoneId: z.string(),
  playlistId: z.string(),
  priority: z.number().int(),
  startsAt: IsoDateTime.optional(),
  endsAt: IsoDateTime.optional(),
  /** 1 = lundi … 7 = dimanche. Vide ou absent = tous les jours. */
  daysOfWeek: z.array(z.number().int().min(1).max(7)).optional(),
  /** Heure locale de l'école, format HH:MM. */
  dailyStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  dailyEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});
export type Schedule = z.infer<typeof Schedule>;

export const ScreenSettings = z.object({
  /** Filet de sécurité si le canal temps réel est tombé. */
  pollIntervalSec: z.number().int().positive().default(60),
  cacheBudgetBytes: z.number().int().positive(),
  /** Au-delà, l'écran bascule sur la playlist de repli embarquée. */
  offlineGraceDays: z.number().int().positive().default(7),
  timezone: z.string().default("Europe/Paris"),
  /** Plages d'extinction de la dalle, en heure locale. */
  displayOff: z
    .array(z.object({ daysOfWeek: z.array(z.number().int().min(1).max(7)), from: z.string(), to: z.string() }))
    .default([]),
  /** Petit code discret affiché dans un coin, pour repérer l'écran. */
  showScreenCodeWatermark: z.boolean().default(false),
  /**
   * L'identité de l'établissement.
   *
   * Configurée, jamais codée en dur : ce logiciel n'appartient pas à une
   * école en particulier, et une couleur inscrite dans le noyau de rendu se
   * paierait en fourche le jour où un deuxième établissement l'installe.
   *
   * Le fond reste sombre quelle que soit la charte. Un couloir n'est pas une
   * page web : une dalle claire éblouit le soir, consomme davantage, et
   * perd en contraste à quatre mètres. C'est l'accent qui porte l'identité.
   */
  branding: z
    .object({
      /** Couleur d'accent, en hexadécimal — « #11A6C4 ». */
      accent: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      /** Le nom affiché sur la carte d'identité de l'écran. */
      nom: z.string().max(80).optional(),
    })
    .optional(),
});
export type ScreenSettings = z.infer<typeof ScreenSettings>;

/**
 * Message d'urgence. Court-circuite toute la programmation.
 * Ne disparaît jamais tout seul : il faut une action explicite pour le retirer.
 */
export const EmergencyMessage = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().optional(),
  issuedAt: IsoDateTime,
  /**
   * Fenêtre au-delà de laquelle un écran qui reçoit le message en différé
   * doit l'ignorer — sinon un écran rallumé trois jours plus tard afficherait
   * une alerte incendie périmée.
   */
  validUntil: IsoDateTime,
});
export type EmergencyMessage = z.infer<typeof EmergencyMessage>;

export const Manifest = z.object({
  schemaVersion: z.literal(1),
  screenId: ScreenId,
  /** Strictement croissant par écran. L'agent ignore toute version antérieure. */
  version: z.number().int().nonnegative(),
  issuedAt: IsoDateTime,
  settings: ScreenSettings,
  layout: Layout,
  playlists: z.array(Playlist),
  slides: z.array(Slide),
  assets: z.array(AssetRef),
  dataSources: z.array(DataSourceRef),
  schedules: z.array(Schedule),
  emergency: EmergencyMessage.nullable().default(null),
  /** Playlist embarquée dans l'image système, valable indéfiniment. */
  fallbackPlaylistId: z.string(),
  /**
   * Ce qu'on joue quand rien n'est programmé pour maintenant.
   *
   * Distinct du repli, et la distinction n'est pas cosmétique. Le repli dit
   * « je n'ai plus de contact avec le serveur » — c'est la carte d'identité
   * de l'écran, et elle rassure celui qui passe devant. Le défaut dit
   * « personne n'a rien prévu à cette heure-ci » : l'établissement choisit
   * alors ce qu'on voit, une affiche d'accueil ou les salles du jour.
   *
   * Absent, on retombe sur le repli.
   */
  defaultPlaylistId: z.string().optional(),
});
export type Manifest = z.infer<typeof Manifest>;

/**
 * Vérifie qu'un manifeste se tient tout seul : aucune référence dans le vide.
 *
 * On le fait côté serveur avant d'émettre et côté player avant d'appliquer.
 * C'est peu coûteux et ça évite la classe de bugs la plus pénible à
 * diagnostiquer à distance — un écran qui affiche du vide parce qu'une
 * playlist pointe vers une diapo supprimée.
 */
export function findBrokenReferences(manifest: Manifest): string[] {
  const problems: string[] = [];
  const slideIds = new Set(manifest.slides.map((s) => s.id));
  const assetIds = new Set(manifest.assets.map((a) => a.id));
  const sourceIds = new Set(manifest.dataSources.map((d) => d.id));
  const playlistIds = new Set(manifest.playlists.map((p) => p.id));

  for (const zone of manifest.layout.zones) {
    if (!playlistIds.has(zone.playlistId)) {
      problems.push(`zone ${zone.id} : playlist ${zone.playlistId} introuvable`);
    }
  }
  for (const playlist of manifest.playlists) {
    for (const slideId of playlist.slideIds) {
      if (!slideIds.has(slideId)) {
        problems.push(`playlist ${playlist.id} : diapositive ${slideId} introuvable`);
      }
    }
  }
  for (const slide of manifest.slides) {
    if (slide.kind === "media" && !assetIds.has(slide.assetId)) {
      problems.push(`diapositive ${slide.id} : média ${slide.assetId} introuvable`);
    }
    if (slide.kind === "template") {
      for (const assetId of slide.assetIds) {
        if (!assetIds.has(assetId)) {
          problems.push(`diapositive ${slide.id} : média ${assetId} introuvable`);
        }
      }
    }
    if (slide.kind === "data" && !sourceIds.has(slide.sourceId)) {
      problems.push(`diapositive ${slide.id} : source ${slide.sourceId} introuvable`);
    }
  }
  for (const schedule of manifest.schedules) {
    if (!playlistIds.has(schedule.playlistId)) {
      problems.push(`programmation ${schedule.id} : playlist ${schedule.playlistId} introuvable`);
    }
    if (!manifest.layout.zones.some((z) => z.id === schedule.zoneId)) {
      problems.push(`programmation ${schedule.id} : zone ${schedule.zoneId} introuvable`);
    }
  }
  if (!playlistIds.has(manifest.fallbackPlaylistId)) {
    problems.push(`playlist de repli ${manifest.fallbackPlaylistId} introuvable`);
  }
  return problems;
}

/** Somme des octets à avoir en local pour pouvoir appliquer ce manifeste. */
export function totalAssetBytes(manifest: Manifest): number {
  return manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0);
}
