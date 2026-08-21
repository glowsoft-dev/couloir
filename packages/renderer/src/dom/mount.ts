import type { RenderedSlide, RenderedZone, ScreenState } from "../director.js";
import { typeScale } from "../readability.js";
import { RENDERER_CSS } from "./styles.js";

/**
 * La couche DOM.
 *
 * Elle ne décide de rien : elle applique un `ScreenState` produit par le
 * chef d'orchestre. Toute l'intelligence — quoi afficher, quand tourner,
 * quand se retirer — est en amont, dans du code pur et testé.
 *
 * Cette couche se contente d'être économe : elle ne remplace un nœud que si
 * la diapositive a réellement changé. Un Raspberry Pi qui refait tout son DOM
 * chaque seconde chauffe pour rien.
 */

export interface MountOptions {
  /** Résout l'identifiant d'un média vers une URL locale servie par l'agent. */
  assetUrl?: (assetId: string) => string;
  locale?: string;
  timezone?: string;
}

export interface RendererHandle {
  update(screen: ScreenState): void;
  /** Prévient quand une vidéo se termine, pour faire avancer la rotation. */
  onMediaEnded(handler: (zoneId: string) => void): void;
  destroy(): void;
}

export function mountRenderer(container: HTMLElement, options: MountOptions = {}): RendererHandle {
  const doc = container.ownerDocument;

  const style = doc.createElement("style");
  style.textContent = RENDERER_CSS;
  container.appendChild(style);

  const root = doc.createElement("div");
  root.className = "couloir-root";
  container.appendChild(root);

  let mediaEndedHandler: (zoneId: string) => void = () => {};
  /** Ce qui est actuellement à l'écran, pour ne redessiner que le nécessaire. */
  const mountedSlides = new Map<string, string>();
  let lastSignature = "";

  const applyTypeScale = () => {
    const height = root.clientHeight || 1080;
    const scale = typeScale(height);
    root.style.setProperty("--fs-eyebrow", `${scale.eyebrow}px`);
    root.style.setProperty("--fs-title", `${scale.title}px`);
    root.style.setProperty("--fs-body", `${scale.body}px`);
    root.style.setProperty("--fs-caption", `${scale.caption}px`);
    root.style.setProperty("--pad", `${Math.round(height * 0.045)}px`);
  };

  const resizeObserver = new ResizeObserver(applyTypeScale);
  resizeObserver.observe(root);
  applyTypeScale();

  function renderFullScreen(screen: ScreenState): boolean {
    const signature = `${screen.mode}:${screen.emergency?.id ?? ""}:${screen.identify?.screenCode ?? ""}`;
    if (screen.mode === "normal" || screen.mode === "fallback") return false;
    if (signature === lastSignature) return true;
    lastSignature = signature;

    root.replaceChildren();
    mountedSlides.clear();
    const box = doc.createElement("div");

    if (screen.mode === "emergency" && screen.emergency) {
      box.className = "couloir-full couloir-full--emergency";
      box.append(
        el(doc, "p", "couloir-eyebrow", "Message important"),
        el(doc, "h1", "couloir-title", screen.emergency.title),
      );
      if (screen.emergency.body) box.append(el(doc, "p", "couloir-body", screen.emergency.body));
    } else if (screen.mode === "identify" && screen.identify) {
      // Déclenché depuis un téléphone, debout dans le couloir : le code doit
      // se lire d'un bout à l'autre du hall.
      box.className = "couloir-full couloir-full--identify";
      box.append(
        el(doc, "div", "couloir-code", screen.identify.screenCode),
        el(doc, "p", "couloir-body", screen.identify.label),
        el(doc, "p", "couloir-body", screen.identify.ipAddress),
      );
    } else {
      box.className = "couloir-full couloir-full--off";
    }

    root.appendChild(box);
    return true;
  }

  function renderZones(screen: ScreenState): void {
    // Sortie d'un mode plein écran : le panneau précédent doit disparaître,
    // sinon les zones se dessinent par-dessus lui.
    if (lastSignature !== "") {
      root.replaceChildren();
      mountedSlides.clear();
      lastSignature = "";
    }
    const seen = new Set<string>();

    for (const zone of screen.zones) {
      seen.add(zone.zoneId);
      let node = root.querySelector<HTMLElement>(`[data-zone="${zone.zoneId}"]`);
      if (!node) {
        node = doc.createElement("section");
        node.className = "couloir-zone";
        node.dataset["zone"] = zone.zoneId;
        root.appendChild(node);
      }
      node.style.left = `${zone.rect.xPercent}%`;
      node.style.top = `${zone.rect.yPercent}%`;
      node.style.width = `${zone.rect.widthPercent}%`;
      node.style.height = `${zone.rect.heightPercent}%`;

      const currentSlideId = zone.slide?.slideId ?? null;
      if (mountedSlides.get(zone.zoneId) === currentSlideId) continue;

      node.replaceChildren();
      if (currentSlideId === null) {
        mountedSlides.delete(zone.zoneId);
        continue;
      }
      mountedSlides.set(zone.zoneId, currentSlideId);
      node.appendChild(renderSlide(doc, zone, zone.slide!, options, mediaEndedHandler));
    }

    for (const node of [...root.querySelectorAll<HTMLElement>("[data-zone]")]) {
      const id = node.dataset["zone"];
      if (id && !seen.has(id)) {
        node.remove();
        mountedSlides.delete(id);
      }
    }

    let watermark = root.querySelector<HTMLElement>(".couloir-watermark");
    if (screen.watermark) {
      if (!watermark) {
        watermark = el(doc, "div", "couloir-watermark", screen.watermark);
        root.appendChild(watermark);
      }
      watermark.textContent = screen.watermark;
    } else {
      watermark?.remove();
    }
  }

  return {
    update(screen) {
      if (renderFullScreen(screen)) return;
      renderZones(screen);
    },
    onMediaEnded(handler) {
      mediaEndedHandler = handler;
    },
    destroy() {
      resizeObserver.disconnect();
      root.remove();
      style.remove();
    },
  };
}

function el(doc: Document, tag: string, className: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderSlide(
  doc: Document,
  zone: RenderedZone,
  slide: RenderedSlide,
  options: MountOptions,
  onMediaEnded: (zoneId: string) => void,
): HTMLElement {
  const wrapper = doc.createElement("div");
  wrapper.className = "couloir-slide";
  wrapper.dataset["slide"] = slide.slideId;

  switch (slide.kind) {
    case "media": {
      wrapper.classList.add("couloir-slide--media");
      const url = options.assetUrl?.(slide.asset.id) ?? slide.asset.url;
      if (slide.asset.mime.startsWith("video/")) {
        const video = doc.createElement("video");
        video.className = "couloir-media";
        video.src = url;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.addEventListener("ended", () => onMediaEnded(zone.zoneId));
        // Une vidéo qui ne démarre pas ne doit pas figer la zone.
        video.addEventListener("error", () => onMediaEnded(zone.zoneId));
        wrapper.appendChild(video);
      } else {
        const img = doc.createElement("img");
        img.className = "couloir-media";
        img.src = url;
        img.alt = "";
        wrapper.appendChild(img);
      }
      return wrapper;
    }

    case "template": {
      const field = (name: string) => {
        const value = slide.fields[name];
        return typeof value === "string" ? value : undefined;
      };
      const eyebrow = field("eyebrow");
      const title = field("titre") ?? field("title");
      const body = field("texte") ?? field("body");
      if (eyebrow) wrapper.appendChild(el(doc, "p", "couloir-eyebrow", eyebrow));
      if (title) wrapper.appendChild(el(doc, "h1", "couloir-title", title));
      if (body) wrapper.appendChild(el(doc, "p", "couloir-body", body));
      return wrapper;
    }

    case "widget": {
      if (slide.widget === "ticker") {
        wrapper.classList.add("couloir-slide--ticker");
        const message = typeof slide.config["text"] === "string" ? slide.config["text"] : "";
        const viewport = el(doc, "div", "couloir-ticker-viewport");
        viewport.appendChild(el(doc, "span", "couloir-ticker-text", message));
        wrapper.appendChild(viewport);
        const clock = el(doc, "div", "couloir-clock", "");
        const tick = () => {
          clock.textContent = new Intl.DateTimeFormat(options.locale ?? "fr-FR", {
            timeZone: options.timezone ?? "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date());
        };
        tick();
        const timer = setInterval(tick, 10_000);
        // Le nœud est jeté au changement de diapositive : on coupe le timer.
        new MutationObserver((_records, observer) => {
          if (!clock.isConnected) {
            clearInterval(timer);
            observer.disconnect();
          }
        }).observe(wrapper.ownerDocument.body, { childList: true, subtree: true });
        wrapper.appendChild(clock);
        return wrapper;
      }
      wrapper.appendChild(el(doc, "p", "couloir-eyebrow", slide.widget));
      return wrapper;
    }

    case "data": {
      renderDataView(doc, wrapper, slide);
      if (slide.staleLabel) {
        // On dit franchement que la donnée n'est plus fraîche plutôt que de
        // laisser croire qu'elle l'est.
        wrapper.appendChild(el(doc, "p", "couloir-stale", slide.staleLabel));
      }
      return wrapper;
    }
  }
}

interface TimetableEntry {
  time: string;
  subject: string;
  room: string;
  changed?: boolean;
  note?: string;
}
interface NewsEntry {
  title: string;
  excerpt?: string;
  category?: string;
}

function renderDataView(
  doc: Document,
  wrapper: HTMLElement,
  slide: Extract<RenderedSlide, { kind: "data" }>,
): void {
  if (slide.view.startsWith("timetable")) {
    const entries = Array.isArray(slide.payload) ? (slide.payload as TimetableEntry[]) : [];
    wrapper.appendChild(el(doc, "p", "couloir-eyebrow", "Cours du jour"));
    const list = doc.createElement("ul");
    list.className = "couloir-list";
    for (const entry of entries) {
      const row = doc.createElement("li");
      // Un changement de dernière minute doit sauter aux yeux.
      row.className = entry.changed ? "couloir-row couloir-row--changed" : "couloir-row";
      const time = doc.createElement("time");
      time.textContent = entry.time;
      const label = doc.createElement("span");
      label.textContent = entry.subject;
      if (entry.note) label.appendChild(el(doc, "span", "couloir-badge", entry.note));
      row.append(time, label, el(doc, "span", "room", entry.room));
      list.appendChild(row);
    }
    wrapper.appendChild(list);
    return;
  }

  const items = Array.isArray(slide.payload) ? (slide.payload as NewsEntry[]) : [];
  const first = items[0];
  if (!first) return;
  if (first.category) wrapper.appendChild(el(doc, "p", "couloir-eyebrow", first.category));
  wrapper.appendChild(el(doc, "h1", "couloir-title", first.title));
  if (first.excerpt) wrapper.appendChild(el(doc, "p", "couloir-body", first.excerpt));
}
