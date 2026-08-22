import type { AssetRef, EmergencyMessage, Manifest, Slide, Zone } from "@couloir/protocol";
import { effectiveDuration } from "./readability.js";
import { type RotationState, advanceRotation } from "./rotation.js";
import { activePlaylistId, isDisplayOffPeriod } from "./schedule.js";
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

  // L'urgence passe avant tout, y compris l'extinction programmée : elle
  // rallume l'écran.
  const emergency = manifest.emergency;
  if (emergency && nowMs < Date.parse(emergency.validUntil)) {
    return {
      screen: { mode: "emergency", zones: [], emergency, identify: null, watermark },
      rotations: new Map(input.rotations),
      transitions: [],
    };
  }

  if (input.identify) {
    return {
      screen: { mode: "identify", zones: [], emergency: null, identify: input.identify, watermark: null },
      rotations: new Map(input.rotations),
      transitions: [],
    };
  }

  if (isDisplayOffPeriod(manifest.settings, nowMs)) {
    return {
      screen: { mode: "display-off", zones: [], emergency: null, identify: null, watermark: null },
      rotations: new Map(input.rotations),
      transitions: [],
    };
  }

  /** Une diapositive est-elle diffusable en l'état actuel du cache ? */
  const isEligible = (slideId: string): boolean => {
    const slide = slidesById.get(slideId);
    if (!slide) return false;
    switch (slide.kind) {
      case "media":
        return input.availableAssetIds.has(slide.assetId);
      case "template":
        return slide.assetIds.every((id) => input.availableAssetIds.has(id));
      case "widget":
        return true;
      case "data": {
        const state = sourceStates.get(slide.sourceId);
        return state !== undefined && isDisplayable(state);
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

  const finalZones = input.forceFallback
    ? zones.map((z) => ({ ...z, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } }))
    : collapseEmptyZones(zones);

  return {
    screen: { mode, zones: finalZones, emergency: null, identify: null, watermark },
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
