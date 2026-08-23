const F = {
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
  }).formatToParts(new Date(e)), r = (l) => n.find((a) => a.type === l)?.value ?? "", o = Number(r("hour")) % 24, i = Number(r("minute"));
  return {
    dayOfWeek: F[r("weekday")] ?? 1,
    minutesOfDay: o * 60 + i
  };
}
function k(e) {
  const [t, n] = e.split(":");
  return Number(t) * 60 + Number(n);
}
function M(e, t, n) {
  const r = k(t), o = k(n);
  return r === o ? !0 : r < o ? e >= r && e < o : e >= r || e < o;
}
function O(e, t, n) {
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
function P(e) {
  return e.status === "usable" || e.status === "stale-shown";
}
function D(e, t = "fr-FR", n = "Europe/Paris") {
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
  return !(e.daysOfWeek && e.daysOfWeek.length > 0 && !e.daysOfWeek.includes(r.dayOfWeek) || e.dailyStart && e.dailyEnd && !M(r.minutesOfDay, e.dailyStart, e.dailyEnd));
}
function W(e, t, n) {
  const r = e.layout.zones.find((a) => a.id === t);
  if (!r) return null;
  const o = e.settings.timezone, i = e.schedules.filter((a) => a.zoneId === t).filter((a) => N(a, n, o));
  if (i.length === 0) return r.playlistId;
  let l = i[0];
  for (const a of i.slice(1))
    a.priority >= l.priority && (l = a);
  return l.playlistId;
}
function L(e, t, n) {
  if (!e) return !0;
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const r = E(t, n);
  if (e.dailyStart && e.dailyEnd && !M(r.minutesOfDay, e.dailyStart, e.dailyEnd))
    return !1;
  if (e.daysOfWeek && e.daysOfWeek.length > 0) {
    const o = (r.dayOfWeek + 5) % 7 + 1, i = !!(e.dailyStart && e.dailyEnd) && k(e.dailyStart) > k(e.dailyEnd) && r.minutesOfDay < k(e.dailyEnd);
    if (!e.daysOfWeek.includes(i ? o : r.dayOfWeek)) return !1;
  }
  return !0;
}
function T(e, t) {
  const n = E(t, e.timezone), r = (n.dayOfWeek + 5) % 7 + 1;
  return e.displayOff.some((o) => {
    if (!M(n.minutesOfDay, o.from, o.to)) return !1;
    if (o.daysOfWeek.length === 0) return !0;
    const i = k(o.from), l = k(o.to), a = i > l && n.minutesOfDay < l;
    return o.daysOfWeek.includes(a ? r : n.dayOfWeek);
  });
}
const q = 130, $ = 2500, R = 6e4, _ = 1.9;
function U(e) {
  const t = e.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}
function j(e) {
  const t = U(e);
  return Math.round($ + t / q * 6e4);
}
function B(e) {
  return e.kind !== "template" ? "" : Object.values(e.fields).filter((t) => typeof t == "string").join(" ");
}
function Z(e) {
  const t = "durationMs" in e && e.durationMs ? e.durationMs : 0, n = j(B(e)), r = Math.min(Math.max(t, n), R);
  return { effectiveMs: r, requestedMs: t, extended: r > t };
}
function H(e) {
  const t = Math.round(e * _ / 100);
  return {
    eyebrow: Math.round(t * 0.72),
    title: Math.round(t * 2.4),
    body: t,
    caption: Math.round(t * 0.8)
  };
}
function z(e, t, n) {
  for (let r = 1; r <= e.length; r++) {
    const o = (t + r) % e.length, i = e[o];
    if (i !== void 0 && n(i)) return o;
  }
  return null;
}
function X(e, t) {
  for (let n = 0; n < e.length; n++) {
    const r = e[n];
    if (r !== void 0 && t(r)) return n;
  }
  return null;
}
function V(e) {
  const { state: t, playlistId: n, slideIds: r, isEligible: o, durationMsOf: i, nowMs: l } = e, a = t && t.playlistId === n ? r[t.index] ?? null : null, c = (s) => {
    if (s === null)
      return { state: null, currentSlideId: null, changed: a !== null };
    const f = r[s];
    return {
      state: { playlistId: n, index: s, slideStartedAtMs: l },
      currentSlideId: f,
      changed: f !== a
    };
  };
  if (!t || t.playlistId !== n || t.index >= r.length)
    return c(X(r, o));
  const u = r[t.index];
  if (u === void 0 || !o(u))
    return c(z(r, t.index, o));
  const p = i(u), w = l - t.slideStartedAtMs;
  if (!(p === null ? e.mediaEnded === !0 : w >= p))
    return { state: t, currentSlideId: u, changed: !1 };
  const y = z(r, t.index, o);
  return c(y === null ? null : y);
}
function G(e) {
  const { manifest: t, nowMs: n } = e, r = new Map(t.slides.map((m) => [m.id, m])), o = new Map(t.assets.map((m) => [m.id, m])), i = new Map(t.playlists.map((m) => [m.id, m])), l = new Map(
    t.dataSources.map((m) => [
      m.id,
      O(m, e.sources.get(m.id), n)
    ])
  ), a = t.settings.showScreenCodeWatermark ? e.screenCode ?? null : null, c = t.emergency;
  if (c && n < Date.parse(c.validUntil))
    return {
      screen: { mode: "emergency", zones: [], emergency: c, identify: null, watermark: a },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (e.identify)
    return {
      screen: { mode: "identify", zones: [], emergency: null, identify: e.identify, watermark: null },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (T(t.settings, n))
    return {
      screen: { mode: "display-off", zones: [], emergency: null, identify: null, watermark: null },
      rotations: new Map(e.rotations),
      transitions: []
    };
  const u = (m) => {
    const b = r.get(m);
    if (!b || !L(b.visibility, n, t.settings.timezone)) return !1;
    switch (b.kind) {
      case "media":
        return e.availableAssetIds.has(b.assetId);
      case "template":
        return b.assetIds.every((v) => e.availableAssetIds.has(v));
      case "widget":
        return !0;
      case "data": {
        const v = l.get(b.sourceId);
        return v !== void 0 && P(v);
      }
    }
  }, p = (m) => {
    const b = r.get(m);
    return b ? b.kind === "media" && b.durationMs === void 0 ? null : Z(b).effectiveMs : 0;
  }, w = e.forceFallback ? "fallback" : "normal", d = /* @__PURE__ */ new Map(), y = [], s = [];
  for (const m of t.layout.zones) {
    const b = e.forceFallback ? t.fallbackPlaylistId : W(t, m.id, n) ?? m.playlistId, v = i.get(b), x = e.rotations.get(m.id), A = x && x.playlistId === b ? v?.slideIds[x.index] ?? null : null, I = V({
      state: x,
      playlistId: b,
      slideIds: v?.slideIds ?? [],
      isEligible: u,
      durationMsOf: p,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(m.id) ?? !1
    });
    I.state && d.set(m.id, I.state), I.changed && y.push({
      zoneId: m.id,
      fromSlideId: A,
      toSlideId: I.currentSlideId,
      atMs: n
    });
    const S = I.currentSlideId ? r.get(I.currentSlideId) : void 0;
    if (s.push({
      zoneId: m.id,
      rect: m.rect,
      playlistId: b,
      slide: S ? C(S, o, l, t.settings.timezone) : null
    }), e.forceFallback) break;
  }
  if (!e.forceFallback && s.every((m) => m.slide === null)) {
    const b = i.get(t.fallbackPlaylistId)?.slideIds[0], v = b ? r.get(b) : void 0;
    if (v)
      return {
        screen: {
          mode: "normal",
          zones: [
            {
              zoneId: t.layout.zones[0]?.id ?? "principal",
              rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
              playlistId: t.fallbackPlaylistId,
              slide: C(v, o, l, t.settings.timezone)
            }
          ],
          emergency: null,
          identify: null,
          watermark: a
        },
        rotations: d,
        transitions: y
      };
  }
  const h = e.forceFallback ? s.map((m) => ({ ...m, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } })) : Y(s);
  return {
    screen: { mode: w, zones: h, emergency: null, identify: null, watermark: a },
    rotations: d,
    transitions: y
  };
}
function C(e, t, n, r) {
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
      return !o || !P(o) ? null : {
        kind: "data",
        slideId: e.id,
        sourceId: e.sourceId,
        view: e.view,
        payload: "payload" in o ? o.payload : null,
        params: e.params,
        staleLabel: D(o, "fr-FR", r)
      };
    }
  }
}
function Y(e) {
  const t = /* @__PURE__ */ new Map();
  for (const c of e) {
    const u = `${c.rect.yPercent}:${c.rect.heightPercent}`, p = t.get(u);
    p ? p.push(c) : t.set(u, [c]);
  }
  const n = [];
  for (const c of t.values()) {
    const u = c.filter((s) => s.slide !== null);
    if (u.length === 0) continue;
    const p = c.reduce((s, f) => s + f.rect.widthPercent, 0), w = u.reduce((s, f) => s + f.rect.widthPercent, 0), d = w > 0 ? p / w : 1;
    let y = Math.min(...c.map((s) => s.rect.xPercent));
    n.push(
      u.map((s) => {
        const f = s.rect.widthPercent * d, h = { ...s, rect: { ...s.rect, xPercent: y, widthPercent: f } };
        return y += f, h;
      })
    );
  }
  if (n.length === 0) return [];
  const r = [...t.values()].reduce((c, u) => c + (u[0]?.rect.heightPercent ?? 0), 0), o = n.reduce((c, u) => c + (u[0]?.rect.heightPercent ?? 0), 0), i = o > 0 ? r / o : 1, l = [];
  let a = Math.min(...e.map((c) => c.rect.yPercent));
  for (const c of n.sort((u, p) => (u[0]?.rect.yPercent ?? 0) - (p[0]?.rect.yPercent ?? 0))) {
    const u = (c[0]?.rect.heightPercent ?? 0) * i;
    for (const p of c)
      l.push({ ...p, rect: { ...p.rect, yPercent: a, heightPercent: u } });
    a += u;
  }
  return l;
}
const J = `
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
function K(e, t = {}) {
  const n = e.ownerDocument, r = n.createElement("style");
  r.textContent = J, e.appendChild(r);
  const o = n.createElement("div");
  o.className = "couloir-root", e.appendChild(o);
  let i = () => {
  };
  const l = /* @__PURE__ */ new Map();
  let a = "";
  const c = () => {
    const d = o.clientHeight || 1080, y = H(d);
    o.style.setProperty("--fs-eyebrow", `${y.eyebrow}px`), o.style.setProperty("--fs-title", `${y.title}px`), o.style.setProperty("--fs-body", `${y.body}px`), o.style.setProperty("--fs-caption", `${y.caption}px`), o.style.setProperty("--pad", `${Math.round(d * 0.045)}px`);
  }, u = new ResizeObserver(c);
  u.observe(o), c();
  function p(d) {
    const y = `${d.mode}:${d.emergency?.id ?? ""}:${d.identify?.screenCode ?? ""}`;
    if (d.mode === "normal" || d.mode === "fallback") return !1;
    if (y === a) return !0;
    a = y, o.replaceChildren(), l.clear();
    const s = n.createElement("div");
    return d.mode === "emergency" && d.emergency ? (s.className = "couloir-full couloir-full--emergency", s.append(
      g(n, "p", "couloir-eyebrow", "Message important"),
      g(n, "h1", "couloir-title", d.emergency.title)
    ), d.emergency.body && s.append(g(n, "p", "couloir-body", d.emergency.body))) : d.mode === "identify" && d.identify ? (s.className = "couloir-full couloir-full--identify", s.append(
      g(n, "div", "couloir-code", d.identify.screenCode),
      g(n, "p", "couloir-body", d.identify.label),
      g(n, "p", "couloir-body", d.identify.ipAddress)
    )) : s.className = "couloir-full couloir-full--off", o.appendChild(s), !0;
  }
  function w(d) {
    a !== "" && (o.replaceChildren(), l.clear(), a = "");
    const y = /* @__PURE__ */ new Set();
    for (const f of d.zones) {
      y.add(f.zoneId);
      let h = o.querySelector(`[data-zone="${f.zoneId}"]`);
      h || (h = n.createElement("section"), h.className = "couloir-zone", h.dataset.zone = f.zoneId, o.appendChild(h)), h.style.left = `${f.rect.xPercent}%`, h.style.top = `${f.rect.yPercent}%`, h.style.width = `${f.rect.widthPercent}%`, h.style.height = `${f.rect.heightPercent}%`;
      const m = f.slide?.slideId ?? null;
      if (l.get(f.zoneId) !== m) {
        if (h.replaceChildren(), m === null) {
          l.delete(f.zoneId);
          continue;
        }
        l.set(f.zoneId, m), h.appendChild(Q(n, f, f.slide, t, i));
      }
    }
    for (const f of [...o.querySelectorAll("[data-zone]")]) {
      const h = f.dataset.zone;
      h && !y.has(h) && (f.remove(), l.delete(h));
    }
    let s = o.querySelector(".couloir-watermark");
    d.watermark ? (s || (s = g(n, "div", "couloir-watermark", d.watermark), o.appendChild(s)), s.textContent = d.watermark) : s?.remove();
  }
  return {
    update(d) {
      p(d) || w(d);
    },
    onMediaEnded(d) {
      i = d;
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
function Q(e, t, n, r, o) {
  const i = e.createElement("div");
  switch (i.className = "couloir-slide", i.dataset.slide = n.slideId, n.kind) {
    case "media": {
      i.classList.add("couloir-slide--media");
      const l = r.assetUrl?.(n.asset.id) ?? n.asset.url;
      if (n.asset.mime.startsWith("video/")) {
        const a = e.createElement("video");
        a.className = "couloir-media", a.src = l, a.muted = !0, a.autoplay = !0, a.playsInline = !0, a.addEventListener("ended", () => o(t.zoneId)), a.addEventListener("error", () => o(t.zoneId)), i.appendChild(a);
      } else {
        const a = e.createElement("img");
        a.className = "couloir-media", a.src = l, a.alt = "", i.appendChild(a);
      }
      return i;
    }
    case "template": {
      const l = (p) => {
        const w = n.fields[p];
        return typeof w == "string" ? w : void 0;
      }, a = l("eyebrow"), c = l("titre") ?? l("title"), u = l("texte") ?? l("body");
      return a && i.appendChild(g(e, "p", "couloir-eyebrow", a)), c && i.appendChild(g(e, "h1", "couloir-title", c)), u && i.appendChild(g(e, "p", "couloir-body", u)), i;
    }
    case "widget": {
      if (n.widget === "ticker") {
        i.classList.add("couloir-slide--ticker");
        const l = typeof n.config.text == "string" ? n.config.text : "", a = g(e, "div", "couloir-ticker-viewport");
        a.appendChild(g(e, "span", "couloir-ticker-text", l)), i.appendChild(a);
        const c = g(e, "div", "couloir-clock", ""), u = () => {
          c.textContent = new Intl.DateTimeFormat(r.locale ?? "fr-FR", {
            timeZone: r.timezone ?? "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit"
          }).format(/* @__PURE__ */ new Date());
        };
        u();
        const p = setInterval(u, 1e4);
        return new MutationObserver((w, d) => {
          c.isConnected || (clearInterval(p), d.disconnect());
        }).observe(i.ownerDocument.body, { childList: !0, subtree: !0 }), i.appendChild(c), i;
      }
      return i.appendChild(g(e, "p", "couloir-eyebrow", n.widget)), i;
    }
    case "data":
      return ne(e, i, n), n.staleLabel && i.appendChild(g(e, "p", "couloir-stale", n.staleLabel)), i;
  }
}
function ee(e, t) {
  const n = e?.days;
  if (Array.isArray(n))
    return t ? n.find((o) => o.classId === t) ?? null : n[0] ?? null;
  const r = e;
  return r && Array.isArray(r.entries) ? r : null;
}
function te(e, t, n) {
  const r = n.payload, o = Array.isArray(r) ? r : r?.articles ?? [];
  if (o.length === 0) return;
  const i = Number(n.params.index ?? 0), l = o[(i % o.length + o.length) % o.length];
  if (l?.titre) {
    if (l.image) {
      const a = e.createElement("img");
      a.className = "couloir-illustration", a.src = l.image, a.alt = "", a.addEventListener("error", () => a.remove()), t.appendChild(a);
    }
    l.categorie && t.appendChild(g(e, "p", "couloir-eyebrow", l.categorie)), t.appendChild(g(e, "h1", "couloir-title", l.titre)), l.extrait && t.appendChild(g(e, "p", "couloir-body", l.extrait));
  }
}
function ne(e, t, n) {
  if (n.view.startsWith("timetable")) {
    const r = ee(n.payload, n.params.classId);
    if (!r) return;
    if (t.appendChild(g(e, "p", "couloir-eyebrow", r.classLabel)), r.notice) {
      t.appendChild(g(e, "p", "couloir-body", r.notice));
      return;
    }
    const o = e.createElement("ul");
    o.className = "couloir-list";
    for (const i of r.entries) {
      const l = i.change && i.change !== "none", a = e.createElement("li");
      a.className = l ? "couloir-row couloir-row--changed" : "couloir-row", i.change === "cancelled" && a.classList.add("couloir-row--cancelled");
      const c = e.createElement("time");
      c.textContent = i.time;
      const u = e.createElement("span");
      u.textContent = i.subject, i.note && u.appendChild(g(e, "span", "couloir-badge", i.note)), a.append(c, u, g(e, "span", "room", i.room)), o.appendChild(a);
    }
    t.appendChild(o);
    return;
  }
  n.view.startsWith("news") && te(e, t, n);
}
function ie(e, t) {
  const n = K(e, t), r = t.pollMs ?? 2e3, o = t.tickMs ?? 500;
  let i = null, l = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Set(), c = !1;
  n.onMediaEnded((s) => {
    a.add(s), w();
  });
  function u(s) {
    if (typeof document > "u") return;
    const f = s.screenCode ? s.screenCode : s.pairing ? `À rattacher · ${s.pairing.code}` : "Couloir";
    document.title !== f && (document.title = f);
  }
  async function p() {
    if (!c)
      try {
        const s = await fetch(t.stateUrl, { cache: "no-store" });
        if (s.ok) {
          const f = await s.json();
          f.manifest?.version !== i?.manifest?.version && (l = /* @__PURE__ */ new Map()), i = f, u(f);
        }
      } catch {
      }
  }
  function w() {
    if (c) return;
    if (!i?.manifest) {
      n.update(re(i));
      return;
    }
    const s = G({
      manifest: i.manifest,
      nowMs: Date.now(),
      sources: new Map(Object.entries(i.sources)),
      availableAssetIds: new Set(i.availableAssetIds),
      rotations: l,
      forceFallback: i.forceFallback,
      identify: i.identify,
      mediaEndedZoneIds: a,
      ...i.screenCode !== null ? { screenCode: i.screenCode } : {}
    });
    a = /* @__PURE__ */ new Set(), l = s.rotations, n.update(s.screen), s.transitions.length > 0 && t.transitionsUrl && oe(t.transitionsUrl, s.transitions);
  }
  const d = setInterval(() => void p(), r), y = setInterval(w, o);
  return p().then(w), {
    stop() {
      c = !0, clearInterval(d), clearInterval(y), n.destroy();
    }
  };
}
function re(e) {
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
async function oe(e, t) {
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
  $ as GLANCE_TIME_MS,
  R as MAX_SENSIBLE_DURATION_MS,
  _ as MIN_BODY_TEXT_HEIGHT_PERCENT,
  q as READING_WORDS_PER_MINUTE,
  J as RENDERER_CSS,
  W as activePlaylistId,
  V as advanceRotation,
  Y as collapseEmptyZones,
  U as countWords,
  G as direct,
  Z as effectiveDuration,
  T as isDisplayOffPeriod,
  P as isDisplayable,
  N as isScheduleActive,
  L as isVisible,
  M as isWithinDailyWindow,
  E as localMoment,
  j as minReadableDurationMs,
  K as mountRenderer,
  k as parseClock,
  O as resolveSource,
  B as slideText,
  D as stalenessLabel,
  ie as startPlayer,
  H as typeScale
};
