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
  }).formatToParts(new Date(e)), r = (l) => n.find((a) => a.type === l)?.value ?? "", i = Number(r("hour")) % 24, o = Number(r("minute"));
  return {
    dayOfWeek: P[r("weekday")] ?? 1,
    minutesOfDay: i * 60 + o
  };
}
function I(e) {
  const [t, n] = e.split(":");
  return Number(t) * 60 + Number(n);
}
function E(e, t, n) {
  const r = I(t), i = I(n);
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
function S(e) {
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
  const r = C(t, n);
  return !(e.daysOfWeek && e.daysOfWeek.length > 0 && !e.daysOfWeek.includes(r.dayOfWeek) || e.dailyStart && e.dailyEnd && !E(r.minutesOfDay, e.dailyStart, e.dailyEnd));
}
function O(e, t, n) {
  const r = e.layout.zones.find((a) => a.id === t);
  if (!r) return null;
  const i = e.settings.timezone, o = e.schedules.filter((a) => a.zoneId === t).filter((a) => N(a, n, i));
  if (o.length === 0) return r.playlistId;
  let l = o[0];
  for (const a of o.slice(1))
    a.priority >= l.priority && (l = a);
  return l.playlistId;
}
function D(e, t) {
  const n = C(t, e.timezone), r = (n.dayOfWeek + 5) % 7 + 1;
  return e.displayOff.some((i) => {
    if (!E(n.minutesOfDay, i.from, i.to)) return !1;
    if (i.daysOfWeek.length === 0) return !0;
    const o = I(i.from), l = I(i.to), a = o > l && n.minutesOfDay < l;
    return i.daysOfWeek.includes(a ? r : n.dayOfWeek);
  });
}
const L = 130, W = 2500, T = 6e4, q = 1.9;
function $(e) {
  const t = e.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}
function R(e) {
  const t = $(e);
  return Math.round(W + t / L * 6e4);
}
function _(e) {
  return e.kind !== "template" ? "" : Object.values(e.fields).filter((t) => typeof t == "string").join(" ");
}
function U(e) {
  const t = "durationMs" in e && e.durationMs ? e.durationMs : 0, n = R(_(e)), r = Math.min(Math.max(t, n), T);
  return { effectiveMs: r, requestedMs: t, extended: r > t };
}
function j(e) {
  const t = Math.round(e * q / 100);
  return {
    eyebrow: Math.round(t * 0.72),
    title: Math.round(t * 2.4),
    body: t,
    caption: Math.round(t * 0.8)
  };
}
function M(e, t, n) {
  for (let r = 1; r <= e.length; r++) {
    const i = (t + r) % e.length, o = e[i];
    if (o !== void 0 && n(o)) return i;
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
  const { state: t, playlistId: n, slideIds: r, isEligible: i, durationMsOf: o, nowMs: l } = e, a = t && t.playlistId === n ? r[t.index] ?? null : null, d = (s) => {
    if (s === null)
      return { state: null, currentSlideId: null, changed: a !== null };
    const m = r[s];
    return {
      state: { playlistId: n, index: s, slideStartedAtMs: l },
      currentSlideId: m,
      changed: m !== a
    };
  };
  if (!t || t.playlistId !== n || t.index >= r.length)
    return d(B(r, i));
  const f = r[t.index];
  if (f === void 0 || !i(f))
    return d(M(r, t.index, i));
  const p = o(f), b = l - t.slideStartedAtMs;
  if (!(p === null ? e.mediaEnded === !0 : b >= p))
    return { state: t, currentSlideId: f, changed: !1 };
  const g = M(r, t.index, i);
  return d(g === null ? null : g);
}
function H(e) {
  const { manifest: t, nowMs: n } = e, r = new Map(t.slides.map((c) => [c.id, c])), i = new Map(t.assets.map((c) => [c.id, c])), o = new Map(t.playlists.map((c) => [c.id, c])), l = new Map(
    t.dataSources.map((c) => [
      c.id,
      A(c, e.sources.get(c.id), n)
    ])
  ), a = t.settings.showScreenCodeWatermark ? e.screenCode ?? null : null, d = t.emergency;
  if (d && n < Date.parse(d.validUntil))
    return {
      screen: { mode: "emergency", zones: [], emergency: d, identify: null, watermark: a },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (e.identify)
    return {
      screen: { mode: "identify", zones: [], emergency: null, identify: e.identify, watermark: null },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (D(t.settings, n))
    return {
      screen: { mode: "display-off", zones: [], emergency: null, identify: null, watermark: null },
      rotations: new Map(e.rotations),
      transitions: []
    };
  const f = (c) => {
    const h = r.get(c);
    if (!h) return !1;
    switch (h.kind) {
      case "media":
        return e.availableAssetIds.has(h.assetId);
      case "template":
        return h.assetIds.every((v) => e.availableAssetIds.has(v));
      case "widget":
        return !0;
      case "data": {
        const v = l.get(h.sourceId);
        return v !== void 0 && S(v);
      }
    }
  }, p = (c) => {
    const h = r.get(c);
    return h ? h.kind === "media" && h.durationMs === void 0 ? null : U(h).effectiveMs : 0;
  }, b = e.forceFallback ? "fallback" : "normal", u = /* @__PURE__ */ new Map(), g = [], s = [];
  for (const c of t.layout.zones) {
    const h = e.forceFallback ? t.fallbackPlaylistId : O(t, c.id, n) ?? c.playlistId, v = o.get(h), k = e.rotations.get(c.id), z = k && k.playlistId === h ? v?.slideIds[k.index] ?? null : null, w = Z({
      state: k,
      playlistId: h,
      slideIds: v?.slideIds ?? [],
      isEligible: f,
      durationMsOf: p,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(c.id) ?? !1
    });
    w.state && u.set(c.id, w.state), w.changed && g.push({
      zoneId: c.id,
      fromSlideId: z,
      toSlideId: w.currentSlideId,
      atMs: n
    });
    const x = w.currentSlideId ? r.get(w.currentSlideId) : void 0;
    if (s.push({
      zoneId: c.id,
      rect: c.rect,
      playlistId: h,
      slide: x ? X(x, i, l, t.settings.timezone) : null
    }), e.forceFallback) break;
  }
  const m = e.forceFallback ? s.map((c) => ({ ...c, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } })) : G(s);
  return {
    screen: { mode: b, zones: m, emergency: null, identify: null, watermark: a },
    rotations: u,
    transitions: g
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
      return !i || !S(i) ? null : {
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
  for (const d of e) {
    const f = `${d.rect.yPercent}:${d.rect.heightPercent}`, p = t.get(f);
    p ? p.push(d) : t.set(f, [d]);
  }
  const n = [];
  for (const d of t.values()) {
    const f = d.filter((s) => s.slide !== null);
    if (f.length === 0) continue;
    const p = d.reduce((s, m) => s + m.rect.widthPercent, 0), b = f.reduce((s, m) => s + m.rect.widthPercent, 0), u = b > 0 ? p / b : 1;
    let g = Math.min(...d.map((s) => s.rect.xPercent));
    n.push(
      f.map((s) => {
        const m = s.rect.widthPercent * u, c = { ...s, rect: { ...s.rect, xPercent: g, widthPercent: m } };
        return g += m, c;
      })
    );
  }
  if (n.length === 0) return [];
  const r = [...t.values()].reduce((d, f) => d + (f[0]?.rect.heightPercent ?? 0), 0), i = n.reduce((d, f) => d + (f[0]?.rect.heightPercent ?? 0), 0), o = i > 0 ? r / i : 1, l = [];
  let a = Math.min(...e.map((d) => d.rect.yPercent));
  for (const d of n.sort((f, p) => (f[0]?.rect.yPercent ?? 0) - (p[0]?.rect.yPercent ?? 0))) {
    const f = (d[0]?.rect.heightPercent ?? 0) * o;
    for (const p of d)
      l.push({ ...p, rect: { ...p.rect, yPercent: a, heightPercent: f } });
    a += f;
  }
  return l;
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

/* --- actualités du site --- */

/* L'illustration occupe le haut de la diapositive sans écraser le titre :
   c'est le titre qu'on lit à quatre mètres, l'image ne fait qu'attirer
   l'oeil. Hauteur bornée en pourcentage pour tenir aussi bien dans une
   colonne étroite que sur une dalle entière. */
.couloir-illustration {
  width: 100%;
  max-height: 46%;
  object-fit: cover;
  border-radius: .18em;
  margin-bottom: .7em;
  display: block;
}

/* Un extrait sous une image pleine largeur ne doit pas se replier sur une
   colonne étroite : la mesure de 28 caractères convient à la colonne des
   cours, pas à une dalle entière. Le titre reste ce qu'on lit de loin ;
   l'extrait, on le lit en s'approchant, et il peut respirer. */
.couloir-slide:has(> .couloir-illustration) .couloir-body { max-width: 52ch; }

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
  let o = () => {
  };
  const l = /* @__PURE__ */ new Map();
  let a = "";
  const d = () => {
    const u = i.clientHeight || 1080, g = j(u);
    i.style.setProperty("--fs-eyebrow", `${g.eyebrow}px`), i.style.setProperty("--fs-title", `${g.title}px`), i.style.setProperty("--fs-body", `${g.body}px`), i.style.setProperty("--fs-caption", `${g.caption}px`), i.style.setProperty("--pad", `${Math.round(u * 0.045)}px`);
  }, f = new ResizeObserver(d);
  f.observe(i), d();
  function p(u) {
    const g = `${u.mode}:${u.emergency?.id ?? ""}:${u.identify?.screenCode ?? ""}`;
    if (u.mode === "normal" || u.mode === "fallback") return !1;
    if (g === a) return !0;
    a = g, i.replaceChildren(), l.clear();
    const s = n.createElement("div");
    return u.mode === "emergency" && u.emergency ? (s.className = "couloir-full couloir-full--emergency", s.append(
      y(n, "p", "couloir-eyebrow", "Message important"),
      y(n, "h1", "couloir-title", u.emergency.title)
    ), u.emergency.body && s.append(y(n, "p", "couloir-body", u.emergency.body))) : u.mode === "identify" && u.identify ? (s.className = "couloir-full couloir-full--identify", s.append(
      y(n, "div", "couloir-code", u.identify.screenCode),
      y(n, "p", "couloir-body", u.identify.label),
      y(n, "p", "couloir-body", u.identify.ipAddress)
    )) : s.className = "couloir-full couloir-full--off", i.appendChild(s), !0;
  }
  function b(u) {
    a !== "" && (i.replaceChildren(), l.clear(), a = "");
    const g = /* @__PURE__ */ new Set();
    for (const m of u.zones) {
      g.add(m.zoneId);
      let c = i.querySelector(`[data-zone="${m.zoneId}"]`);
      c || (c = n.createElement("section"), c.className = "couloir-zone", c.dataset.zone = m.zoneId, i.appendChild(c)), c.style.left = `${m.rect.xPercent}%`, c.style.top = `${m.rect.yPercent}%`, c.style.width = `${m.rect.widthPercent}%`, c.style.height = `${m.rect.heightPercent}%`;
      const h = m.slide?.slideId ?? null;
      if (l.get(m.zoneId) !== h) {
        if (c.replaceChildren(), h === null) {
          l.delete(m.zoneId);
          continue;
        }
        l.set(m.zoneId, h), c.appendChild(V(n, m, m.slide, t, o));
      }
    }
    for (const m of [...i.querySelectorAll("[data-zone]")]) {
      const c = m.dataset.zone;
      c && !g.has(c) && (m.remove(), l.delete(c));
    }
    let s = i.querySelector(".couloir-watermark");
    u.watermark ? (s || (s = y(n, "div", "couloir-watermark", u.watermark), i.appendChild(s)), s.textContent = u.watermark) : s?.remove();
  }
  return {
    update(u) {
      p(u) || b(u);
    },
    onMediaEnded(u) {
      o = u;
    },
    destroy() {
      f.disconnect(), i.remove(), r.remove();
    }
  };
}
function y(e, t, n, r) {
  const i = e.createElement(t);
  return i.className = n, r !== void 0 && (i.textContent = r), i;
}
function V(e, t, n, r, i) {
  const o = e.createElement("div");
  switch (o.className = "couloir-slide", o.dataset.slide = n.slideId, n.kind) {
    case "media": {
      o.classList.add("couloir-slide--media");
      const l = r.assetUrl?.(n.asset.id) ?? n.asset.url;
      if (n.asset.mime.startsWith("video/")) {
        const a = e.createElement("video");
        a.className = "couloir-media", a.src = l, a.muted = !0, a.autoplay = !0, a.playsInline = !0, a.addEventListener("ended", () => i(t.zoneId)), a.addEventListener("error", () => i(t.zoneId)), o.appendChild(a);
      } else {
        const a = e.createElement("img");
        a.className = "couloir-media", a.src = l, a.alt = "", o.appendChild(a);
      }
      return o;
    }
    case "template": {
      const l = (p) => {
        const b = n.fields[p];
        return typeof b == "string" ? b : void 0;
      }, a = l("eyebrow"), d = l("titre") ?? l("title"), f = l("texte") ?? l("body");
      return a && o.appendChild(y(e, "p", "couloir-eyebrow", a)), d && o.appendChild(y(e, "h1", "couloir-title", d)), f && o.appendChild(y(e, "p", "couloir-body", f)), o;
    }
    case "widget": {
      if (n.widget === "ticker") {
        o.classList.add("couloir-slide--ticker");
        const l = typeof n.config.text == "string" ? n.config.text : "", a = y(e, "div", "couloir-ticker-viewport");
        a.appendChild(y(e, "span", "couloir-ticker-text", l)), o.appendChild(a);
        const d = y(e, "div", "couloir-clock", ""), f = () => {
          d.textContent = new Intl.DateTimeFormat(r.locale ?? "fr-FR", {
            timeZone: r.timezone ?? "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit"
          }).format(/* @__PURE__ */ new Date());
        };
        f();
        const p = setInterval(f, 1e4);
        return new MutationObserver((b, u) => {
          d.isConnected || (clearInterval(p), u.disconnect());
        }).observe(o.ownerDocument.body, { childList: !0, subtree: !0 }), o.appendChild(d), o;
      }
      return o.appendChild(y(e, "p", "couloir-eyebrow", n.widget)), o;
    }
    case "data":
      return ee(e, o, n), n.staleLabel && o.appendChild(y(e, "p", "couloir-stale", n.staleLabel)), o;
  }
}
function K(e, t) {
  const n = e?.days;
  if (Array.isArray(n))
    return t ? n.find((i) => i.classId === t) ?? null : n[0] ?? null;
  const r = e;
  return r && Array.isArray(r.entries) ? r : null;
}
function Q(e, t, n) {
  const r = n.payload, i = Array.isArray(r) ? r : r?.articles ?? [];
  if (i.length === 0) return;
  const o = Number(n.params.index ?? 0), l = i[(o % i.length + i.length) % i.length];
  if (l?.titre) {
    if (l.image) {
      const a = e.createElement("img");
      a.className = "couloir-illustration", a.src = l.image, a.alt = "", a.addEventListener("error", () => a.remove()), t.appendChild(a);
    }
    l.categorie && t.appendChild(y(e, "p", "couloir-eyebrow", l.categorie)), t.appendChild(y(e, "h1", "couloir-title", l.titre)), l.extrait && t.appendChild(y(e, "p", "couloir-body", l.extrait));
  }
}
function ee(e, t, n) {
  if (n.view.startsWith("timetable")) {
    const r = K(n.payload, n.params.classId);
    if (!r) return;
    if (t.appendChild(y(e, "p", "couloir-eyebrow", r.classLabel)), r.notice) {
      t.appendChild(y(e, "p", "couloir-body", r.notice));
      return;
    }
    const i = e.createElement("ul");
    i.className = "couloir-list";
    for (const o of r.entries) {
      const l = o.change && o.change !== "none", a = e.createElement("li");
      a.className = l ? "couloir-row couloir-row--changed" : "couloir-row", o.change === "cancelled" && a.classList.add("couloir-row--cancelled");
      const d = e.createElement("time");
      d.textContent = o.time;
      const f = e.createElement("span");
      f.textContent = o.subject, o.note && f.appendChild(y(e, "span", "couloir-badge", o.note)), a.append(d, f, y(e, "span", "room", o.room)), i.appendChild(a);
    }
    t.appendChild(i);
    return;
  }
  n.view.startsWith("news") && Q(e, t, n);
}
function re(e, t) {
  const n = J(e, t), r = t.pollMs ?? 2e3, i = t.tickMs ?? 500;
  let o = null, l = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Set(), d = !1;
  n.onMediaEnded((s) => {
    a.add(s), b();
  });
  function f(s) {
    if (typeof document > "u") return;
    const m = s.screenCode ? s.screenCode : s.pairing ? `À rattacher · ${s.pairing.code}` : "Couloir";
    document.title !== m && (document.title = m);
  }
  async function p() {
    if (!d)
      try {
        const s = await fetch(t.stateUrl, { cache: "no-store" });
        if (s.ok) {
          const m = await s.json();
          m.manifest?.version !== o?.manifest?.version && (l = /* @__PURE__ */ new Map()), o = m, f(m);
        }
      } catch {
      }
  }
  function b() {
    if (d) return;
    if (!o?.manifest) {
      n.update(te(o));
      return;
    }
    const s = H({
      manifest: o.manifest,
      nowMs: Date.now(),
      sources: new Map(Object.entries(o.sources)),
      availableAssetIds: new Set(o.availableAssetIds),
      rotations: l,
      forceFallback: o.forceFallback,
      identify: o.identify,
      mediaEndedZoneIds: a,
      ...o.screenCode !== null ? { screenCode: o.screenCode } : {}
    });
    a = /* @__PURE__ */ new Set(), l = s.rotations, n.update(s.screen), s.transitions.length > 0 && t.transitionsUrl && ne(t.transitionsUrl, s.transitions);
  }
  const u = setInterval(() => void p(), r), g = setInterval(b, i);
  return p().then(b), {
    stop() {
      d = !0, clearInterval(u), clearInterval(g), n.destroy();
    }
  };
}
function te(e) {
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
async function ne(e, t) {
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
  T as MAX_SENSIBLE_DURATION_MS,
  q as MIN_BODY_TEXT_HEIGHT_PERCENT,
  L as READING_WORDS_PER_MINUTE,
  Y as RENDERER_CSS,
  O as activePlaylistId,
  Z as advanceRotation,
  G as collapseEmptyZones,
  $ as countWords,
  H as direct,
  U as effectiveDuration,
  D as isDisplayOffPeriod,
  S as isDisplayable,
  N as isScheduleActive,
  E as isWithinDailyWindow,
  C as localMoment,
  R as minReadableDurationMs,
  J as mountRenderer,
  I as parseClock,
  A as resolveSource,
  _ as slideText,
  F as stalenessLabel,
  re as startPlayer,
  j as typeScale
};
