const N = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};
function F(e, t) {
  const n = new Intl.DateTimeFormat("en-CA", {
    timeZone: t,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(e)), r = (i) => n.find((o) => o.type === i)?.value ?? "";
  return `${r("year")}-${r("month")}-${r("day")}`;
}
function C(e, t) {
  const n = new Intl.DateTimeFormat("en-US", {
    timeZone: t,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: !1
  }).formatToParts(new Date(e)), r = (l) => n.find((a) => a.type === l)?.value ?? "", i = Number(r("hour")) % 24, o = Number(r("minute"));
  return {
    dayOfWeek: N[r("weekday")] ?? 1,
    minutesOfDay: i * 60 + o
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
function D(e, t, n) {
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
function A(e) {
  return e.status === "usable" || e.status === "stale-shown";
}
function $(e, t = "fr-FR", n = "Europe/Paris") {
  return e.status !== "stale-shown" ? null : `Mis à jour ${new Intl.DateTimeFormat(t, {
    timeZone: n,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(e.fetchedAtMs))}`;
}
function T(e, t, n) {
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const r = C(t, n);
  return !(e.daysOfWeek && e.daysOfWeek.length > 0 && !e.daysOfWeek.includes(r.dayOfWeek) || e.dailyStart && e.dailyEnd && !E(r.minutesOfDay, e.dailyStart, e.dailyEnd));
}
function W(e, t, n) {
  const r = e.layout.zones.find((a) => a.id === t);
  if (!r) return null;
  const i = e.settings.timezone, o = e.schedules.filter((a) => a.zoneId === t).filter((a) => T(a, n, i));
  if (o.length === 0) return r.playlistId;
  let l = o[0];
  for (const a of o.slice(1))
    a.priority >= l.priority && (l = a);
  return l.playlistId;
}
function L(e, t, n) {
  if (!e) return !0;
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const r = C(t, n);
  if (e.dailyStart && e.dailyEnd && !E(r.minutesOfDay, e.dailyStart, e.dailyEnd))
    return !1;
  if (e.daysOfWeek && e.daysOfWeek.length > 0) {
    const i = (r.dayOfWeek + 5) % 7 + 1, o = !!(e.dailyStart && e.dailyEnd) && x(e.dailyStart) > x(e.dailyEnd) && r.minutesOfDay < x(e.dailyEnd);
    if (!e.daysOfWeek.includes(o ? i : r.dayOfWeek)) return !1;
  }
  return !0;
}
function q(e, t) {
  const n = C(t, e.timezone), r = (n.dayOfWeek + 5) % 7 + 1;
  return e.displayOff.some((i) => {
    if (!E(n.minutesOfDay, i.from, i.to)) return !1;
    if (i.daysOfWeek.length === 0) return !0;
    const o = x(i.from), l = x(i.to), a = o > l && n.minutesOfDay < l;
    return i.daysOfWeek.includes(a ? r : n.dayOfWeek);
  });
}
const R = 130, _ = 2500, j = 6e4, U = 1.9;
function B(e) {
  const t = e.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}
function Z(e) {
  const t = B(e);
  return Math.round(_ + t / R * 6e4);
}
function H(e) {
  return e.kind !== "template" ? "" : Object.values(e.fields).filter((t) => typeof t == "string").join(" ");
}
function J(e) {
  const t = "durationMs" in e && e.durationMs ? e.durationMs : 0, n = Z(H(e)), r = Math.min(Math.max(t, n), j);
  return { effectiveMs: r, requestedMs: t, extended: r > t };
}
function X(e) {
  const t = Math.round(e * U / 100);
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
function V(e, t) {
  for (let n = 0; n < e.length; n++) {
    const r = e[n];
    if (r !== void 0 && t(r)) return n;
  }
  return null;
}
function G(e) {
  const { state: t, playlistId: n, slideIds: r, isEligible: i, durationMsOf: o, nowMs: l } = e, a = t && t.playlistId === n ? r[t.index] ?? null : null, s = (c) => {
    if (c === null)
      return { state: null, currentSlideId: null, changed: a !== null };
    const f = r[c];
    return {
      state: { playlistId: n, index: c, slideStartedAtMs: l },
      currentSlideId: f,
      changed: f !== a
    };
  };
  if (!t || t.playlistId !== n || t.index >= r.length)
    return s(V(r, i));
  const u = r[t.index];
  if (u === void 0 || !i(u))
    return s(M(r, t.index, i));
  const p = o(u), b = l - t.slideStartedAtMs;
  if (!(p === null ? e.mediaEnded === !0 : b >= p))
    return { state: t, currentSlideId: u, changed: !1 };
  const d = M(r, t.index, i);
  return s(d === null ? null : d);
}
function Y(e) {
  const { manifest: t, nowMs: n } = e, r = new Map(t.slides.map((m) => [m.id, m])), i = new Map(t.assets.map((m) => [m.id, m])), o = new Map(t.playlists.map((m) => [m.id, m])), l = new Map(
    t.dataSources.map((m) => [
      m.id,
      D(m, e.sources.get(m.id), n)
    ])
  ), a = t.settings.showScreenCodeWatermark ? e.screenCode ?? null : null, s = t.settings.branding?.accent ?? null, u = t.emergency;
  if (u && n < Date.parse(u.validUntil))
    return {
      screen: { mode: "emergency", zones: [], emergency: u, identify: null, watermark: a, accent: s },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (e.identify)
    return {
      screen: { mode: "identify", zones: [], emergency: null, identify: e.identify, watermark: null, accent: s },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (q(t.settings, n))
    return {
      screen: { mode: "display-off", zones: [], emergency: null, identify: null, watermark: null, accent: s },
      rotations: new Map(e.rotations),
      transitions: []
    };
  const p = (m) => {
    const g = r.get(m);
    if (!g || !L(g.visibility, n, t.settings.timezone)) return !1;
    switch (g.kind) {
      case "media":
        return e.availableAssetIds.has(g.assetId);
      case "template":
        return g.assetIds.every((v) => e.availableAssetIds.has(v));
      case "widget":
        return !0;
      case "data": {
        const v = l.get(g.sourceId);
        if (v === void 0 || !A(v)) return !1;
        if (g.view.startsWith("timetable") && "payload" in v) {
          const I = K(v.payload, g.params.classId);
          if (I?.date && I.date !== F(n, t.settings.timezone)) return !1;
        }
        return !0;
      }
    }
  }, b = (m) => {
    const g = r.get(m);
    return g ? g.kind === "media" && g.durationMs === void 0 ? null : J(g).effectiveMs : 0;
  }, k = e.forceFallback ? "fallback" : "normal", d = /* @__PURE__ */ new Map(), c = [], f = [];
  for (const m of t.layout.zones) {
    const g = e.forceFallback ? t.fallbackPlaylistId : W(t, m.id, n) ?? m.playlistId, v = o.get(g), I = e.rotations.get(m.id), O = I && I.playlistId === g ? v?.slideIds[I.index] ?? null : null, S = G({
      state: I,
      playlistId: g,
      slideIds: v?.slideIds ?? [],
      isEligible: p,
      durationMsOf: b,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(m.id) ?? !1
    });
    S.state && d.set(m.id, S.state), S.changed && c.push({
      zoneId: m.id,
      fromSlideId: O,
      toSlideId: S.currentSlideId,
      atMs: n
    });
    const z = S.currentSlideId ? r.get(S.currentSlideId) : void 0;
    if (f.push({
      zoneId: m.id,
      rect: m.rect,
      playlistId: g,
      slide: z ? P(z, i, l, t.settings.timezone) : null
    }), e.forceFallback) break;
  }
  if (!e.forceFallback && f.every((m) => m.slide === null)) {
    const g = o.get(t.fallbackPlaylistId)?.slideIds[0], v = g ? r.get(g) : void 0;
    if (v)
      return {
        screen: {
          mode: "normal",
          zones: [
            {
              zoneId: t.layout.zones[0]?.id ?? "principal",
              rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
              playlistId: t.fallbackPlaylistId,
              slide: P(v, i, l, t.settings.timezone)
            }
          ],
          emergency: null,
          identify: null,
          watermark: a,
          accent: s
        },
        rotations: d,
        transitions: c
      };
  }
  const w = e.forceFallback ? f.map((m) => ({ ...m, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } })) : Q(f);
  return {
    screen: { mode: k, zones: w, emergency: null, identify: null, watermark: a, accent: s },
    rotations: d,
    transitions: c
  };
}
function P(e, t, n, r) {
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
      return !i || !A(i) ? null : {
        kind: "data",
        slideId: e.id,
        sourceId: e.sourceId,
        view: e.view,
        payload: "payload" in i ? i.payload : null,
        params: e.params,
        staleLabel: $(i, "fr-FR", r)
      };
    }
  }
}
function K(e, t) {
  const n = e?.days;
  return Array.isArray(n) ? t ? n.find((r) => r.classId === t) ?? null : n[0] ?? null : e ?? null;
}
function Q(e) {
  const t = /* @__PURE__ */ new Map();
  for (const s of e) {
    const u = `${s.rect.yPercent}:${s.rect.heightPercent}`, p = t.get(u);
    p ? p.push(s) : t.set(u, [s]);
  }
  const n = [];
  for (const s of t.values()) {
    const u = s.filter((c) => c.slide !== null);
    if (u.length === 0) continue;
    const p = s.reduce((c, f) => c + f.rect.widthPercent, 0), b = u.reduce((c, f) => c + f.rect.widthPercent, 0), k = b > 0 ? p / b : 1;
    let d = Math.min(...s.map((c) => c.rect.xPercent));
    n.push(
      u.map((c) => {
        const f = c.rect.widthPercent * k, h = { ...c, rect: { ...c.rect, xPercent: d, widthPercent: f } };
        return d += f, h;
      })
    );
  }
  if (n.length === 0) return [];
  const r = [...t.values()].reduce((s, u) => s + (u[0]?.rect.heightPercent ?? 0), 0), i = n.reduce((s, u) => s + (u[0]?.rect.heightPercent ?? 0), 0), o = i > 0 ? r / i : 1, l = [];
  let a = Math.min(...e.map((s) => s.rect.yPercent));
  for (const s of n.sort((u, p) => (u[0]?.rect.yPercent ?? 0) - (p[0]?.rect.yPercent ?? 0))) {
    const u = (s[0]?.rect.heightPercent ?? 0) * o;
    for (const p of s)
      l.push({ ...p, rect: { ...p.rect, yPercent: a, heightPercent: u } });
    a += u;
  }
  return l;
}
const ee = `
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
  /* start et non baseline : chaque colonne porte maintenant deux lignes, et
     un alignement sur la première ligne de texte décalerait les blocs.
     (Pas d'accent grave dans ce fichier : il est écrit dans un littéral de
     gabarit, et un seul y terminerait la chaîne.) */
  align-items: start;
  font-size: var(--fs-body);
  padding-bottom: .45em;
  border-bottom: 1px solid var(--rule);
}
.couloir-row time { font-variant-numeric: tabular-nums; color: var(--accent); font-weight: 600 }
.couloir-row .room {
  color: var(--ink-soft); font-size: .85em;
  display: flex; flex-direction: column; align-items: flex-end; gap: .05em;
  text-align: right;
}
/* L'enseignant sous la salle, et l'heure de fin sous l'heure de début : deux
   informations utiles qu'on ne cherche qu'après avoir trouvé la première. */
.couloir-prof { color: var(--ink-faint); font-size: .82em; font-weight: 400 }
.couloir-fin { display: block; color: var(--ink-faint); font-size: .8em; font-weight: 400 }
/* Le module passe sous l'intitulé, en plus discret : on lit d'abord à qui la
   séance s'adresse, puis ce qui s'y passe. */
.couloir-detail {
  display: block; color: var(--ink-soft); font-size: .78em;
  font-weight: 400; line-height: 1.25; margin-top: .1em;
}
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
function te(e, t = {}) {
  const n = e.ownerDocument, r = n.createElement("style");
  r.textContent = ee, e.appendChild(r);
  const i = n.createElement("div");
  i.className = "couloir-root", e.appendChild(i);
  let o = () => {
  };
  const l = /* @__PURE__ */ new Map();
  let a = "";
  const s = () => {
    const d = i.clientHeight || 1080, c = X(d);
    i.style.setProperty("--fs-eyebrow", `${c.eyebrow}px`), i.style.setProperty("--fs-title", `${c.title}px`), i.style.setProperty("--fs-body", `${c.body}px`), i.style.setProperty("--fs-caption", `${c.caption}px`), i.style.setProperty("--pad", `${Math.round(d * 0.045)}px`);
  }, u = new ResizeObserver(s);
  u.observe(i), s();
  function p(d) {
    const c = `${d.mode}:${d.emergency?.id ?? ""}:${d.identify?.screenCode ?? ""}`;
    if (d.mode === "normal" || d.mode === "fallback") return !1;
    if (c === a) return !0;
    a = c, i.replaceChildren(), l.clear();
    const f = n.createElement("div");
    return d.mode === "emergency" && d.emergency ? (f.className = "couloir-full couloir-full--emergency", f.append(
      y(n, "p", "couloir-eyebrow", "Message important"),
      y(n, "h1", "couloir-title", d.emergency.title)
    ), d.emergency.body && f.append(y(n, "p", "couloir-body", d.emergency.body))) : d.mode === "identify" && d.identify ? (f.className = "couloir-full couloir-full--identify", f.append(
      y(n, "div", "couloir-code", d.identify.screenCode),
      y(n, "p", "couloir-body", d.identify.label),
      y(n, "p", "couloir-body", d.identify.ipAddress)
    )) : f.className = "couloir-full couloir-full--off", i.appendChild(f), !0;
  }
  function b(d) {
    a !== "" && (i.replaceChildren(), l.clear(), a = "");
    const c = /* @__PURE__ */ new Set();
    for (const h of d.zones) {
      c.add(h.zoneId);
      let w = i.querySelector(`[data-zone="${h.zoneId}"]`);
      w || (w = n.createElement("section"), w.className = "couloir-zone", w.dataset.zone = h.zoneId, i.appendChild(w)), w.style.left = `${h.rect.xPercent}%`, w.style.top = `${h.rect.yPercent}%`, w.style.width = `${h.rect.widthPercent}%`, w.style.height = `${h.rect.heightPercent}%`;
      const m = h.slide ? ne(h.slide) : null;
      if (l.get(h.zoneId) !== m) {
        if (w.replaceChildren(), m === null) {
          l.delete(h.zoneId);
          continue;
        }
        l.set(h.zoneId, m), w.appendChild(re(n, h, h.slide, t, o));
      }
    }
    for (const h of [...i.querySelectorAll("[data-zone]")]) {
      const w = h.dataset.zone;
      w && !c.has(w) && (h.remove(), l.delete(w));
    }
    let f = i.querySelector(".couloir-watermark");
    d.watermark ? (f || (f = y(n, "div", "couloir-watermark", d.watermark), i.appendChild(f)), f.textContent = d.watermark) : f?.remove();
  }
  let k = null;
  return {
    update(d) {
      d.accent !== k && (k = d.accent, d.accent ? i.style.setProperty("--accent", d.accent) : i.style.removeProperty("--accent")), !p(d) && b(d);
    },
    onMediaEnded(d) {
      o = d;
    },
    destroy() {
      u.disconnect(), i.remove(), r.remove();
    }
  };
}
function ne(e) {
  const t = () => {
    switch (e.kind) {
      case "media":
        return `media:${e.asset.id}`;
      case "template":
        return `template:${e.templateId}:${JSON.stringify(e.fields)}`;
      case "widget":
        return `widget:${e.widget}:${JSON.stringify(e.config)}`;
      case "data":
        return `data:${e.sourceId}:${e.view}:${JSON.stringify(e.params)}:${e.staleLabel ?? ""}:${JSON.stringify(e.payload)}`;
    }
  };
  return `${e.slideId}|${t()}`;
}
function y(e, t, n, r) {
  const i = e.createElement(t);
  return i.className = n, r !== void 0 && (i.textContent = r), i;
}
function re(e, t, n, r, i) {
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
      }, a = l("eyebrow"), s = l("titre") ?? l("title"), u = l("texte") ?? l("body");
      return a && o.appendChild(y(e, "p", "couloir-eyebrow", a)), s && o.appendChild(y(e, "h1", "couloir-title", s)), u && o.appendChild(y(e, "p", "couloir-body", u)), o;
    }
    case "widget": {
      if (n.widget === "ticker") {
        o.classList.add("couloir-slide--ticker");
        const l = typeof n.config.text == "string" ? n.config.text : "", a = y(e, "div", "couloir-ticker-viewport");
        a.appendChild(y(e, "span", "couloir-ticker-text", l)), o.appendChild(a);
        const s = y(e, "div", "couloir-clock", ""), u = () => {
          s.textContent = new Intl.DateTimeFormat(r.locale ?? "fr-FR", {
            timeZone: r.timezone ?? "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit"
          }).format(/* @__PURE__ */ new Date());
        };
        u();
        const p = setInterval(u, 1e4);
        return new MutationObserver((b, k) => {
          s.isConnected || (clearInterval(p), k.disconnect());
        }).observe(o.ownerDocument.body, { childList: !0, subtree: !0 }), o.appendChild(s), o;
      }
      return o.appendChild(y(e, "p", "couloir-eyebrow", n.widget)), o;
    }
    case "data":
      return ae(e, o, n), n.staleLabel && o.appendChild(y(e, "p", "couloir-stale", n.staleLabel)), o;
  }
}
function ie(e, t) {
  const n = e?.days;
  if (Array.isArray(n))
    return t ? n.find((i) => i.classId === t) ?? null : n[0] ?? null;
  const r = e;
  return r && Array.isArray(r.entries) ? r : null;
}
function oe(e, t, n) {
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
function ae(e, t, n) {
  if (n.view.startsWith("timetable")) {
    const r = ie(n.payload, n.params.classId);
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
      const s = e.createElement("time");
      s.appendChild(e.createTextNode(o.time)), o.endTime && o.endTime !== o.time && s.appendChild(y(e, "span", "couloir-fin", o.endTime));
      const u = e.createElement("span");
      u.appendChild(e.createTextNode(o.subject)), o.note && u.appendChild(y(e, "span", "couloir-badge", o.note)), o.detail && u.appendChild(y(e, "span", "couloir-detail", o.detail));
      const p = e.createElement("span");
      p.className = "room", p.appendChild(e.createTextNode(o.room)), o.teacher && p.appendChild(y(e, "span", "couloir-prof", o.teacher)), a.append(s, u, p), i.appendChild(a);
    }
    t.appendChild(i);
    return;
  }
  n.view.startsWith("news") && oe(e, t, n);
}
function ce(e, t) {
  const n = te(e, t), r = t.pollMs ?? 2e3, i = t.tickMs ?? 500;
  let o = null, l = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Set(), s = !1;
  n.onMediaEnded((c) => {
    a.add(c), b();
  });
  function u(c) {
    if (typeof document > "u") return;
    const f = c.screenCode ? c.screenCode : c.pairing ? `À rattacher · ${c.pairing.code}` : "Couloir";
    document.title !== f && (document.title = f);
  }
  async function p() {
    if (!s)
      try {
        const c = await fetch(t.stateUrl, { cache: "no-store" });
        if (c.ok) {
          const f = await c.json();
          f.manifest?.version !== o?.manifest?.version && (l = /* @__PURE__ */ new Map()), o = f, u(f);
        }
      } catch {
      }
  }
  function b() {
    if (s) return;
    if (!o?.manifest) {
      n.update(le(o));
      return;
    }
    const c = Y({
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
    a = /* @__PURE__ */ new Set(), l = c.rotations, n.update(c.screen), c.transitions.length > 0 && t.transitionsUrl && se(t.transitionsUrl, c.transitions);
  }
  const k = setInterval(() => void p(), r), d = setInterval(b, i);
  return p().then(b), {
    stop() {
      s = !0, clearInterval(k), clearInterval(d), n.destroy();
    }
  };
}
function le(e) {
  return e?.pairing ? {
    mode: "identify",
    zones: [],
    emergency: null,
    identify: {
      screenCode: e.pairing.code,
      label: "Saisissez ce code dans la console pour rattacher cet écran",
      ipAddress: ""
    },
    accent: null,
    watermark: null
  } : {
    mode: "normal",
    // L'écran d'attente précède tout manifeste : aucune identité connue.
    accent: null,
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
async function se(e, t) {
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
  _ as GLANCE_TIME_MS,
  j as MAX_SENSIBLE_DURATION_MS,
  U as MIN_BODY_TEXT_HEIGHT_PERCENT,
  R as READING_WORDS_PER_MINUTE,
  ee as RENDERER_CSS,
  W as activePlaylistId,
  G as advanceRotation,
  Q as collapseEmptyZones,
  B as countWords,
  F as dateLocale,
  Y as direct,
  J as effectiveDuration,
  q as isDisplayOffPeriod,
  A as isDisplayable,
  T as isScheduleActive,
  L as isVisible,
  E as isWithinDailyWindow,
  C as localMoment,
  Z as minReadableDurationMs,
  te as mountRenderer,
  x as parseClock,
  D as resolveSource,
  H as slideText,
  $ as stalenessLabel,
  ce as startPlayer,
  X as typeScale
};
