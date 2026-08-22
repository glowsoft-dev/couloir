const P = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};
function C(e, t) {
  const n = new Intl.DateTimeFormat("en-US", {
    timeZone: t,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: !1
  }).formatToParts(new Date(e)), o = (c) => n.find((i) => i.type === c)?.value ?? "", r = Number(o("hour")) % 24, a = Number(o("minute"));
  return {
    dayOfWeek: P[o("weekday")] ?? 1,
    minutesOfDay: r * 60 + a
  };
}
function I(e) {
  const [t, n] = e.split(":");
  return Number(t) * 60 + Number(n);
}
function S(e, t, n) {
  const o = I(t), r = I(n);
  return o === r ? !0 : o < r ? e >= o && e < r : e >= o || e < r;
}
function A(e, t, n) {
  if (!t) return { status: "never-loaded" };
  const o = Math.max(0, (n - t.fetchedAtMs) / 1e3);
  if (o <= e.maxStaleSec)
    return {
      status: "usable",
      payload: t.payload,
      ageSec: o,
      needsRefresh: o > e.ttlSec
    };
  switch (e.stalePolicy) {
    case "keep-with-date":
      return { status: "stale-shown", payload: t.payload, ageSec: o, fetchedAtMs: t.fetchedAtMs };
    case "hide":
      return { status: "hidden", ageSec: o };
    case "fallback":
      return { status: "fallback", ageSec: o };
  }
}
function E(e) {
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
function O(e, t, n) {
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const o = C(t, n);
  return !(e.daysOfWeek && e.daysOfWeek.length > 0 && !e.daysOfWeek.includes(o.dayOfWeek) || e.dailyStart && e.dailyEnd && !S(o.minutesOfDay, e.dailyStart, e.dailyEnd));
}
function D(e, t, n) {
  const o = e.layout.zones.find((i) => i.id === t);
  if (!o) return null;
  const r = e.settings.timezone, a = e.schedules.filter((i) => i.zoneId === t).filter((i) => O(i, n, r));
  if (a.length === 0) return o.playlistId;
  let c = a[0];
  for (const i of a.slice(1))
    i.priority >= c.priority && (c = i);
  return c.playlistId;
}
function N(e, t) {
  const n = C(t, e.timezone), o = (n.dayOfWeek + 5) % 7 + 1;
  return e.displayOff.some((r) => {
    if (!S(n.minutesOfDay, r.from, r.to)) return !1;
    if (r.daysOfWeek.length === 0) return !0;
    const a = I(r.from), c = I(r.to), i = a > c && n.minutesOfDay < c;
    return r.daysOfWeek.includes(i ? o : n.dayOfWeek);
  });
}
const T = 130, W = 2500, L = 6e4, $ = 1.9;
function R(e) {
  const t = e.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}
function _(e) {
  const t = R(e);
  return Math.round(W + t / T * 6e4);
}
function q(e) {
  return e.kind !== "template" ? "" : Object.values(e.fields).filter((t) => typeof t == "string").join(" ");
}
function U(e) {
  const t = "durationMs" in e && e.durationMs ? e.durationMs : 0, n = _(q(e)), o = Math.min(Math.max(t, n), L);
  return { effectiveMs: o, requestedMs: t, extended: o > t };
}
function j(e) {
  const t = Math.round(e * $ / 100);
  return {
    eyebrow: Math.round(t * 0.72),
    title: Math.round(t * 2.4),
    body: t,
    caption: Math.round(t * 0.8)
  };
}
function M(e, t, n) {
  for (let o = 1; o <= e.length; o++) {
    const r = (t + o) % e.length, a = e[r];
    if (a !== void 0 && n(a)) return r;
  }
  return null;
}
function B(e, t) {
  for (let n = 0; n < e.length; n++) {
    const o = e[n];
    if (o !== void 0 && t(o)) return n;
  }
  return null;
}
function Z(e) {
  const { state: t, playlistId: n, slideIds: o, isEligible: r, durationMsOf: a, nowMs: c } = e, i = t && t.playlistId === n ? o[t.index] ?? null : null, d = (l) => {
    if (l === null)
      return { state: null, currentSlideId: null, changed: i !== null };
    const m = o[l];
    return {
      state: { playlistId: n, index: l, slideStartedAtMs: c },
      currentSlideId: m,
      changed: m !== i
    };
  };
  if (!t || t.playlistId !== n || t.index >= o.length)
    return d(B(o, r));
  const u = o[t.index];
  if (u === void 0 || !r(u))
    return d(M(o, t.index, r));
  const p = a(u), h = c - t.slideStartedAtMs;
  if (!(p === null ? e.mediaEnded === !0 : h >= p))
    return { state: t, currentSlideId: u, changed: !1 };
  const g = M(o, t.index, r);
  return d(g === null ? null : g);
}
function H(e) {
  const { manifest: t, nowMs: n } = e, o = new Map(t.slides.map((s) => [s.id, s])), r = new Map(t.assets.map((s) => [s.id, s])), a = new Map(t.playlists.map((s) => [s.id, s])), c = new Map(
    t.dataSources.map((s) => [
      s.id,
      A(s, e.sources.get(s.id), n)
    ])
  ), i = t.settings.showScreenCodeWatermark ? e.screenCode ?? null : null, d = t.emergency;
  if (d && n < Date.parse(d.validUntil))
    return {
      screen: { mode: "emergency", zones: [], emergency: d, identify: null, watermark: i },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (e.identify)
    return {
      screen: { mode: "identify", zones: [], emergency: null, identify: e.identify, watermark: null },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (N(t.settings, n))
    return {
      screen: { mode: "display-off", zones: [], emergency: null, identify: null, watermark: null },
      rotations: new Map(e.rotations),
      transitions: []
    };
  const u = (s) => {
    const b = o.get(s);
    if (!b) return !1;
    switch (b.kind) {
      case "media":
        return e.availableAssetIds.has(b.assetId);
      case "template":
        return b.assetIds.every((v) => e.availableAssetIds.has(v));
      case "widget":
        return !0;
      case "data": {
        const v = c.get(b.sourceId);
        return v !== void 0 && E(v);
      }
    }
  }, p = (s) => {
    const b = o.get(s);
    return b ? b.kind === "media" && b.durationMs === void 0 ? null : U(b).effectiveMs : 0;
  }, h = e.forceFallback ? "fallback" : "normal", f = /* @__PURE__ */ new Map(), g = [], l = [];
  for (const s of t.layout.zones) {
    const b = e.forceFallback ? t.fallbackPlaylistId : D(t, s.id, n) ?? s.playlistId, v = a.get(b), k = e.rotations.get(s.id), z = k && k.playlistId === b ? v?.slideIds[k.index] ?? null : null, w = Z({
      state: k,
      playlistId: b,
      slideIds: v?.slideIds ?? [],
      isEligible: u,
      durationMsOf: p,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(s.id) ?? !1
    });
    w.state && f.set(s.id, w.state), w.changed && g.push({
      zoneId: s.id,
      fromSlideId: z,
      toSlideId: w.currentSlideId,
      atMs: n
    });
    const x = w.currentSlideId ? o.get(w.currentSlideId) : void 0;
    if (l.push({
      zoneId: s.id,
      rect: s.rect,
      playlistId: b,
      slide: x ? X(x, r, c, t.settings.timezone) : null
    }), e.forceFallback) break;
  }
  const m = e.forceFallback ? l.map((s) => ({ ...s, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } })) : G(l);
  return {
    screen: { mode: h, zones: m, emergency: null, identify: null, watermark: i },
    rotations: f,
    transitions: g
  };
}
function X(e, t, n, o) {
  switch (e.kind) {
    case "media": {
      const r = t.get(e.assetId);
      return r ? { kind: "media", slideId: e.id, asset: r } : null;
    }
    case "template":
      return { kind: "template", slideId: e.id, templateId: e.templateId, fields: e.fields };
    case "widget":
      return { kind: "widget", slideId: e.id, widget: e.widget, config: e.config };
    case "data": {
      const r = n.get(e.sourceId);
      return !r || !E(r) ? null : {
        kind: "data",
        slideId: e.id,
        sourceId: e.sourceId,
        view: e.view,
        payload: "payload" in r ? r.payload : null,
        params: e.params,
        staleLabel: F(r, "fr-FR", o)
      };
    }
  }
}
function G(e) {
  const t = /* @__PURE__ */ new Map();
  for (const d of e) {
    const u = `${d.rect.yPercent}:${d.rect.heightPercent}`, p = t.get(u);
    p ? p.push(d) : t.set(u, [d]);
  }
  const n = [];
  for (const d of t.values()) {
    const u = d.filter((l) => l.slide !== null);
    if (u.length === 0) continue;
    const p = d.reduce((l, m) => l + m.rect.widthPercent, 0), h = u.reduce((l, m) => l + m.rect.widthPercent, 0), f = h > 0 ? p / h : 1;
    let g = Math.min(...d.map((l) => l.rect.xPercent));
    n.push(
      u.map((l) => {
        const m = l.rect.widthPercent * f, s = { ...l, rect: { ...l.rect, xPercent: g, widthPercent: m } };
        return g += m, s;
      })
    );
  }
  if (n.length === 0) return [];
  const o = [...t.values()].reduce((d, u) => d + (u[0]?.rect.heightPercent ?? 0), 0), r = n.reduce((d, u) => d + (u[0]?.rect.heightPercent ?? 0), 0), a = r > 0 ? o / r : 1, c = [];
  let i = Math.min(...e.map((d) => d.rect.yPercent));
  for (const d of n.sort((u, p) => (u[0]?.rect.yPercent ?? 0) - (p[0]?.rect.yPercent ?? 0))) {
    const u = (d[0]?.rect.heightPercent ?? 0) * a;
    for (const p of d)
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
/* Annulé : barré, mais TOUJOURS affiché. Le faire disparaître priverait
   l'élève de l'information qui l'intéresse le plus. */
.couloir-row--cancelled time, .couloir-row--cancelled > span:nth-child(2) { text-decoration: line-through }
.couloir-row--cancelled { opacity: .78 }
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
  const n = e.ownerDocument, o = n.createElement("style");
  o.textContent = Y, e.appendChild(o);
  const r = n.createElement("div");
  r.className = "couloir-root", e.appendChild(r);
  let a = () => {
  };
  const c = /* @__PURE__ */ new Map();
  let i = "";
  const d = () => {
    const f = r.clientHeight || 1080, g = j(f);
    r.style.setProperty("--fs-eyebrow", `${g.eyebrow}px`), r.style.setProperty("--fs-title", `${g.title}px`), r.style.setProperty("--fs-body", `${g.body}px`), r.style.setProperty("--fs-caption", `${g.caption}px`), r.style.setProperty("--pad", `${Math.round(f * 0.045)}px`);
  }, u = new ResizeObserver(d);
  u.observe(r), d();
  function p(f) {
    const g = `${f.mode}:${f.emergency?.id ?? ""}:${f.identify?.screenCode ?? ""}`;
    if (f.mode === "normal" || f.mode === "fallback") return !1;
    if (g === i) return !0;
    i = g, r.replaceChildren(), c.clear();
    const l = n.createElement("div");
    return f.mode === "emergency" && f.emergency ? (l.className = "couloir-full couloir-full--emergency", l.append(
      y(n, "p", "couloir-eyebrow", "Message important"),
      y(n, "h1", "couloir-title", f.emergency.title)
    ), f.emergency.body && l.append(y(n, "p", "couloir-body", f.emergency.body))) : f.mode === "identify" && f.identify ? (l.className = "couloir-full couloir-full--identify", l.append(
      y(n, "div", "couloir-code", f.identify.screenCode),
      y(n, "p", "couloir-body", f.identify.label),
      y(n, "p", "couloir-body", f.identify.ipAddress)
    )) : l.className = "couloir-full couloir-full--off", r.appendChild(l), !0;
  }
  function h(f) {
    i !== "" && (r.replaceChildren(), c.clear(), i = "");
    const g = /* @__PURE__ */ new Set();
    for (const m of f.zones) {
      g.add(m.zoneId);
      let s = r.querySelector(`[data-zone="${m.zoneId}"]`);
      s || (s = n.createElement("section"), s.className = "couloir-zone", s.dataset.zone = m.zoneId, r.appendChild(s)), s.style.left = `${m.rect.xPercent}%`, s.style.top = `${m.rect.yPercent}%`, s.style.width = `${m.rect.widthPercent}%`, s.style.height = `${m.rect.heightPercent}%`;
      const b = m.slide?.slideId ?? null;
      if (c.get(m.zoneId) !== b) {
        if (s.replaceChildren(), b === null) {
          c.delete(m.zoneId);
          continue;
        }
        c.set(m.zoneId, b), s.appendChild(V(n, m, m.slide, t, a));
      }
    }
    for (const m of [...r.querySelectorAll("[data-zone]")]) {
      const s = m.dataset.zone;
      s && !g.has(s) && (m.remove(), c.delete(s));
    }
    let l = r.querySelector(".couloir-watermark");
    f.watermark ? (l || (l = y(n, "div", "couloir-watermark", f.watermark), r.appendChild(l)), l.textContent = f.watermark) : l?.remove();
  }
  return {
    update(f) {
      p(f) || h(f);
    },
    onMediaEnded(f) {
      a = f;
    },
    destroy() {
      u.disconnect(), r.remove(), o.remove();
    }
  };
}
function y(e, t, n, o) {
  const r = e.createElement(t);
  return r.className = n, o !== void 0 && (r.textContent = o), r;
}
function V(e, t, n, o, r) {
  const a = e.createElement("div");
  switch (a.className = "couloir-slide", a.dataset.slide = n.slideId, n.kind) {
    case "media": {
      a.classList.add("couloir-slide--media");
      const c = o.assetUrl?.(n.asset.id) ?? n.asset.url;
      if (n.asset.mime.startsWith("video/")) {
        const i = e.createElement("video");
        i.className = "couloir-media", i.src = c, i.muted = !0, i.autoplay = !0, i.playsInline = !0, i.addEventListener("ended", () => r(t.zoneId)), i.addEventListener("error", () => r(t.zoneId)), a.appendChild(i);
      } else {
        const i = e.createElement("img");
        i.className = "couloir-media", i.src = c, i.alt = "", a.appendChild(i);
      }
      return a;
    }
    case "template": {
      const c = (p) => {
        const h = n.fields[p];
        return typeof h == "string" ? h : void 0;
      }, i = c("eyebrow"), d = c("titre") ?? c("title"), u = c("texte") ?? c("body");
      return i && a.appendChild(y(e, "p", "couloir-eyebrow", i)), d && a.appendChild(y(e, "h1", "couloir-title", d)), u && a.appendChild(y(e, "p", "couloir-body", u)), a;
    }
    case "widget": {
      if (n.widget === "ticker") {
        a.classList.add("couloir-slide--ticker");
        const c = typeof n.config.text == "string" ? n.config.text : "", i = y(e, "div", "couloir-ticker-viewport");
        i.appendChild(y(e, "span", "couloir-ticker-text", c)), a.appendChild(i);
        const d = y(e, "div", "couloir-clock", ""), u = () => {
          d.textContent = new Intl.DateTimeFormat(o.locale ?? "fr-FR", {
            timeZone: o.timezone ?? "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit"
          }).format(/* @__PURE__ */ new Date());
        };
        u();
        const p = setInterval(u, 1e4);
        return new MutationObserver((h, f) => {
          d.isConnected || (clearInterval(p), f.disconnect());
        }).observe(a.ownerDocument.body, { childList: !0, subtree: !0 }), a.appendChild(d), a;
      }
      return a.appendChild(y(e, "p", "couloir-eyebrow", n.widget)), a;
    }
    case "data":
      return Q(e, a, n), n.staleLabel && a.appendChild(y(e, "p", "couloir-stale", n.staleLabel)), a;
  }
}
function K(e, t) {
  const n = e?.days;
  if (Array.isArray(n))
    return t ? n.find((r) => r.classId === t) ?? null : n[0] ?? null;
  const o = e;
  return o && Array.isArray(o.entries) ? o : null;
}
function Q(e, t, n) {
  if (n.view.startsWith("timetable")) {
    const a = K(n.payload, n.params.classId);
    if (!a) return;
    if (t.appendChild(y(e, "p", "couloir-eyebrow", a.classLabel)), a.notice) {
      t.appendChild(y(e, "p", "couloir-body", a.notice));
      return;
    }
    const c = e.createElement("ul");
    c.className = "couloir-list";
    for (const i of a.entries) {
      const d = i.change && i.change !== "none", u = e.createElement("li");
      u.className = d ? "couloir-row couloir-row--changed" : "couloir-row", i.change === "cancelled" && u.classList.add("couloir-row--cancelled");
      const p = e.createElement("time");
      p.textContent = i.time;
      const h = e.createElement("span");
      h.textContent = i.subject, i.note && h.appendChild(y(e, "span", "couloir-badge", i.note)), u.append(p, h, y(e, "span", "room", i.room)), c.appendChild(u);
    }
    t.appendChild(c);
    return;
  }
  const r = (Array.isArray(n.payload) ? n.payload : [])[0];
  r && (r.category && t.appendChild(y(e, "p", "couloir-eyebrow", r.category)), t.appendChild(y(e, "h1", "couloir-title", r.title)), r.excerpt && t.appendChild(y(e, "p", "couloir-body", r.excerpt)));
}
function ne(e, t) {
  const n = J(e, t), o = t.pollMs ?? 2e3, r = t.tickMs ?? 500;
  let a = null, c = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Set(), d = !1;
  n.onMediaEnded((l) => {
    i.add(l), h();
  });
  function u(l) {
    if (typeof document > "u") return;
    const m = l.screenCode ? l.screenCode : l.pairing ? `À rattacher · ${l.pairing.code}` : "Couloir";
    document.title !== m && (document.title = m);
  }
  async function p() {
    if (!d)
      try {
        const l = await fetch(t.stateUrl, { cache: "no-store" });
        if (l.ok) {
          const m = await l.json();
          m.manifest?.version !== a?.manifest?.version && (c = /* @__PURE__ */ new Map()), a = m, u(m);
        }
      } catch {
      }
  }
  function h() {
    if (d) return;
    if (!a?.manifest) {
      n.update(ee(a));
      return;
    }
    const l = H({
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
    i = /* @__PURE__ */ new Set(), c = l.rotations, n.update(l.screen), l.transitions.length > 0 && t.transitionsUrl && te(t.transitionsUrl, l.transitions);
  }
  const f = setInterval(() => void p(), o), g = setInterval(h, r);
  return p().then(h), {
    stop() {
      d = !0, clearInterval(f), clearInterval(g), n.destroy();
    }
  };
}
function ee(e) {
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
async function te(e, t) {
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
  L as MAX_SENSIBLE_DURATION_MS,
  $ as MIN_BODY_TEXT_HEIGHT_PERCENT,
  T as READING_WORDS_PER_MINUTE,
  Y as RENDERER_CSS,
  D as activePlaylistId,
  Z as advanceRotation,
  G as collapseEmptyZones,
  R as countWords,
  H as direct,
  U as effectiveDuration,
  N as isDisplayOffPeriod,
  E as isDisplayable,
  O as isScheduleActive,
  S as isWithinDailyWindow,
  C as localMoment,
  _ as minReadableDurationMs,
  J as mountRenderer,
  I as parseClock,
  A as resolveSource,
  q as slideText,
  F as stalenessLabel,
  ne as startPlayer,
  j as typeScale
};
