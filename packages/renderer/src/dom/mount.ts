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

      const currentSlideId = zone.slide ? empreinteDeDiapo(zone.slide) : null;
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

  /** La dernière couleur posée, pour ne pas toucher au style à chaque tour. */
  let accentPosé: string | null = null;

  return {
    update(screen) {
      // L'identité de l'établissement tient dans une variable CSS : tout le
      // reste de la feuille s'y réfère déjà. Le fond, lui, ne change pas —
      // une dalle claire éblouit le soir et perd en contraste à quatre
      // mètres.
      if (screen.accent !== accentPosé) {
        accentPosé = screen.accent;
        if (screen.accent) root.style.setProperty("--accent", screen.accent);
        else root.style.removeProperty("--accent");
      }

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

/**
 * Ce qui identifie une diapositive à l'écran.
 *
 * Son identifiant ne suffit pas : le composeur numérote les contenus
 * — `item-1`, `item-2` — et réutilise donc les mêmes noms d'une publication
 * à l'autre. Remplacer une affiche par un texte au même rang gardait
 * l'ancienne image à l'écran jusqu'au prochain rechargement de la page, ce
 * qui n'arrive jamais sur un boîtier posé dans un couloir.
 *
 * On compare donc ce qui est réellement dessiné. La charge d'une source y
 * figure aussi : sans elle, un écran qui n'affiche qu'une seule diapositive
 * de données ne verrait jamais ses données changer, faute de rotation pour
 * la remonter. Elle tient en quelques kilo-octets, et la comparaison a lieu
 * deux fois par seconde — c'est sans effet sur un boîtier d'entrée de gamme.
 */
function empreinteDeDiapo(slide: RenderedSlide): string {
  // L'identifiant ET le contenu. Deux diapositives distinctes qui dessinent
  // la même chose restent deux diapositives — elles occupent deux rangs de
  // la rotation et deux lignes de preuve de diffusion.
  const contenu = (): string => {
    switch (slide.kind) {
      case "media":
        return `media:${slide.asset.id}`;
      case "template":
        return `template:${slide.templateId}:${JSON.stringify(slide.fields)}`;
      case "widget":
        return `widget:${slide.widget}:${JSON.stringify(slide.config)}`;
      case "data":
        return `data:${slide.sourceId}:${slide.view}:${JSON.stringify(slide.params)}:${slide.staleLabel ?? ""}:${JSON.stringify(slide.payload)}`;
    }
  };
  return `${slide.slideId}|${contenu()}`;
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
      // « entier » par défaut : une affiche posée dans une colonne de deux
      // tiers se ferait couper les côtés, et c'est le titre qui part en
      // premier. Perdre du texte est pire qu'une bande de fond.
      if (slide.fit === "remplir") wrapper.classList.add("couloir-slide--remplir");
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
  endTime?: string;
  subject: string;
  /** Le module, sous l'intitulé : « Architectures de données décisionnelles ». */
  detail?: string;
  room: string;
  teacher?: string;
  change?: "none" | "cancelled" | "room" | "teacher" | "added";
  note?: string;
}
interface TimetableDay {
  classId: string;
  classLabel: string;
  entries: TimetableEntry[];
  notice?: string;
}
interface Article {
  id?: string;
  titre: string;
  extrait?: string;
  categorie?: string;
  image?: string;
}

/**
 * Choisit la journée à afficher dans la charge utile.
 *
 * Une seule source sert toutes les classes ; c'est le sélecteur de la
 * diapositive qui dit laquelle. Sans sélecteur, on prend la première — un
 * écran ne doit pas rester vide à cause d'un paramètre oublié.
 */
/**
 * Ce que la colonne des cours montre.
 *
 * Réglé par écran : un couloir de bâtiment veut la salle, un écran d'accueil
 * s'en passe et préfère les intitulés lisibles de loin. Certains
 * établissements ne souhaitent pas afficher les noms d'enseignants.
 *
 * Absent, tout est montré — c'est le comportement d'origine, et une
 * publication faite avant ce réglage ne doit pas se retrouver amputée.
 */
const CHAMPS_PAR_DEFAUT = ["heureFin", "module", "salle", "enseignant"] as const;

function champsAffichés(brut: string | undefined): Set<string> {
  if (brut === undefined) return new Set(CHAMPS_PAR_DEFAUT);
  // Une chaîne vide veut dire « rien de facultatif », pas « tout ».
  return new Set(
    brut
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  );
}

function pickDay(payload: unknown, classId: string | undefined): TimetableDay | null {
  const days = (payload as { days?: TimetableDay[] } | null)?.days;
  if (Array.isArray(days)) {
    if (!classId) return days[0] ?? null;
    return days.find((day) => day.classId === classId) ?? null;
  }
  // Charge utile d'une seule classe.
  const single = payload as TimetableDay | null;
  return single && Array.isArray(single.entries) ? single : null;
}

/**
 * Un article, choisi par son rang.
 *
 * Une seule source alimente N diapositives, chacune désignant son article :
 * le même schéma que l'emploi du temps, où une source sert toutes les
 * classes. Afficher seulement le premier article condamnerait les suivants à
 * ne jamais paraître — et une école qui publie trois actualités s'attend à
 * voir les trois.
 */
function renderNews(
  doc: Document,
  wrapper: HTMLElement,
  slide: Extract<RenderedSlide, { kind: "data" }>,
): void {
  const charge = slide.payload as { articles?: Article[] } | Article[] | null;
  const articles = Array.isArray(charge) ? charge : (charge?.articles ?? []);
  if (articles.length === 0) return;

  // Le rang boucle : une source qui rend deux articles là où la publication
  // en attendait quatre ne laisse pas deux dalles vides.
  const rang = Number(slide.params["index"] ?? 0);
  const article = articles[((rang % articles.length) + articles.length) % articles.length];
  if (!article?.titre) return;

  if (article.image) {
    // L'image d'abord dans le DOM : elle commence à charger pendant que le
    // reste se construit, et la diapositive ne s'affiche pas en deux temps.
    const illustration = doc.createElement("img");
    illustration.className = "couloir-illustration";
    illustration.src = article.image;
    illustration.alt = "";
    // Une illustration absente ne doit pas laisser un cadre brisé au-dessus
    // du titre : elle disparaît, le texte reste.
    illustration.addEventListener("error", () => illustration.remove());
    wrapper.appendChild(illustration);
  }

  if (article.categorie) wrapper.appendChild(el(doc, "p", "couloir-eyebrow", article.categorie));
  wrapper.appendChild(el(doc, "h1", "couloir-title", article.titre));
  if (article.extrait) wrapper.appendChild(el(doc, "p", "couloir-body", article.extrait));
}

function renderDataView(
  doc: Document,
  wrapper: HTMLElement,
  slide: Extract<RenderedSlide, { kind: "data" }>,
): void {
  if (slide.view.startsWith("timetable")) {
    const day = pickDay(slide.payload, slide.params["classId"]);
    if (!day) return;

    const montre = champsAffichés(slide.params["champs"]);

    wrapper.appendChild(el(doc, "p", "couloir-eyebrow", day.classLabel));

    // Vacances, week-end : on le dit. Une liste vide ressemble à une panne.
    if (day.notice) {
      wrapper.appendChild(el(doc, "p", "couloir-body", day.notice));
      return;
    }

    const list = doc.createElement("ul");
    list.className = "couloir-list";
    for (const entry of day.entries) {
      const changed = entry.change && entry.change !== "none";
      const row = doc.createElement("li");
      row.className = changed ? "couloir-row couloir-row--changed" : "couloir-row";
      if (entry.change === "cancelled") row.classList.add("couloir-row--cancelled");

      const time = doc.createElement("time");
      time.appendChild(doc.createTextNode(entry.time));
      // L'heure de fin, plus discrète, sous l'heure de début : dans un
      // couloir on se demande d'abord « ça commence quand », et seulement
      // ensuite « est-ce que c'est encore en cours ».
      if (montre.has("heureFin") && entry.endTime && entry.endTime !== entry.time) {
        time.appendChild(el(doc, "span", "couloir-fin", entry.endTime));
      }

      const label = doc.createElement("span");
      label.appendChild(doc.createTextNode(entry.subject));
      if (entry.note) label.appendChild(el(doc, "span", "couloir-badge", entry.note));
      // Le module sous l'intitulé : le groupe dit à qui la séance s'adresse,
      // le module dit ce qui s'y passe. L'un sans l'autre laisse chercher.
      if (montre.has("module") && entry.detail) {
        label.appendChild(el(doc, "span", "couloir-detail", entry.detail));
      }

      // Salle et enseignant dans la même colonne : ce sont les deux réponses
      // à « où » et « avec qui », et les séparer en deux colonnes réduirait
      // l'intitulé, qui est ce qu'on lit de loin.
      const lieu = doc.createElement("span");
      lieu.className = "room";
      if (montre.has("salle")) lieu.appendChild(doc.createTextNode(entry.room));
      if (montre.has("enseignant") && entry.teacher) {
        lieu.appendChild(el(doc, "span", "couloir-prof", entry.teacher));
      }

      row.append(time, label, lieu);
      list.appendChild(row);
    }
    wrapper.appendChild(list);
    return;
  }

  if (slide.view.startsWith("news")) {
    renderNews(doc, wrapper, slide);
  }
}
