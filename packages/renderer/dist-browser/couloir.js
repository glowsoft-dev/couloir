const P = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};
function S(e, t) {
  const n = new Intl.DateTimeFormat("en-US", {
    timeZone: t,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: !1
  }).formatToParts(new Date(e)), r = (c) => n.find((o) => o.type === c)?.value ?? "", i = Number(r("hour")) % 24, a = Number(r("minute"));
  return {
    dayOfWeek: P[r("weekday")] ?? 1,
    minutesOfDay: i * 60 + a
  };
}
function x(e) {
  const [t, n] = e.split(":");
  return Number(t) * 60 + Number(n);
}
function E(e, t, n) {
  const r = x(t), i = x(n);
  return r === i ? !0 : r < i ? e >= r && e < i : e >= r || e < i;
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
  const r = S(t, n);
  return !(e.daysOfWeek && e.daysOfWeek.length > 0 && !e.daysOfWeek.includes(r.dayOfWeek) || e.dailyStart && e.dailyEnd && !E(r.minutesOfDay, e.dailyStart, e.dailyEnd));
}
function D(e, t, n) {
  const r = e.layout.zones.find((o) => o.id === t);
  if (!r) return null;
  const i = e.settings.timezone, a = e.schedules.filter((o) => o.zoneId === t).filter((o) => N(o, n, i));
  if (a.length === 0) return r.playlistId;
  let c = a[0];
  for (const o of a.slice(1))
    o.priority >= c.priority && (c = o);
  return c.playlistId;
}
function O(e, t) {
  const n = S(t, e.timezone);
  return e.displayOff.some((r) => r.daysOfWeek.length > 0 && !r.daysOfWeek.includes(n.dayOfWeek) ? !1 : E(n.minutesOfDay, r.from, r.to));
}
const T = 130, W = 2500, L = 6e4, R = 1.9;
function $(e) {
  const t = e.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}
function _(e) {
  const t = $(e);
  return Math.round(W + t / T * 6e4);
}
function q(e) {
  return e.kind !== "template" ? "" : Object.values(e.fields).filter((t) => typeof t == "string").join(" ");
}
function U(e) {
  const t = "durationMs" in e && e.durationMs ? e.durationMs : 0, n = _(q(e)), r = Math.min(Math.max(t, n), L);
  return { effectiveMs: r, requestedMs: t, extended: r > t };
}
function j(e) {
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
    const i = (t + r) % e.length, a = e[i];
    if (a !== void 0 && n(a)) return i;
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
  const { state: t, playlistId: n, slideIds: r, isEligible: i, durationMsOf: a, nowMs: c } = e, o = t && t.playlistId === n ? r[t.index] ?? null : null, s = (f) => {
    if (f === null)
      return { state: null, currentSlideId: null, changed: o !== null };
    const p = r[f];
    return {
      state: { playlistId: n, index: f, slideStartedAtMs: c },
      currentSlideId: p,
      changed: p !== o
    };
  };
  if (!t || t.playlistId !== n || t.index >= r.length)
    return s(B(r, i));
  const d = r[t.index];
  if (d === void 0 || !i(d))
    return s(M(r, t.index, i));
  const y = a(d), b = c - t.slideStartedAtMs;
  if (!(y === null ? e.mediaEnded === !0 : b >= y))
    return { state: t, currentSlideId: d, changed: !1 };
  const m = M(r, t.index, i);
  return s(m === null ? null : m);
}
function H(e) {
  const { manifest: t, nowMs: n } = e, r = new Map(t.slides.map((l) => [l.id, l])), i = new Map(t.assets.map((l) => [l.id, l])), a = new Map(t.playlists.map((l) => [l.id, l])), c = new Map(
    t.dataSources.map((l) => [
      l.id,
      A(l, e.sources.get(l.id), n)
    ])
  ), o = t.settings.showScreenCodeWatermark ? e.screenCode ?? null : null, s = t.emergency;
  if (s && n < Date.parse(s.validUntil))
    return {
      screen: { mode: "emergency", zones: [], emergency: s, identify: null, watermark: o },
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
  const d = (l) => {
    const h = r.get(l);
    if (!h) return !1;
    switch (h.kind) {
      case "media":
        return e.availableAssetIds.has(h.assetId);
      case "template":
        return h.assetIds.every((w) => e.availableAssetIds.has(w));
      case "widget":
        return !0;
      case "data": {
        const w = c.get(h.sourceId);
        return w !== void 0 && z(w);
      }
    }
  }, y = (l) => {
    const h = r.get(l);
    return h ? h.kind === "media" && h.durationMs === void 0 ? null : U(h).effectiveMs : 0;
  }, b = e.forceFallback ? "fallback" : "normal", u = /* @__PURE__ */ new Map(), m = [], f = [];
  for (const l of t.layout.zones) {
    const h = e.forceFallback ? t.fallbackPlaylistId : D(t, l.id, n) ?? l.playlistId, w = a.get(h), k = e.rotations.get(l.id), C = k && k.playlistId === h ? w?.slideIds[k.index] ?? null : null, v = Z({
      state: k,
      playlistId: h,
      slideIds: w?.slideIds ?? [],
      isEligible: d,
      durationMsOf: y,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(l.id) ?? !1
    });
    v.state && u.set(l.id, v.state), v.changed && m.push({
      zoneId: l.id,
      fromSlideId: C,
      toSlideId: v.currentSlideId,
      atMs: n
    });
    const I = v.currentSlideId ? r.get(v.currentSlideId) : void 0;
    if (f.push({
      zoneId: l.id,
      rect: l.rect,
      playlistId: h,
      slide: I ? X(I, i, c, t.settings.timezone) : null
    }), e.forceFallback) break;
  }
  const p = e.forceFallback ? f.map((l) => ({ ...l, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } })) : G(f);
  return {
    screen: { mode: b, zones: p, emergency: null, identify: null, watermark: o },
    rotations: u,
    transitions: m
  };
}
function X(e, t, n, r) {
  switch (e.kind) {
    case "media": {
      const i = t.get(e.assetId);
      return i ? { kind: "media", slideId: e.id, asset: i } : null;
    }
    case "template":
      return { kind: "template", slideId: e.id, templateId: e.templateId, fields: e.fields };
    case "widget":
      return { kind: "widget", slideId: e.id, widget: e.widget, config: e.config };
    case "data": {
      const i = n.get(e.sourceId);
      return !i || !z(i) ? null : {
        kind: "data",
        slideId: e.id,
        sourceId: e.sourceId,
        view: e.view,
        payload: "payload" in i ? i.payload : null,
        params: e.params,
        staleLabel: F(i, "fr-FR", r)
      };
    }
  }
}
function G(e) {
  const t = /* @__PURE__ */ new Map();
  for (const s of e) {
    const d = `${s.rect.yPercent}:${s.rect.heightPercent}`, y = t.get(d);
    y ? y.push(s) : t.set(d, [s]);
  }
  const n = [];
  for (const s of t.values()) {
    const d = s.filter((f) => f.slide !== null);
    if (d.length === 0) continue;
    const y = s.reduce((f, p) => f + p.rect.widthPercent, 0), b = d.reduce((f, p) => f + p.rect.widthPercent, 0), u = b > 0 ? y / b : 1;
    let m = Math.min(...s.map((f) => f.rect.xPercent));
    n.push(
      d.map((f) => {
        const p = f.rect.widthPercent * u, l = { ...f, rect: { ...f.rect, xPercent: m, widthPercent: p } };
        return m += p, l;
      })
    );
  }
  if (n.length === 0) return [];
  const r = [...t.values()].reduce((s, d) => s + (d[0]?.rect.heightPercent ?? 0), 0), i = n.reduce((s, d) => s + (d[0]?.rect.heightPercent ?? 0), 0), a = i > 0 ? r / i : 1, c = [];
  let o = Math.min(...e.map((s) => s.rect.yPercent));
  for (const s of n.sort((d, y) => (d[0]?.rect.yPercent ?? 0) - (y[0]?.rect.yPercent ?? 0))) {
    const d = (s[0]?.rect.heightPercent ?? 0) * a;
    for (const y of s)
      c.push({ ...y, rect: { ...y.rect, yPercent: o, heightPercent: d } });
    o += d;
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
  const n = e.ownerDocument, r = n.createElement("style");
  r.textContent = Y, e.appendChild(r);
  const i = n.createElement("div");
  i.className = "couloir-root", e.appendChild(i);
  let a = () => {
  };
  const c = /* @__PURE__ */ new Map();
  let o = "";
  const s = () => {
    const u = i.clientHeight || 1080, m = j(u);
    i.style.setProperty("--fs-eyebrow", `${m.eyebrow}px`), i.style.setProperty("--fs-title", `${m.title}px`), i.style.setProperty("--fs-body", `${m.body}px`), i.style.setProperty("--fs-caption", `${m.caption}px`), i.style.setProperty("--pad", `${Math.round(u * 0.045)}px`);
  }, d = new ResizeObserver(s);
  d.observe(i), s();
  function y(u) {
    const m = `${u.mode}:${u.emergency?.id ?? ""}:${u.identify?.screenCode ?? ""}`;
    if (u.mode === "normal" || u.mode === "fallback") return !1;
    if (m === o) return !0;
    o = m, i.replaceChildren(), c.clear();
    const f = n.createElement("div");
    return u.mode === "emergency" && u.emergency ? (f.className = "couloir-full couloir-full--emergency", f.append(
      g(n, "p", "couloir-eyebrow", "Message important"),
      g(n, "h1", "couloir-title", u.emergency.title)
    ), u.emergency.body && f.append(g(n, "p", "couloir-body", u.emergency.body))) : u.mode === "identify" && u.identify ? (f.className = "couloir-full couloir-full--identify", f.append(
      g(n, "div", "couloir-code", u.identify.screenCode),
      g(n, "p", "couloir-body", u.identify.label),
      g(n, "p", "couloir-body", u.identify.ipAddress)
    )) : f.className = "couloir-full couloir-full--off", i.appendChild(f), !0;
  }
  function b(u) {
    o !== "" && (i.replaceChildren(), c.clear(), o = "");
    const m = /* @__PURE__ */ new Set();
    for (const p of u.zones) {
      m.add(p.zoneId);
      let l = i.querySelector(`[data-zone="${p.zoneId}"]`);
      l || (l = n.createElement("section"), l.className = "couloir-zone", l.dataset.zone = p.zoneId, i.appendChild(l)), l.style.left = `${p.rect.xPercent}%`, l.style.top = `${p.rect.yPercent}%`, l.style.width = `${p.rect.widthPercent}%`, l.style.height = `${p.rect.heightPercent}%`;
      const h = p.slide?.slideId ?? null;
      if (c.get(p.zoneId) !== h) {
        if (l.replaceChildren(), h === null) {
          c.delete(p.zoneId);
          continue;
        }
        c.set(p.zoneId, h), l.appendChild(K(n, p, p.slide, t, a));
      }
    }
    for (const p of [...i.querySelectorAll("[data-zone]")]) {
      const l = p.dataset.zone;
      l && !m.has(l) && (p.remove(), c.delete(l));
    }
    let f = i.querySelector(".couloir-watermark");
    u.watermark ? (f || (f = g(n, "div", "couloir-watermark", u.watermark), i.appendChild(f)), f.textContent = u.watermark) : f?.remove();
  }
  return {
    update(u) {
      y(u) || b(u);
    },
    onMediaEnded(u) {
      a = u;
    },
    destroy() {
      d.disconnect(), i.remove(), r.remove();
    }
  };
}
function g(e, t, n, r) {
  const i = e.createElement(t);
  return i.className = n, r !== void 0 && (i.textContent = r), i;
}
function K(e, t, n, r, i) {
  const a = e.createElement("div");
  switch (a.className = "couloir-slide", a.dataset.slide = n.slideId, n.kind) {
    case "media": {
      a.classList.add("couloir-slide--media");
      const c = r.assetUrl?.(n.asset.id) ?? n.asset.url;
      if (n.asset.mime.startsWith("video/")) {
        const o = e.createElement("video");
        o.className = "couloir-media", o.src = c, o.muted = !0, o.autoplay = !0, o.playsInline = !0, o.addEventListener("ended", () => i(t.zoneId)), o.addEventListener("error", () => i(t.zoneId)), a.appendChild(o);
      } else {
        const o = e.createElement("img");
        o.className = "couloir-media", o.src = c, o.alt = "", a.appendChild(o);
      }
      return a;
    }
    case "template": {
      const c = (y) => {
        const b = n.fields[y];
        return typeof b == "string" ? b : void 0;
      }, o = c("eyebrow"), s = c("titre") ?? c("title"), d = c("texte") ?? c("body");
      return o && a.appendChild(g(e, "p", "couloir-eyebrow", o)), s && a.appendChild(g(e, "h1", "couloir-title", s)), d && a.appendChild(g(e, "p", "couloir-body", d)), a;
    }
    case "widget": {
      if (n.widget === "ticker") {
        a.classList.add("couloir-slide--ticker");
        const c = typeof n.config.text == "string" ? n.config.text : "", o = g(e, "div", "couloir-ticker-viewport");
        o.appendChild(g(e, "span", "couloir-ticker-text", c)), a.appendChild(o);
        const s = g(e, "div", "couloir-clock", ""), d = () => {
          s.textContent = new Intl.DateTimeFormat(r.locale ?? "fr-FR", {
            timeZone: r.timezone ?? "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit"
          }).format(/* @__PURE__ */ new Date());
        };
        d();
        const y = setInterval(d, 1e4);
        return new MutationObserver((b, u) => {
          s.isConnected || (clearInterval(y), u.disconnect());
        }).observe(a.ownerDocument.body, { childList: !0, subtree: !0 }), a.appendChild(s), a;
      }
      return a.appendChild(g(e, "p", "couloir-eyebrow", n.widget)), a;
    }
    case "data":
      return V(e, a, n), n.staleLabel && a.appendChild(g(e, "p", "couloir-stale", n.staleLabel)), a;
  }
}
function Q(e, t) {
  const n = e?.days;
  if (Array.isArray(n))
    return t ? n.find((i) => i.classId === t) ?? null : n[0] ?? null;
  const r = e;
  return r && Array.isArray(r.entries) ? r : null;
}
function V(e, t, n) {
  if (n.view.startsWith("timetable")) {
    const a = Q(n.payload, n.params.classId);
    if (!a) return;
    if (t.appendChild(g(e, "p", "couloir-eyebrow", a.classLabel)), a.notice) {
      t.appendChild(g(e, "p", "couloir-body", a.notice));
      return;
    }
    const c = e.createElement("ul");
    c.className = "couloir-list";
    for (const o of a.entries) {
      const s = o.change && o.change !== "none", d = e.createElement("li");
      d.className = s ? "couloir-row couloir-row--changed" : "couloir-row", o.change === "cancelled" && d.classList.add("couloir-row--cancelled");
      const y = e.createElement("time");
      y.textContent = o.time;
      const b = e.createElement("span");
      b.textContent = o.subject, o.note && b.appendChild(g(e, "span", "couloir-badge", o.note)), d.append(y, b, g(e, "span", "room", o.room)), c.appendChild(d);
    }
    t.appendChild(c);
    return;
  }
  const i = (Array.isArray(n.payload) ? n.payload : [])[0];
  i && (i.category && t.appendChild(g(e, "p", "couloir-eyebrow", i.category)), t.appendChild(g(e, "h1", "couloir-title", i.title)), i.excerpt && t.appendChild(g(e, "p", "couloir-body", i.excerpt)));
}
function ne(e, t) {
  const n = J(e, t), r = t.pollMs ?? 2e3, i = t.tickMs ?? 500;
  let a = null, c = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Set(), s = !1;
  n.onMediaEnded((m) => {
    o.add(m), y();
  });
  async function d() {
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
  function y() {
    if (s) return;
    if (!a?.manifest) {
      n.update(ee(a));
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
      mediaEndedZoneIds: o,
      ...a.screenCode !== null ? { screenCode: a.screenCode } : {}
    });
    o = /* @__PURE__ */ new Set(), c = m.rotations, n.update(m.screen), m.transitions.length > 0 && t.transitionsUrl && te(t.transitionsUrl, m.transitions);
  }
  const b = setInterval(() => void d(), r), u = setInterval(y, i);
  return d().then(y), {
    stop() {
      s = !0, clearInterval(b), clearInterval(u), n.destroy();
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
  R as MIN_BODY_TEXT_HEIGHT_PERCENT,
  T as READING_WORDS_PER_MINUTE,
  Y as RENDERER_CSS,
  D as activePlaylistId,
  Z as advanceRotation,
  G as collapseEmptyZones,
  $ as countWords,
  H as direct,
  U as effectiveDuration,
  O as isDisplayOffPeriod,
  z as isDisplayable,
  N as isScheduleActive,
  E as isWithinDailyWindow,
  S as localMoment,
  _ as minReadableDurationMs,
  J as mountRenderer,
  x as parseClock,
  A as resolveSource,
  q as slideText,
  F as stalenessLabel,
  ne as startPlayer,
  j as typeScale
};
