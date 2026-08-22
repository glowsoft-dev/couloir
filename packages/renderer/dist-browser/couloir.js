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
  }).formatToParts(new Date(e)), o = (s) => n.find((i) => i.type === s)?.value ?? "", r = Number(o("hour")) % 24, a = Number(o("minute"));
  return {
    dayOfWeek: P[o("weekday")] ?? 1,
    minutesOfDay: r * 60 + a
  };
}
function I(e) {
  const [t, n] = e.split(":");
  return Number(t) * 60 + Number(n);
}
function E(e, t, n) {
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
function D(e, t, n) {
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const o = S(t, n);
  return !(e.daysOfWeek && e.daysOfWeek.length > 0 && !e.daysOfWeek.includes(o.dayOfWeek) || e.dailyStart && e.dailyEnd && !E(o.minutesOfDay, e.dailyStart, e.dailyEnd));
}
function N(e, t, n) {
  const o = e.layout.zones.find((i) => i.id === t);
  if (!o) return null;
  const r = e.settings.timezone, a = e.schedules.filter((i) => i.zoneId === t).filter((i) => D(i, n, r));
  if (a.length === 0) return o.playlistId;
  let s = a[0];
  for (const i of a.slice(1))
    i.priority >= s.priority && (s = i);
  return s.playlistId;
}
function O(e, t) {
  const n = S(t, e.timezone), o = (n.dayOfWeek + 5) % 7 + 1;
  return e.displayOff.some((r) => {
    if (!E(n.minutesOfDay, r.from, r.to)) return !1;
    if (r.daysOfWeek.length === 0) return !0;
    const a = I(r.from), s = I(r.to), i = a > s && n.minutesOfDay < s;
    return r.daysOfWeek.includes(i ? o : n.dayOfWeek);
  });
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
  const t = "durationMs" in e && e.durationMs ? e.durationMs : 0, n = _(q(e)), o = Math.min(Math.max(t, n), L);
  return { effectiveMs: o, requestedMs: t, extended: o > t };
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
  const { state: t, playlistId: n, slideIds: o, isEligible: r, durationMsOf: a, nowMs: s } = e, i = t && t.playlistId === n ? o[t.index] ?? null : null, c = (f) => {
    if (f === null)
      return { state: null, currentSlideId: null, changed: i !== null };
    const p = o[f];
    return {
      state: { playlistId: n, index: f, slideStartedAtMs: s },
      currentSlideId: p,
      changed: p !== i
    };
  };
  if (!t || t.playlistId !== n || t.index >= o.length)
    return c(B(o, r));
  const d = o[t.index];
  if (d === void 0 || !r(d))
    return c(M(o, t.index, r));
  const y = a(d), b = s - t.slideStartedAtMs;
  if (!(y === null ? e.mediaEnded === !0 : b >= y))
    return { state: t, currentSlideId: d, changed: !1 };
  const m = M(o, t.index, r);
  return c(m === null ? null : m);
}
function H(e) {
  const { manifest: t, nowMs: n } = e, o = new Map(t.slides.map((l) => [l.id, l])), r = new Map(t.assets.map((l) => [l.id, l])), a = new Map(t.playlists.map((l) => [l.id, l])), s = new Map(
    t.dataSources.map((l) => [
      l.id,
      A(l, e.sources.get(l.id), n)
    ])
  ), i = t.settings.showScreenCodeWatermark ? e.screenCode ?? null : null, c = t.emergency;
  if (c && n < Date.parse(c.validUntil))
    return {
      screen: { mode: "emergency", zones: [], emergency: c, identify: null, watermark: i },
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
    const h = o.get(l);
    if (!h) return !1;
    switch (h.kind) {
      case "media":
        return e.availableAssetIds.has(h.assetId);
      case "template":
        return h.assetIds.every((v) => e.availableAssetIds.has(v));
      case "widget":
        return !0;
      case "data": {
        const v = s.get(h.sourceId);
        return v !== void 0 && z(v);
      }
    }
  }, y = (l) => {
    const h = o.get(l);
    return h ? h.kind === "media" && h.durationMs === void 0 ? null : U(h).effectiveMs : 0;
  }, b = e.forceFallback ? "fallback" : "normal", u = /* @__PURE__ */ new Map(), m = [], f = [];
  for (const l of t.layout.zones) {
    const h = e.forceFallback ? t.fallbackPlaylistId : N(t, l.id, n) ?? l.playlistId, v = a.get(h), k = e.rotations.get(l.id), C = k && k.playlistId === h ? v?.slideIds[k.index] ?? null : null, w = Z({
      state: k,
      playlistId: h,
      slideIds: v?.slideIds ?? [],
      isEligible: d,
      durationMsOf: y,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(l.id) ?? !1
    });
    w.state && u.set(l.id, w.state), w.changed && m.push({
      zoneId: l.id,
      fromSlideId: C,
      toSlideId: w.currentSlideId,
      atMs: n
    });
    const x = w.currentSlideId ? o.get(w.currentSlideId) : void 0;
    if (f.push({
      zoneId: l.id,
      rect: l.rect,
      playlistId: h,
      slide: x ? X(x, r, s, t.settings.timezone) : null
    }), e.forceFallback) break;
  }
  const p = e.forceFallback ? f.map((l) => ({ ...l, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } })) : G(f);
  return {
    screen: { mode: b, zones: p, emergency: null, identify: null, watermark: i },
    rotations: u,
    transitions: m
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
      return !r || !z(r) ? null : {
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
  for (const c of e) {
    const d = `${c.rect.yPercent}:${c.rect.heightPercent}`, y = t.get(d);
    y ? y.push(c) : t.set(d, [c]);
  }
  const n = [];
  for (const c of t.values()) {
    const d = c.filter((f) => f.slide !== null);
    if (d.length === 0) continue;
    const y = c.reduce((f, p) => f + p.rect.widthPercent, 0), b = d.reduce((f, p) => f + p.rect.widthPercent, 0), u = b > 0 ? y / b : 1;
    let m = Math.min(...c.map((f) => f.rect.xPercent));
    n.push(
      d.map((f) => {
        const p = f.rect.widthPercent * u, l = { ...f, rect: { ...f.rect, xPercent: m, widthPercent: p } };
        return m += p, l;
      })
    );
  }
  if (n.length === 0) return [];
  const o = [...t.values()].reduce((c, d) => c + (d[0]?.rect.heightPercent ?? 0), 0), r = n.reduce((c, d) => c + (d[0]?.rect.heightPercent ?? 0), 0), a = r > 0 ? o / r : 1, s = [];
  let i = Math.min(...e.map((c) => c.rect.yPercent));
  for (const c of n.sort((d, y) => (d[0]?.rect.yPercent ?? 0) - (y[0]?.rect.yPercent ?? 0))) {
    const d = (c[0]?.rect.heightPercent ?? 0) * a;
    for (const y of c)
      s.push({ ...y, rect: { ...y.rect, yPercent: i, heightPercent: d } });
    i += d;
  }
  return s;
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
  const s = /* @__PURE__ */ new Map();
  let i = "";
  const c = () => {
    const u = r.clientHeight || 1080, m = j(u);
    r.style.setProperty("--fs-eyebrow", `${m.eyebrow}px`), r.style.setProperty("--fs-title", `${m.title}px`), r.style.setProperty("--fs-body", `${m.body}px`), r.style.setProperty("--fs-caption", `${m.caption}px`), r.style.setProperty("--pad", `${Math.round(u * 0.045)}px`);
  }, d = new ResizeObserver(c);
  d.observe(r), c();
  function y(u) {
    const m = `${u.mode}:${u.emergency?.id ?? ""}:${u.identify?.screenCode ?? ""}`;
    if (u.mode === "normal" || u.mode === "fallback") return !1;
    if (m === i) return !0;
    i = m, r.replaceChildren(), s.clear();
    const f = n.createElement("div");
    return u.mode === "emergency" && u.emergency ? (f.className = "couloir-full couloir-full--emergency", f.append(
      g(n, "p", "couloir-eyebrow", "Message important"),
      g(n, "h1", "couloir-title", u.emergency.title)
    ), u.emergency.body && f.append(g(n, "p", "couloir-body", u.emergency.body))) : u.mode === "identify" && u.identify ? (f.className = "couloir-full couloir-full--identify", f.append(
      g(n, "div", "couloir-code", u.identify.screenCode),
      g(n, "p", "couloir-body", u.identify.label),
      g(n, "p", "couloir-body", u.identify.ipAddress)
    )) : f.className = "couloir-full couloir-full--off", r.appendChild(f), !0;
  }
  function b(u) {
    i !== "" && (r.replaceChildren(), s.clear(), i = "");
    const m = /* @__PURE__ */ new Set();
    for (const p of u.zones) {
      m.add(p.zoneId);
      let l = r.querySelector(`[data-zone="${p.zoneId}"]`);
      l || (l = n.createElement("section"), l.className = "couloir-zone", l.dataset.zone = p.zoneId, r.appendChild(l)), l.style.left = `${p.rect.xPercent}%`, l.style.top = `${p.rect.yPercent}%`, l.style.width = `${p.rect.widthPercent}%`, l.style.height = `${p.rect.heightPercent}%`;
      const h = p.slide?.slideId ?? null;
      if (s.get(p.zoneId) !== h) {
        if (l.replaceChildren(), h === null) {
          s.delete(p.zoneId);
          continue;
        }
        s.set(p.zoneId, h), l.appendChild(V(n, p, p.slide, t, a));
      }
    }
    for (const p of [...r.querySelectorAll("[data-zone]")]) {
      const l = p.dataset.zone;
      l && !m.has(l) && (p.remove(), s.delete(l));
    }
    let f = r.querySelector(".couloir-watermark");
    u.watermark ? (f || (f = g(n, "div", "couloir-watermark", u.watermark), r.appendChild(f)), f.textContent = u.watermark) : f?.remove();
  }
  return {
    update(u) {
      y(u) || b(u);
    },
    onMediaEnded(u) {
      a = u;
    },
    destroy() {
      d.disconnect(), r.remove(), o.remove();
    }
  };
}
function g(e, t, n, o) {
  const r = e.createElement(t);
  return r.className = n, o !== void 0 && (r.textContent = o), r;
}
function V(e, t, n, o, r) {
  const a = e.createElement("div");
  switch (a.className = "couloir-slide", a.dataset.slide = n.slideId, n.kind) {
    case "media": {
      a.classList.add("couloir-slide--media");
      const s = o.assetUrl?.(n.asset.id) ?? n.asset.url;
      if (n.asset.mime.startsWith("video/")) {
        const i = e.createElement("video");
        i.className = "couloir-media", i.src = s, i.muted = !0, i.autoplay = !0, i.playsInline = !0, i.addEventListener("ended", () => r(t.zoneId)), i.addEventListener("error", () => r(t.zoneId)), a.appendChild(i);
      } else {
        const i = e.createElement("img");
        i.className = "couloir-media", i.src = s, i.alt = "", a.appendChild(i);
      }
      return a;
    }
    case "template": {
      const s = (y) => {
        const b = n.fields[y];
        return typeof b == "string" ? b : void 0;
      }, i = s("eyebrow"), c = s("titre") ?? s("title"), d = s("texte") ?? s("body");
      return i && a.appendChild(g(e, "p", "couloir-eyebrow", i)), c && a.appendChild(g(e, "h1", "couloir-title", c)), d && a.appendChild(g(e, "p", "couloir-body", d)), a;
    }
    case "widget": {
      if (n.widget === "ticker") {
        a.classList.add("couloir-slide--ticker");
        const s = typeof n.config.text == "string" ? n.config.text : "", i = g(e, "div", "couloir-ticker-viewport");
        i.appendChild(g(e, "span", "couloir-ticker-text", s)), a.appendChild(i);
        const c = g(e, "div", "couloir-clock", ""), d = () => {
          c.textContent = new Intl.DateTimeFormat(o.locale ?? "fr-FR", {
            timeZone: o.timezone ?? "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit"
          }).format(/* @__PURE__ */ new Date());
        };
        d();
        const y = setInterval(d, 1e4);
        return new MutationObserver((b, u) => {
          c.isConnected || (clearInterval(y), u.disconnect());
        }).observe(a.ownerDocument.body, { childList: !0, subtree: !0 }), a.appendChild(c), a;
      }
      return a.appendChild(g(e, "p", "couloir-eyebrow", n.widget)), a;
    }
    case "data":
      return Q(e, a, n), n.staleLabel && a.appendChild(g(e, "p", "couloir-stale", n.staleLabel)), a;
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
    if (t.appendChild(g(e, "p", "couloir-eyebrow", a.classLabel)), a.notice) {
      t.appendChild(g(e, "p", "couloir-body", a.notice));
      return;
    }
    const s = e.createElement("ul");
    s.className = "couloir-list";
    for (const i of a.entries) {
      const c = i.change && i.change !== "none", d = e.createElement("li");
      d.className = c ? "couloir-row couloir-row--changed" : "couloir-row", i.change === "cancelled" && d.classList.add("couloir-row--cancelled");
      const y = e.createElement("time");
      y.textContent = i.time;
      const b = e.createElement("span");
      b.textContent = i.subject, i.note && b.appendChild(g(e, "span", "couloir-badge", i.note)), d.append(y, b, g(e, "span", "room", i.room)), s.appendChild(d);
    }
    t.appendChild(s);
    return;
  }
  const r = (Array.isArray(n.payload) ? n.payload : [])[0];
  r && (r.category && t.appendChild(g(e, "p", "couloir-eyebrow", r.category)), t.appendChild(g(e, "h1", "couloir-title", r.title)), r.excerpt && t.appendChild(g(e, "p", "couloir-body", r.excerpt)));
}
function ne(e, t) {
  const n = J(e, t), o = t.pollMs ?? 2e3, r = t.tickMs ?? 500;
  let a = null, s = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Set(), c = !1;
  n.onMediaEnded((m) => {
    i.add(m), y();
  });
  async function d() {
    if (!c)
      try {
        const m = await fetch(t.stateUrl, { cache: "no-store" });
        if (m.ok) {
          const f = await m.json();
          f.manifest?.version !== a?.manifest?.version && (s = /* @__PURE__ */ new Map()), a = f;
        }
      } catch {
      }
  }
  function y() {
    if (c) return;
    if (!a?.manifest) {
      n.update(ee(a));
      return;
    }
    const m = H({
      manifest: a.manifest,
      nowMs: Date.now(),
      sources: new Map(Object.entries(a.sources)),
      availableAssetIds: new Set(a.availableAssetIds),
      rotations: s,
      forceFallback: a.forceFallback,
      identify: a.identify,
      mediaEndedZoneIds: i,
      ...a.screenCode !== null ? { screenCode: a.screenCode } : {}
    });
    i = /* @__PURE__ */ new Set(), s = m.rotations, n.update(m.screen), m.transitions.length > 0 && t.transitionsUrl && te(t.transitionsUrl, m.transitions);
  }
  const b = setInterval(() => void d(), o), u = setInterval(y, r);
  return d().then(y), {
    stop() {
      c = !0, clearInterval(b), clearInterval(u), n.destroy();
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
  N as activePlaylistId,
  Z as advanceRotation,
  G as collapseEmptyZones,
  $ as countWords,
  H as direct,
  U as effectiveDuration,
  O as isDisplayOffPeriod,
  z as isDisplayable,
  D as isScheduleActive,
  E as isWithinDailyWindow,
  S as localMoment,
  _ as minReadableDurationMs,
  J as mountRenderer,
  I as parseClock,
  A as resolveSource,
  q as slideText,
  F as stalenessLabel,
  ne as startPlayer,
  j as typeScale
};
