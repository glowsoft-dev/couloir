import type { AssetRef, EmergencyMessage, Manifest, Slide, Zone } from "@couloir/protocol";
import { effectiveDuration } from "./readability.js";
import { type RotationState, advanceRotation } from "./rotation.js";
import { activePlaylistId, isDisplayOffPeriod, isVisible } from "./schedule.js";
import { dateLocale } from "./time.js";
import { type SourceSnapshot, type SourceState, isDisplayable, resolveSource, stalenessLabel } from "./staleness.js";

/**
 * Le chef d'orchestre.
 *
 * Il reçoit un manifeste, une heure, l'état des sources et ce qui est en
 * cache, et il décide de tout ce qui doit être à l'écran. Il ne touche pas
 * au DOM : il produit une description. C'est cette séparation qui permet de
 * tester une journée d'affichage sans navigateur, et qui fait que la même
 * décision produit exactement le même écran sur un Raspberry Pi, un boîtier
 * Android et un mini-PC.
 */

export type ScreenMode = "normal" | "fallback" | "emergency" | "identify" | "display-off";

export type RenderedSlide =
  | { kind: "media"; slideId: string; asset: AssetRef }
  | { kind: "template"; slideId: string; templateId: string; fields: Record<string, string | number | boolean> }
  | { kind: "widget"; slideId: string; widget: string; config: Record<string, unknown> }
  | {
      kind: "data";
      slideId: string;
      sourceId: string;
      view: string;
      payload: unknown;
      /** Sélecteur dans la charge utile : quelle classe, quelle salle. */
      params: Record<string, string>;
      /** Mention « Mis à jour lundi 08:12 » quand la donnée n'est plus fraîche. */
      staleLabel: string | null;
    };

export interface RenderedZone {
  zoneId: string;
  rect: Zone["rect"];
  playlistId: string;
  slide: RenderedSlide | null;
}

export interface IdentifyInfo {
  screenCode: string;
  label: string;
  ipAddress: string;
}

export interface ScreenState {
  mode: ScreenMode;
  zones: RenderedZone[];
  emergency: EmergencyMessage | null;
  identify: IdentifyInfo | null;
  /** Petit code discret dans un coin, pour repérer l'écran depuis le couloir. */
  watermark: string | null;
  /**
   * La couleur d'accent de l'établissement.
   *
   * Portée par l'état plutôt que lue du manifeste par la couche DOM : le
   * réalisateur reste la seule pièce qui décide, et l'affichage la seule qui
   * dessine. `null` = la couleur par défaut du rendu.
   */
  accent: string | null;
}

/** Un changement de diapositive, qui deviendra une preuve de diffusion. */
export interface SlideTransition {
  zoneId: string;
  fromSlideId: string | null;
  toSlideId: string | null;
  atMs: number;
}

export interface DirectorInput {
  manifest: Manifest;
  nowMs: number;
  /** Ce que l'agent a récupéré pour chaque source de données. */
  sources: ReadonlyMap<string, SourceSnapshot>;
  /** Ce qui est réellement présent et vérifié dans le cache local. */
  availableAssetIds: ReadonlySet<string>;
  rotations: ReadonlyMap<string, RotationState>;
  /** Imposé par l'agent après une coupure trop longue. */
  forceFallback?: boolean;
  identify?: IdentifyInfo | null;
  /** Zones dont la vidéo vient de se terminer. */
  mediaEndedZoneIds?: ReadonlySet<string>;
  screenCode?: string;
}

export interface DirectorOutput {
  screen: ScreenState;
  rotations: Map<string, RotationState>;
  transitions: SlideTransition[];
}

export function direct(input: DirectorInput): DirectorOutput {
  const { manifest, nowMs } = input;
  const slidesById = new Map(manifest.slides.map((s) => [s.id, s]));
  const assetsById = new Map(manifest.assets.map((a) => [a.id, a]));
  const playlistsById = new Map(manifest.playlists.map((p) => [p.id, p]));

  const sourceStates = new Map<string, SourceState>(
    manifest.dataSources.map((source) => [
      source.id,
      resolveSource(source, input.sources.get(source.id), nowMs),
    ]),
  );

  const watermark = manifest.settings.showScreenCodeWatermark ? (input.screenCode ?? null) : null;
  /** L'identité de l'établissement. `null` = la couleur par défaut du rendu. */
  const accent = manifest.settings.branding?.accent ?? null;

  // L'urgence passe avant tout, y compris l'extinction programmée : elle
  // rallume l'écran.
  const emergency = manifest.emergency;
  if (emergency && nowMs < Date.parse(emergency.validUntil)) {
    return {
      screen: { mode: "emergency", zones: [], emergency, identify: null, watermark, accent },
      rotations: new Map(input.rotations),
      transitions: [],
    };
  }

  if (input.identify) {
    return {
      screen: { mode: "identify", zones: [], emergency: null, identify: input.identify, watermark: null, accent },
      rotations: new Map(input.rotations),
      transitions: [],
    };
  }

  if (isDisplayOffPeriod(manifest.settings, nowMs)) {
    return {
      screen: { mode: "display-off", zones: [], emergency: null, identify: null, watermark: null, accent },
      rotations: new Map(input.rotations),
      transitions: [],
    };
  }

  /** Une diapositive est-elle diffusable ici et maintenant ? */
  const isEligible = (slideId: string): boolean => {
    const slide = slidesById.get(slideId);
    if (!slide) return false;

    // Hors de sa période d'affichage : on la saute, exactement comme on
    // saute un média pas encore téléchargé. Le mécanisme existait déjà, il
    // n'y avait qu'à lui donner une raison de plus.
    if (!isVisible(slide.visibility, nowMs, manifest.settings.timezone)) return false;

    switch (slide.kind) {
      case "media":
        return input.availableAssetIds.has(slide.assetId);
      case "template":
        return slide.assetIds.every((id) => input.availableAssetIds.has(id));
      case "widget":
        return true;
      case "data": {
        const state = sourceStates.get(slide.sourceId);
        if (state === undefined || !isDisplayable(state)) return false;

        /**
         * Un emploi du temps doit être celui d'aujourd'hui.
         *
         * La fraîcheur mesurée ne suffit pas : quand la source d'origine est
         * tombée, le serveur ressert la dernière journée connue — avec un
         * 200, donc l'écran la croit fraîche. Une panne pendant la nuit
         * afficherait le lendemain matin la journée de la veille, présentée
         * comme celle du jour. Un cours faux envoie quelqu'un dans la
         * mauvaise salle : mieux vaut retirer la colonne.
         *
         * La journée porte sa date ; on la compare, et on tranche ici plutôt
         * que de laisser la couche d'affichage décider.
         */
        if (slide.view.startsWith("timetable") && "payload" in state) {
          const jour = journéeChoisie(state.payload, slide.params["classId"]);
          if (jour?.date && jour.date !== dateLocale(nowMs, manifest.settings.timezone)) return false;
        }
        return true;
      }
    }
  };

  const durationMsOf = (slideId: string): number | null => {
    const slide = slidesById.get(slideId);
    if (!slide) return 0;
    // Une vidéo dure le temps qu'elle dure : la couche DOM préviendra.
    if (slide.kind === "media" && slide.durationMs === undefined) return null;
    return effectiveDuration(slide).effectiveMs;
  };

  const mode: ScreenMode = input.forceFallback ? "fallback" : "normal";
  const rotations = new Map<string, RotationState>();
  const transitions: SlideTransition[] = [];
  const zones: RenderedZone[] = [];

  for (const zone of manifest.layout.zones) {
    // En repli, toutes les zones jouent la playlist embarquée : c'est une
    // page d'attente, pas une mise en page complète.
    const playlistId = input.forceFallback
      ? manifest.fallbackPlaylistId
      : (activePlaylistId(manifest, zone.id, nowMs) ?? zone.playlistId);

    const playlist = playlistsById.get(playlistId);
    const previous = input.rotations.get(zone.id);
    const previousSlideId =
      previous && previous.playlistId === playlistId
        ? (playlist?.slideIds[previous.index] ?? null)
        : null;

    const result = advanceRotation({
      state: previous,
      playlistId,
      slideIds: playlist?.slideIds ?? [],
      isEligible,
      durationMsOf,
      nowMs,
      mediaEnded: input.mediaEndedZoneIds?.has(zone.id) ?? false,
    });

    if (result.state) rotations.set(zone.id, result.state);
    if (result.changed) {
      transitions.push({
        zoneId: zone.id,
        fromSlideId: previousSlideId,
        toSlideId: result.currentSlideId,
        atMs: nowMs,
      });
    }

    const slide = result.currentSlideId ? slidesById.get(result.currentSlideId) : undefined;
    zones.push({
      zoneId: zone.id,
      rect: zone.rect,
      playlistId,
      slide: slide ? renderSlide(slide, assetsById, sourceStates, manifest.settings.timezone) : null,
    });

    // En repli, une seule zone plein écran suffit.
    if (input.forceFallback) break;
  }

  /**
   * Plus rien à afficher : on joue le repli plutôt que d'éteindre.
   *
   * Le cas arrive dès qu'on programme des affiches — tout est daté pour
   * septembre, et le 20 août le couloir est noir sans que rien ne l'explique.
   * Une dalle noire ressemble à une panne : on monte à l'échelle pour
   * découvrir qu'il n'y avait simplement rien à montrer. La carte d'identité
   * de l'écran, elle, dit que le boîtier va bien.
   *
   * Ce n'est pas le mode `fallback`, qui signale une perte de contact : ici
   * tout fonctionne, il n'y a rien de programmé pour maintenant.
   */
  const rienÀMontrer = !input.forceFallback && zones.every((zone) => zone.slide === null);
  if (rienÀMontrer) {
    const repli = playlistsById.get(manifest.fallbackPlaylistId);
    const premier = repli?.slideIds[0];
    const diapo = premier ? slidesById.get(premier) : undefined;
    if (diapo) {
      return {
        screen: {
          mode: "normal",
          zones: [
            {
              zoneId: manifest.layout.zones[0]?.id ?? "principal",
              rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
              playlistId: manifest.fallbackPlaylistId,
              slide: renderSlide(diapo, assetsById, sourceStates, manifest.settings.timezone),
            },
          ],
          emergency: null,
          identify: null,
          watermark,
          accent,
        },
        rotations,
        transitions,
      };
    }
  }

  const finalZones = input.forceFallback
    ? zones.map((z) => ({ ...z, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } }))
    : collapseEmptyZones(zones);

  return {
    screen: { mode, zones: finalZones, emergency: null, identify: null, watermark, accent },
    rotations,
    transitions,
  };
}

function renderSlide(
  slide: Slide,
  assetsById: ReadonlyMap<string, AssetRef>,
  sourceStates: ReadonlyMap<string, SourceState>,
  timezone: string,
): RenderedSlide | null {
  switch (slide.kind) {
    case "media": {
      const asset = assetsById.get(slide.assetId);
      return asset ? { kind: "media", slideId: slide.id, asset } : null;
    }
    case "template":
      return { kind: "template", slideId: slide.id, templateId: slide.templateId, fields: slide.fields };
    case "widget":
      return { kind: "widget", slideId: slide.id, widget: slide.widget, config: slide.config };
    case "data": {
      const state = sourceStates.get(slide.sourceId);
      if (!state || !isDisplayable(state)) return null;
      return {
        kind: "data",
        slideId: slide.id,
        sourceId: slide.sourceId,
        view: slide.view,
        payload: "payload" in state ? state.payload : null,
        params: slide.params,
        staleLabel: stalenessLabel(state, "fr-FR", timezone),
      };
    }
  }
}

/**
 * Une zone vide s'efface au profit de ses voisines.
 *
 * Quand l'emploi du temps se retire faute de données fraîches, on ne laisse
 * pas un rectangle vide occuper un tiers de la dalle : les zones de la même
 * bande horizontale se répartissent la place libérée. Si toute une bande est
 * vide, elle disparaît et les autres bandes s'étirent en hauteur.
 */
/**
 * La journée que cette diapositive afficherait.
 *
 * Même sélection que la couche d'affichage : une source sert toutes les
 * classes, et le sélecteur de la diapositive dit laquelle.
 */
function journéeChoisie(
  payload: unknown,
  classId: string | undefined,
): { date?: string } | null {
  const days = (payload as { days?: { classId?: string; date?: string }[] } | null)?.days;
  if (Array.isArray(days)) {
    if (!classId) return days[0] ?? null;
    return days.find((day) => day.classId === classId) ?? null;
  }
  return (payload as { date?: string } | null) ?? null;
}

export function collapseEmptyZones(zones: readonly RenderedZone[]): RenderedZone[] {
  const bands = new Map<string, RenderedZone[]>();
  for (const zone of zones) {
    const key = `${zone.rect.yPercent}:${zone.rect.heightPercent}`;
    const band = bands.get(key);
    if (band) band.push(zone);
    else bands.set(key, [zone]);
  }

  const survivingBands: RenderedZone[][] = [];
  for (const band of bands.values()) {
    const filled = band.filter((z) => z.slide !== null);
    if (filled.length === 0) continue;

    // Répartition horizontale de la place libérée, dans l'ordre d'origine.
    const totalWidth = band.reduce((sum, z) => sum + z.rect.widthPercent, 0);
    const keptWidth = filled.reduce((sum, z) => sum + z.rect.widthPercent, 0);
    const scale = keptWidth > 0 ? totalWidth / keptWidth : 1;

    let cursor = Math.min(...band.map((z) => z.rect.xPercent));
    survivingBands.push(
      filled.map((zone) => {
        const widthPercent = zone.rect.widthPercent * scale;
        const positioned = { ...zone, rect: { ...zone.rect, xPercent: cursor, widthPercent } };
        cursor += widthPercent;
        return positioned;
      }),
    );
  }

  if (survivingBands.length === 0) return [];

  // Répartition verticale entre les bandes restantes.
  const totalHeight = [...bands.values()].reduce((sum, band) => sum + (band[0]?.rect.heightPercent ?? 0), 0);
  const keptHeight = survivingBands.reduce((sum, band) => sum + (band[0]?.rect.heightPercent ?? 0), 0);
  const vScale = keptHeight > 0 ? totalHeight / keptHeight : 1;

  const result: RenderedZone[] = [];
  let y = Math.min(...zones.map((z) => z.rect.yPercent));
  for (const band of survivingBands.sort((a, b) => (a[0]?.rect.yPercent ?? 0) - (b[0]?.rect.yPercent ?? 0))) {
    const heightPercent = (band[0]?.rect.heightPercent ?? 0) * vScale;
    for (const zone of band) {
      result.push({ ...zone, rect: { ...zone.rect, yPercent: y, heightPercent } });
    }
    y += heightPercent;
  }
  return result;
}
