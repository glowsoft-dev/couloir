import type { AssetRef, Layout, Manifest, Playlist, ScreenSettings, Slide } from "@couloir/protocol";
import { findBrokenReferences } from "@couloir/protocol";
import type { StoredMedia } from "./media.js";

/**
 * Le composeur : d'un choix d'éditeur vers un manifeste valide.
 *
 * La console manipule des idées simples — « ces trois images, quinze
 * secondes chacune, avec les cours dans une colonne ». Le manifeste, lui,
 * est un objet normalisé avec ses identifiants croisés, sa playlist de repli
 * et ses sources de données. Traduire l'un dans l'autre est un travail
 * mécanique, et c'est exactement pour ça qu'il ne doit pas se faire à la main
 * dans une route HTTP.
 *
 * Logique pure : aucune base, aucun réseau. Elle se teste en énumérant les
 * combinaisons, ce qu'on ne ferait jamais en cliquant dans une interface.
 */

export type LayoutChoice = "plein-ecran" | "principal-et-cours";

export interface PublishItem {
  /** Un média de la bibliothèque. */
  assetId?: string;
  /** Ou un bloc de texte composé dans la console. */
  text?: { eyebrow?: string; titre: string; texte?: string };
  durationMs?: number;
}

export interface PublishSpec {
  layout: LayoutChoice;
  items: PublishItem[];
  /** Bandeau défilant en bas d'écran. Absent = pas de bandeau. */
  ticker?: string;
  /** URL de la source d'emploi du temps, pour la mise en page à colonne. */
  timetableUrl?: string;
  /**
   * Les classes à faire défiler dans la colonne.
   *
   * Vide ou absent : la source décide (une seule classe, ou la première).
   * Une seule classe : écran « fixe ». Plusieurs : l'écran les enchaîne.
   */
  timetableClasses?: { id: string; label: string }[];
  /** Plages d'extinction de la dalle, en heure locale de l'école. */
  displayOff?: { daysOfWeek: number[]; from: string; to: string }[];
  /**
   * Combien d'actualités du site font partie de la rotation. 0 = aucune.
   *
   * Elles tournent AVEC les affiches et les vidéos, pas dans un coin à part :
   * c'était la demande d'origine — des cours, mais pas que.
   */
  actualites?: number;
  /** L'adresse à laquelle les écrans vont lire les actualités. */
  actualitesUrl?: string;
}

export interface ComposeInput {
  screenId: string;
  version: number;
  issuedAt: string;
  spec: PublishSpec;
  /** Médias disponibles, indexés par identifiant. */
  media: ReadonlyMap<string, StoredMedia>;
  /** Base publique du serveur, telle que le player la joint. */
  baseUrl: string;
  settings?: Partial<ScreenSettings>;
}

export class CompositionError extends Error {}

const DEFAULT_ITEM_DURATION_MS = 12_000;

/** Toujours présente : c'est elle qui s'affiche après une longue coupure. */
const FALLBACK_SLIDE: Slide = {
  kind: "template",
  id: "repli-identite",
  templateId: "identite-ecole",
  fields: { eyebrow: "Bienvenue", titre: "Établissement" },
  assetIds: [],
  durationMs: 20_000,
};

export function compose(input: ComposeInput): Manifest {
  const { spec } = input;
  // Un écran qui ne diffuse que les actualités du site est légitime : c'est
  // la configuration d'un hall d'accueil. Ce qu'on refuse, c'est un écran
  // sans rien du tout.
  if (spec.items.length === 0 && !(spec.actualites && spec.actualites > 0)) {
    throw new CompositionError(
      "Ajoutez au moins un contenu, ou des actualités du site, avant de publier.",
    );
  }

  const slides: Slide[] = [FALLBACK_SLIDE];
  const assets: AssetRef[] = [];
  const mainSlideIds: string[] = [];

  spec.items.forEach((item, index) => {
    const id = `item-${index + 1}`;

    if (item.assetId) {
      const media = input.media.get(item.assetId);
      if (!media) {
        throw new CompositionError(`Le média « ${item.assetId} » n'existe plus dans la bibliothèque.`);
      }

      // Une vidéo dure le temps qu'elle dure : on ne lui impose pas de durée.
      const isVideo = media.mime.startsWith("video/");
      slides.push({
        kind: "media",
        id,
        assetId: media.id,
        ...(isVideo ? {} : { durationMs: item.durationMs ?? DEFAULT_ITEM_DURATION_MS }),
      });

      if (!assets.some((asset) => asset.id === media.id)) {
        assets.push({
          id: media.id,
          sha256: media.sha256,
          bytes: media.bytes,
          mime: media.mime,
          url: new URL(`/v1/assets/${media.id}`, input.baseUrl).toString(),
          urlExpiresAt: addHours(input.issuedAt, 24),
        });
      }
      mainSlideIds.push(id);
      return;
    }

    if (item.text) {
      slides.push({
        kind: "template",
        id,
        templateId: "annonce",
        fields: {
          ...(item.text.eyebrow ? { eyebrow: item.text.eyebrow } : {}),
          titre: item.text.titre,
          ...(item.text.texte ? { texte: item.text.texte } : {}),
        },
        assetIds: [],
        durationMs: item.durationMs ?? DEFAULT_ITEM_DURATION_MS,
      });
      mainSlideIds.push(id);
      return;
    }

    throw new CompositionError(`Le contenu ${index + 1} est vide.`);
  });

  const playlists: Playlist[] = [
    { id: "principale", slideIds: mainSlideIds },
    { id: "repli", slideIds: [FALLBACK_SLIDE.id] },
  ];

  const withTimetable = spec.layout === "principal-et-cours";
  const withTicker = Boolean(spec.ticker?.trim());
  const nombreActualites = Math.max(0, Math.min(spec.actualites ?? 0, 10));

  /**
   * Les actualités rejoignent la rotation principale.
   *
   * Une diapositive par article, toutes branchées sur LA MÊME source : un
   * seul appel réseau depuis l'écran, et chaque article garde sa propre
   * preuve de diffusion. Le rang boucle côté rendu, si bien qu'une source
   * qui rend moins d'articles que prévu ne laisse aucune dalle vide.
   */
  if (nombreActualites > 0) {
    if (!spec.actualitesUrl) {
      throw new CompositionError(
        "Les actualités ne sont pas configurées. Renseignez l'adresse du site dans les Réglages.",
      );
    }
    for (let rang = 0; rang < nombreActualites; rang++) {
      const id = `actualite-${rang}`;
      slides.push({
        kind: "data",
        id,
        sourceId: "actus",
        view: "news-single",
        params: { index: String(rang) },
        durationMs: 14_000,
      });
      mainSlideIds.push(id);
    }
  }

  if (withTimetable) {
    if (!spec.timetableUrl) {
      throw new CompositionError("Cette mise en page a besoin d'une source d'emploi du temps.");
    }
    // Une diapositive par classe, toutes branchées sur LA MÊME source :
    // l'agent ne fait qu'un appel, et chaque classe garde sa propre preuve
    // de diffusion.
    const columnSlideIds: string[] = [];
    const columnClasses = spec.timetableClasses ?? [];
    if (columnClasses.length === 0) {
      slides.push({
        kind: "data",
        id: "cours-du-jour",
        sourceId: "edt",
        view: "timetable-day",
        params: {},
        durationMs: 20_000,
      });
      columnSlideIds.push("cours-du-jour");
    } else {
      for (const schoolClass of columnClasses) {
        const id = `cours-${schoolClass.id}`;
        slides.push({
          kind: "data",
          id,
          sourceId: "edt",
          view: "timetable-day",
          params: { classId: schoolClass.id },
          durationMs: 20_000,
        });
        columnSlideIds.push(id);
      }
    }
    playlists.push({ id: "cours", slideIds: columnSlideIds });
  }

  if (withTicker) {
    slides.push({
      kind: "widget",
      id: "bandeau",
      widget: "ticker",
      config: { text: spec.ticker!.trim() },
      durationMs: 30_000,
    });
    playlists.push({ id: "bandeau", slideIds: ["bandeau"] });
  }

  const manifest: Manifest = {
    schemaVersion: 1,
    screenId: input.screenId,
    version: input.version,
    issuedAt: input.issuedAt,
    settings: {
      pollIntervalSec: 60,
      cacheBudgetBytes: 8 * 1024 ** 3,
      offlineGraceDays: 7,
      timezone: "Europe/Paris",
      displayOff: spec.displayOff ?? [],
      showScreenCodeWatermark: true,
      ...input.settings,
    },
    layout: buildLayout(withTimetable, withTicker),
    playlists,
    slides,
    assets,
    dataSources: [
      ...(withTimetable
        ? [
            {
              id: "edt",
              kind: "timetable" as const,
              url: spec.timetableUrl!,
              ttlSec: 900,
              // Au-delà de quatre heures, la colonne se retire plutôt que de
              // laisser croire qu'elle est à jour.
              maxStaleSec: 14_400,
              stalePolicy: "hide" as const,
            },
          ]
        : []),
      ...(nombreActualites > 0
        ? [
            {
              id: "actus",
              kind: "news" as const,
              url: spec.actualitesUrl!,
              ttlSec: 900,
              // Deux jours : une actualité scolaire vieillit lentement, et
              // un site en maintenance le week-end ne doit pas vider les
              // écrans du lundi matin. Passé ce délai on l'affiche quand
              // même, datée — mieux vaut une vieille annonce signalée comme
              // telle qu'un trou dans la rotation. C'est l'inverse du choix
              // fait pour l'emploi du temps, qui se retire : un cours faux
              // envoie quelqu'un dans la mauvaise salle, une vieille
              // actualité ne fait de mal à personne.
              maxStaleSec: 172_800,
              stalePolicy: "keep-with-date" as const,
            },
          ]
        : []),
    ],
    schedules: buildSchedules(withTimetable, withTicker),
    emergency: null,
    fallbackPlaylistId: "repli",
  };

  // Ceinture et bretelles : le composeur ne doit jamais produire un
  // manifeste qui référencerait du vide. Une erreur ici est un bug du
  // composeur, pas une faute de l'utilisateur.
  const problems = findBrokenReferences(manifest);
  if (problems.length > 0) {
    throw new Error(`composition incohérente :\n  - ${problems.join("\n  - ")}`);
  }

  return manifest;
}

function buildLayout(withTimetable: boolean, withTicker: boolean): Layout {
  const contentHeight = withTicker ? 91 : 100;
  const zones: Layout["zones"] = [
    {
      id: "principal",
      rect: {
        xPercent: 0,
        yPercent: 0,
        widthPercent: withTimetable ? 66 : 100,
        heightPercent: contentHeight,
      },
      playlistId: "principale",
    },
  ];

  if (withTimetable) {
    zones.push({
      id: "cours",
      rect: { xPercent: 66, yPercent: 0, widthPercent: 34, heightPercent: contentHeight },
      playlistId: "cours",
    });
  }

  if (withTicker) {
    zones.push({
      id: "bandeau",
      rect: { xPercent: 0, yPercent: contentHeight, widthPercent: 100, heightPercent: 100 - contentHeight },
      playlistId: "bandeau",
    });
  }

  return { id: withTimetable ? "principal-et-cours" : "plein-ecran", orientation: "landscape", zones };
}

function buildSchedules(withTimetable: boolean, withTicker: boolean): Manifest["schedules"] {
  const schedules: Manifest["schedules"] = [
    { id: "s-principal", zoneId: "principal", playlistId: "principale", priority: 0 },
  ];
  if (withTimetable) {
    schedules.push({ id: "s-cours", zoneId: "cours", playlistId: "cours", priority: 0 });
  }
  if (withTicker) {
    schedules.push({ id: "s-bandeau", zoneId: "bandeau", playlistId: "bandeau", priority: 0 });
  }
  return schedules;
}

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString().replace(/\.\d+Z$/, "Z");
}
