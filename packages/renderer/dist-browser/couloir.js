const P = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};
function E(e, t) {
  const n = new Intl.DateTimeFormat("en-US", {
    timeZone: t,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: !1
  }).formatToParts(new Date(e)), r = (c) => n.find((i) => i.type === c)?.value ?? "", o = Number(r("hour")) % 24, a = Number(r("minute"));
  return {
    dayOfWeek: P[r("weekday")] ?? 1,
    minutesOfDay: o * 60 + a
  };
}
function x(e) {
  const [t, n] = e.split(":");
  return Number(t) * 60 + Number(n);
}
function S(e, t, n) {
  const r = x(t), o = x(n);
  return r === o ? !0 : r < o ? e >= r && e < o : e >= r || e < o;
}
function A(e, t, n) {
  if (!t) return { status: "never-loaded" };
  const r = Math.max(0, (n - t.fetchedAtMs) / 1e3);
  if (r <= e.maxStaleSec)
    return {
      status: "usable",
      payload: t.payload,
      ageSec: r,
      needsRefresh: r > e.ttlSec
    };
  switch (e.stalePolicy) {
    case "keep-with-date":
      return { status: "stale-shown", payload: t.payload, ageSec: r, fetchedAtMs: t.fetchedAtMs };
    case "hide":
      return { status: "hidden", ageSec: r };
    case "fallback":
      return { status: "fallback", ageSec: r };
  }
}
function z(e) {
  return e.status === "usable" || e.status === "stale-shown";
}
function F(e, t = "fr-FR", n = "Europe/Paris") {
  return e.status !== "stale-shown" ? null : `Mis à jour ${new Intl.DateTimeFormat(t, {
    timeZone: n,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(e.fetchedAtMs))}`;
}
function N(e, t, n) {
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const r = E(t, n);
  return !(e.daysOfWeek && e.daysOfWeek.length > 0 && !e.daysOfWeek.includes(r.dayOfWeek) || e.dailyStart && e.dailyEnd && !S(r.minutesOfDay, e.dailyStart, e.dailyEnd));
}
function D(e, t, n) {
  const r = e.layout.zones.find((i) => i.id === t);
  if (!r) return null;
  const o = e.settings.timezone, a = e.schedules.filter((i) => i.zoneId === t).filter((i) => N(i, n, o));
  if (a.length === 0) return r.playlistId;
  let c = a[0];
  for (const i of a.slice(1))
    i.priority >= c.priority && (c = i);
  return c.playlistId;
}
function O(e, t) {
  const n = E(t, e.timezone);
  return e.displayOff.some((r) => r.daysOfWeek.length > 0 && !r.daysOfWeek.includes(n.dayOfWeek) ? !1 : S(n.minutesOfDay, r.from, r.to));
}
const T = 130, W = 2500, $ = 6e4, R = 1.9;
function _(e) {
  const t = e.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}
function L(e) {
  const t = _(e);
  return Math.round(W + t / T * 6e4);
}
function j(e) {
  return e.kind !== "template" ? "" : Object.values(e.fields).filter((t) => typeof t == "string").join(" ");
}
function q(e) {
  const t = "durationMs" in e && e.durationMs ? e.durationMs : 0, n = L(j(e)), r = Math.min(Math.max(t, n), $);
  return { effectiveMs: r, requestedMs: t, extended: r > t };
}
function U(e) {
  const t = Math.round(e * R / 100);
  return {
    eyebrow: Math.round(t * 0.72),
    title: Math.round(t * 2.4),
    body: t,
    caption: Math.round(t * 0.8)
  };
}
function M(e, t, n) {
  for (let r = 1; r <= e.length; r++) {
    const o = (t + r) % e.length, a = e[o];
    if (a !== void 0 && n(a)) return o;
  }
  return null;
}
function B(e, t) {
  for (let n = 0; n < e.length; n++) {
    const r = e[n];
    if (r !== void 0 && t(r)) return n;
  }
  return null;
}
function Z(e) {
  const { state: t, playlistId: n, slideIds: r, isEligible: o, durationMsOf: a, nowMs: c } = e, i = t && t.playlistId === n ? r[t.index] ?? null : null, s = (f) => {
    if (f === null)
      return { state: null, currentSlideId: null, changed: i !== null };
    const y = r[f];
    return {
      state: { playlistId: n, index: f, slideStartedAtMs: c },
      currentSlideId: y,
      changed: y !== i
    };
  };
  if (!t || t.playlistId !== n || t.index >= r.length)
    return s(B(r, o));
  const u = r[t.index];
  if (u === void 0 || !o(u))
    return s(M(r, t.index, o));
  const p = a(u), b = c - t.slideStartedAtMs;
  if (!(p === null ? e.mediaEnded === !0 : b >= p))
    return { state: t, currentSlideId: u, changed: !1 };
  const m = M(r, t.index, o);
  return s(m === null ? null : m);
}
function H(e) {
  const { manifest: t, nowMs: n } = e, r = new Map(t.slides.map((l) => [l.id, l])), o = new Map(t.assets.map((l) => [l.id, l])), a = new Map(t.playlists.map((l) => [l.id, l])), c = new Map(
    t.dataSources.map((l) => [
      l.id,
      A(l, e.sources.get(l.id), n)
    ])
  ), i = t.settings.showScreenCodeWatermark ? e.screenCode ?? null : null, s = t.emergency;
  if (s && n < Date.parse(s.validUntil))
    return {
      screen: { mode: "emergency", zones: [], emergency: s, identify: null, watermark: i },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (e.identify)
    return {
      screen: { mode: "identify", zones: [], emergency: null, identify: e.identify, watermark: null },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (O(t.settings, n))
    return {
      screen: { mode: "display-off", zones: [], emergency: null, identify: null, watermark: null },
      rotations: new Map(e.rotations),
      transitions: []
    };
  const u = (l) => {
    const h = r.get(l);
    if (!h) return !1;
    switch (h.kind) {
      case "media":
        return e.availableAssetIds.has(h.assetId);
      case "template":
        return h.assetIds.every((v) => e.availableAssetIds.has(v));
      case "widget":
        return !0;
      case "data": {
        const v = c.get(h.sourceId);
        return v !== void 0 && z(v);
      }
    }
  }, p = (l) => {
    const h = r.get(l);
    return h ? h.kind === "media" && h.durationMs === void 0 ? null : q(h).effectiveMs : 0;
  }, b = e.forceFallback ? "fallback" : "normal", d = /* @__PURE__ */ new Map(), m = [], f = [];
  for (const l of t.layout.zones) {
    const h = e.forceFallback ? t.fallbackPlaylistId : D(t, l.id, n) ?? l.playlistId, v = a.get(h), k = e.rotations.get(l.id), C = k && k.playlistId === h ? v?.slideIds[k.index] ?? null : null, w = Z({
      state: k,
      playlistId: h,
      slideIds: v?.slideIds ?? [],
      isEligible: u,
      durationMsOf: p,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(l.id) ?? !1
    });
    w.state && d.set(l.id, w.state), w.changed && m.push({
      zoneId: l.id,
      fromSlideId: C,
      toSlideId: w.currentSlideId,
      atMs: n
    });
    const I = w.currentSlideId ? r.get(w.currentSlideId) : void 0;
    if (f.push({
      zoneId: l.id,
      rect: l.rect,
      playlistId: h,
      slide: I ? X(I, o, c, t.settings.timezone) : null
    }), e.forceFallback) break;
  }
  const y = e.forceFallback ? f.map((l) => ({ ...l, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } })) : G(f);
  return {
    screen: { mode: b, zones: y, emergency: null, identify: null, watermark: i },
    rotations: d,
    transitions: m
  };
}
function X(e, t, n, r) {
  switch (e.kind) {
    case "media": {
      const o = t.get(e.assetId);
      return o ? { kind: "media", slideId: e.id, asset: o } : null;
    }
    case "template":
      return { kind: "template", slideId: e.id, templateId: e.templateId, fields: e.fields };
    case "widget":
      return { kind: "widget", slideId: e.id, widget: e.widget, config: e.config };
    case "data": {
      const o = n.get(e.sourceId);
      return !o || !z(o) ? null : {
        kind: "data",
        slideId: e.id,
        sourceId: e.sourceId,
        view: e.view,
        payload: "payload" in o ? o.payload : null,
        staleLabel: F(o, "fr-FR", r)
      };
    }
  }
}
function G(e) {
  const t = /* @__PURE__ */ new Map();
  for (const s of e) {
    const u = `${s.rect.yPercent}:${s.rect.heightPercent}`, p = t.get(u);
    p ? p.push(s) : t.set(u, [s]);
  }
  const n = [];
  for (const s of t.values()) {
    const u = s.filter((f) => f.slide !== null);
    if (u.length === 0) continue;
    const p = s.reduce((f, y) => f + y.rect.widthPercent, 0), b = u.reduce((f, y) => f + y.rect.widthPercent, 0), d = b > 0 ? p / b : 1;
    let m = Math.min(...s.map((f) => f.rect.xPercent));
    n.push(
      u.map((f) => {
        const y = f.rect.widthPercent * d, l = { ...f, rect: { ...f.rect, xPercent: m, widthPercent: y } };
        return m += y, l;
      })
    );
  }
  if (n.length === 0) return [];
  const r = [...t.values()].reduce((s, u) => s + (u[0]?.rect.heightPercent ?? 0), 0), o = n.reduce((s, u) => s + (u[0]?.rect.heightPercent ?? 0), 0), a = o > 0 ? r / o : 1, c = [];
  let i = Math.min(...e.map((s) => s.rect.yPercent));
  for (const s of n.sort((u, p) => (u[0]?.rect.yPercent ?? 0) - (p[0]?.rect.yPercent ?? 0))) {
    const u = (s[0]?.rect.heightPercent ?? 0) * a;
    for (const p of s)
      c.push({ ...p, rect: { ...p.rect, yPercent: i, heightPercent: u } });
    i += u;
  }
  return c;
}
const Y = `
:host, .couloir-root {
  --ink: #F4F6F4;
  --ink-soft: #A8B2AC;
  --ground: #0E1211;
  --surface: #171C1A;
  --accent: #54BE95;
  --signal: #E4633A;
  --rule: rgba(244, 246, 244, 0.10);
}

.couloir-root {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--ground);
  color: var(--ink);
  font-family: "Archivo", "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.couloir-zone {
  position: absolute;
  overflow: hidden;
  /* Le déplacement d'une zone qui s'étire quand sa voisine se retire. */
  transition: left .5s ease, top .5s ease, width .5s ease, height .5s ease;
}

.couloir-slide {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: var(--pad);
  /* L'entrée n'anime QUE la position, jamais l'opacité.
     Supprimer le mode de remplissage ne suffisait pas : tant qu'une
     animation part d'une opacité nulle, un navigateur qui la gèle — page en
     arrière-plan, compositeur qui cale — fige le contenu à zéro et laisse un
     écran noir. Un déplacement gelé, lui, est au pire un décalage de six
     pixels.
     (Ce bloc est un littéral de gabarit : pas d'accent grave en commentaire,
     il terminerait la chaîne.) */
  opacity: 1;
  animation: couloir-in .45s ease;
}
@keyframes couloir-in {
  from { transform: translateY(6px) }
  to { transform: none }
}
@media (prefers-reduced-motion: reduce) {
  .couloir-slide { animation: none }
  .couloir-zone { transition: none }
}

.couloir-media { width: 100%; height: 100%; object-fit: cover; display: block }
.couloir-slide--media { padding: 0 }

.couloir-eyebrow {
  font-size: var(--fs-eyebrow);
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 600;
  margin-bottom: .6em;
}
.couloir-title {
  font-size: var(--fs-title);
  font-weight: 700;
  line-height: 1.04;
  letter-spacing: -.02em;
  text-wrap: balance;
  margin: 0 0 .35em;
}
.couloir-body {
  font-size: var(--fs-body);
  line-height: 1.45;
  color: var(--ink-soft);
  max-width: 28ch;
  margin: 0;
}

/* --- colonne emploi du temps --- */
.couloir-list { display: flex; flex-direction: column; gap: .5em; margin: 0; padding: 0; list-style: none }
.couloir-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: .8em;
  align-items: baseline;
  font-size: var(--fs-body);
  padding-bottom: .45em;
  border-bottom: 1px solid var(--rule);
}
.couloir-row time { font-variant-numeric: tabular-nums; color: var(--accent); font-weight: 600 }
.couloir-row .room { color: var(--ink-soft); font-size: .85em }
.couloir-row--changed { color: var(--signal) }
.couloir-row--changed time, .couloir-row--changed .room { color: var(--signal) }
.couloir-badge {
  font-size: .7em; letter-spacing: .1em; text-transform: uppercase; font-weight: 700;
  border: 1px solid currentColor; border-radius: 3px; padding: .1em .4em; margin-left: .5em;
}

.couloir-stale {
  margin-top: auto;
  padding-top: .8em;
  font-size: var(--fs-caption);
  color: var(--ink-soft);
  opacity: .8;
}

/* --- bandeau --- */
.couloir-slide--ticker {
  flex-direction: row;
  align-items: center;
  background: var(--surface);
  padding: 0 var(--pad);
  white-space: nowrap;
}
/* Marquee : le texte part du bord droit de la ZONE (padding-left 100 %) et
   défile de sa propre largeur. Translater de 100 % sans ce padding le ferait
   disparaître hors champ une partie du cycle. */
.couloir-ticker-viewport { flex: 1; overflow: hidden; min-width: 0 }
.couloir-ticker-text {
  display: inline-block;
  padding-left: 100%;
  font-size: var(--fs-body);
  animation: couloir-scroll 30s linear infinite;
}
@keyframes couloir-scroll {
  from { transform: translateX(0) } to { transform: translateX(-100%) }
}
@media (prefers-reduced-motion: reduce) {
  .couloir-ticker-text { animation: none; padding-left: 0 }
}

.couloir-clock {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-body);
  font-weight: 600;
  padding-left: 1em;
}

/* --- plein écran : urgence, repérage, repli --- */
.couloir-full {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center; padding: var(--pad); gap: .4em;
}
/* Contraste maximal : c'est le corps du message qui dit où aller. Les
   couleurs de la rotation normale ne s'appliquent pas ici. */
.couloir-full--emergency { background: var(--signal); color: #FFFFFF }
.couloir-full--emergency .couloir-title { font-size: calc(var(--fs-title) * 1.5) }
.couloir-full--emergency .couloir-eyebrow { color: #FFFFFF; opacity: .85 }
.couloir-full--emergency .couloir-body {
  color: #FFFFFF;
  font-size: calc(var(--fs-body) * 1.25);
  max-width: 34ch;
}

.couloir-full--identify { background: var(--accent); color: #06120E }
.couloir-full--identify .couloir-body { color: #06120E; opacity: .75 }
.couloir-full--identify .couloir-code {
  font-size: calc(var(--fs-title) * 2.6);
  font-weight: 700;
  letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
}
.couloir-full--off { background: #000 }

.couloir-watermark {
  position: absolute;
  right: .6em; bottom: .5em;
  font-size: var(--fs-caption);
  color: var(--ink-soft);
  opacity: .35;
  letter-spacing: .08em;
  pointer-events: none;
}
`;
function J(e, t = {}) {
  const n = e.ownerDocument, r = n.createElement("style");
  r.textContent = Y, e.appendChild(r);
  const o = n.createElement("div");
  o.className = "couloir-root", e.appendChild(o);
  let a = () => {
  };
  const c = /* @__PURE__ */ new Map();
  let i = "";
  const s = () => {
    const d = o.clientHeight || 1080, m = U(d);
    o.style.setProperty("--fs-eyebrow", `${m.eyebrow}px`), o.style.setProperty("--fs-title", `${m.title}px`), o.style.setProperty("--fs-body", `${m.body}px`), o.style.setProperty("--fs-caption", `${m.caption}px`), o.style.setProperty("--pad", `${Math.round(d * 0.045)}px`);
  }, u = new ResizeObserver(s);
  u.observe(o), s();
  function p(d) {
    const m = `${d.mode}:${d.emergency?.id ?? ""}:${d.identify?.screenCode ?? ""}`;
    if (d.mode === "normal" || d.mode === "fallback") return !1;
    if (m === i) return !0;
    i = m, o.replaceChildren(), c.clear();
    const f = n.createElement("div");
    return d.mode === "emergency" && d.emergency ? (f.className = "couloir-full couloir-full--emergency", f.append(
      g(n, "p", "couloir-eyebrow", "Message important"),
      g(n, "h1", "couloir-title", d.emergency.title)
    ), d.emergency.body && f.append(g(n, "p", "couloir-body", d.emergency.body))) : d.mode === "identify" && d.identify ? (f.className = "couloir-full couloir-full--identify", f.append(
      g(n, "div", "couloir-code", d.identify.screenCode),
      g(n, "p", "couloir-body", d.identify.label),
      g(n, "p", "couloir-body", d.identify.ipAddress)
    )) : f.className = "couloir-full couloir-full--off", o.appendChild(f), !0;
  }
  function b(d) {
    i !== "" && (o.replaceChildren(), c.clear(), i = "");
    const m = /* @__PURE__ */ new Set();
    for (const y of d.zones) {
      m.add(y.zoneId);
      let l = o.querySelector(`[data-zone="${y.zoneId}"]`);
      l || (l = n.createElement("section"), l.className = "couloir-zone", l.dataset.zone = y.zoneId, o.appendChild(l)), l.style.left = `${y.rect.xPercent}%`, l.style.top = `${y.rect.yPercent}%`, l.style.width = `${y.rect.widthPercent}%`, l.style.height = `${y.rect.heightPercent}%`;
      const h = y.slide?.slideId ?? null;
      if (c.get(y.zoneId) !== h) {
        if (l.replaceChildren(), h === null) {
          c.delete(y.zoneId);
          continue;
        }
        c.set(y.zoneId, h), l.appendChild(K(n, y, y.slide, t, a));
      }
    }
    for (const y of [...o.querySelectorAll("[data-zone]")]) {
      const l = y.dataset.zone;
      l && !m.has(l) && (y.remove(), c.delete(l));
    }
    let f = o.querySelector(".couloir-watermark");
    d.watermark ? (f || (f = g(n, "div", "couloir-watermark", d.watermark), o.appendChild(f)), f.textContent = d.watermark) : f?.remove();
  }
  return {
    update(d) {
      p(d) || b(d);
    },
    onMediaEnded(d) {
      a = d;
    },
    destroy() {
      u.disconnect(), o.remove(), r.remove();
    }
  };
}
function g(e, t, n, r) {
  const o = e.createElement(t);
  return o.className = n, r !== void 0 && (o.textContent = r), o;
}
function K(e, t, n, r, o) {
  const a = e.createElement("div");
  switch (a.className = "couloir-slide", a.dataset.slide = n.slideId, n.kind) {
    case "media": {
      a.classList.add("couloir-slide--media");
      const c = r.assetUrl?.(n.asset.id) ?? n.asset.url;
      if (n.asset.mime.startsWith("video/")) {
        const i = e.createElement("video");
        i.className = "couloir-media", i.src = c, i.muted = !0, i.autoplay = !0, i.playsInline = !0, i.addEventListener("ended", () => o(t.zoneId)), i.addEventListener("error", () => o(t.zoneId)), a.appendChild(i);
      } else {
        const i = e.createElement("img");
        i.className = "couloir-media", i.src = c, i.alt = "", a.appendChild(i);
      }
      return a;
    }
    case "template": {
      const c = (p) => {
        const b = n.fields[p];
        return typeof b == "string" ? b : void 0;
      }, i = c("eyebrow"), s = c("titre") ?? c("title"), u = c("texte") ?? c("body");
      return i && a.appendChild(g(e, "p", "couloir-eyebrow", i)), s && a.appendChild(g(e, "h1", "couloir-title", s)), u && a.appendChild(g(e, "p", "couloir-body", u)), a;
    }
    case "widget": {
      if (n.widget === "ticker") {
        a.classList.add("couloir-slide--ticker");
        const c = typeof n.config.text == "string" ? n.config.text : "", i = g(e, "div", "couloir-ticker-viewport");
        i.appendChild(g(e, "span", "couloir-ticker-text", c)), a.appendChild(i);
        const s = g(e, "div", "couloir-clock", ""), u = () => {
          s.textContent = new Intl.DateTimeFormat(r.locale ?? "fr-FR", {
            timeZone: r.timezone ?? "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit"
          }).format(/* @__PURE__ */ new Date());
        };
        u();
        const p = setInterval(u, 1e4);
        return new MutationObserver((b, d) => {
          s.isConnected || (clearInterval(p), d.disconnect());
        }).observe(a.ownerDocument.body, { childList: !0, subtree: !0 }), a.appendChild(s), a;
      }
      return a.appendChild(g(e, "p", "couloir-eyebrow", n.widget)), a;
    }
    case "data":
      return Q(e, a, n), n.staleLabel && a.appendChild(g(e, "p", "couloir-stale", n.staleLabel)), a;
  }
}
function Q(e, t, n) {
  if (n.view.startsWith("timetable")) {
    const a = Array.isArray(n.payload) ? n.payload : [];
    t.appendChild(g(e, "p", "couloir-eyebrow", "Cours du jour"));
    const c = e.createElement("ul");
    c.className = "couloir-list";
    for (const i of a) {
      const s = e.createElement("li");
      s.className = i.changed ? "couloir-row couloir-row--changed" : "couloir-row";
      const u = e.createElement("time");
      u.textContent = i.time;
      const p = e.createElement("span");
      p.textContent = i.subject, i.note && p.appendChild(g(e, "span", "couloir-badge", i.note)), s.append(u, p, g(e, "span", "room", i.room)), c.appendChild(s);
    }
    t.appendChild(c);
    return;
  }
  const o = (Array.isArray(n.payload) ? n.payload : [])[0];
  o && (o.category && t.appendChild(g(e, "p", "couloir-eyebrow", o.category)), t.appendChild(g(e, "h1", "couloir-title", o.title)), o.excerpt && t.appendChild(g(e, "p", "couloir-body", o.excerpt)));
}
function te(e, t) {
  const n = J(e, t), r = t.pollMs ?? 2e3, o = t.tickMs ?? 500;
  let a = null, c = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Set(), s = !1;
  n.onMediaEnded((m) => {
    i.add(m), p();
  });
  async function u() {
    if (!s)
      try {
        const m = await fetch(t.stateUrl, { cache: "no-store" });
        if (m.ok) {
          const f = await m.json();
          f.manifest?.version !== a?.manifest?.version && (c = /* @__PURE__ */ new Map()), a = f;
        }
      } catch {
      }
  }
  function p() {
    if (s) return;
    if (!a?.manifest) {
      n.update(V(a));
      return;
    }
    const m = H({
      manifest: a.manifest,
      nowMs: Date.now(),
      sources: new Map(Object.entries(a.sources)),
      availableAssetIds: new Set(a.availableAssetIds),
      rotations: c,
      forceFallback: a.forceFallback,
      identify: a.identify,
      mediaEndedZoneIds: i,
      ...a.screenCode !== null ? { screenCode: a.screenCode } : {}
    });
    i = /* @__PURE__ */ new Set(), c = m.rotations, n.update(m.screen), m.transitions.length > 0 && t.transitionsUrl && ee(t.transitionsUrl, m.transitions);
  }
  const b = setInterval(() => void u(), r), d = setInterval(p, o);
  return u().then(p), {
    stop() {
      s = !0, clearInterval(b), clearInterval(d), n.destroy();
    }
  };
}
function V(e) {
  return e?.pairing ? {
    mode: "identify",
    zones: [],
    emergency: null,
    identify: {
      screenCode: e.pairing.code,
      label: "Saisissez ce code dans la console pour rattacher cet écran",
      ipAddress: ""
    },
    watermark: null
  } : {
    mode: "normal",
    zones: [
      {
        zoneId: "attente",
        rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
        playlistId: "attente",
        slide: {
          kind: "template",
          slideId: "attente",
          templateId: "identite-ecole",
          fields: { eyebrow: "Écran en préparation", titre: "Bienvenue" }
        }
      }
    ],
    emergency: null,
    identify: null,
    watermark: e?.screenCode ?? null
  };
}
async function ee(e, t) {
  try {
    await fetch(e, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transitions: t }),
      keepalive: !0
    });
  } catch {
  }
}
export {
  W as GLANCE_TIME_MS,
  $ as MAX_SENSIBLE_DURATION_MS,
  R as MIN_BODY_TEXT_HEIGHT_PERCENT,
  T as READING_WORDS_PER_MINUTE,
  Y as RENDERER_CSS,
  D as activePlaylistId,
  Z as advanceRotation,
  G as collapseEmptyZones,
  _ as countWords,
  H as direct,
  q as effectiveDuration,
  O as isDisplayOffPeriod,
  z as isDisplayable,
  N as isScheduleActive,
  S as isWithinDailyWindow,
  E as localMoment,
  L as minReadableDurationMs,
  J as mountRenderer,
  x as parseClock,
  A as resolveSource,
  j as slideText,
  F as stalenessLabel,
  te as startPlayer,
  U as typeScale
};
