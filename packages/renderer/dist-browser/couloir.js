const D = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};
function L(e, t) {
  const n = new Intl.DateTimeFormat("en-CA", {
    timeZone: t,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(e)), i = (r) => n.find((o) => o.type === r)?.value ?? "";
  return `${i("year")}-${i("month")}-${i("day")}`;
}
function C(e, t) {
  const n = new Intl.DateTimeFormat("en-US", {
    timeZone: t,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: !1
  }).formatToParts(new Date(e)), i = (s) => n.find((a) => a.type === s)?.value ?? "", r = Number(i("hour")) % 24, o = Number(i("minute"));
  return {
    dayOfWeek: D[i("weekday")] ?? 1,
    minutesOfDay: r * 60 + o
  };
}
function x(e) {
  const [t, n] = e.split(":");
  return Number(t) * 60 + Number(n);
}
function M(e, t, n) {
  const i = x(t), r = x(n);
  return i === r ? !0 : i < r ? e >= i && e < r : e >= i || e < r;
}
function T(e, t, n) {
  if (!t) return { status: "never-loaded" };
  const i = Math.max(0, (n - t.fetchedAtMs) / 1e3);
  if (i <= e.maxStaleSec)
    return {
      status: "usable",
      payload: t.payload,
      ageSec: i,
      needsRefresh: i > e.ttlSec
    };
  switch (e.stalePolicy) {
    case "keep-with-date":
      return { status: "stale-shown", payload: t.payload, ageSec: i, fetchedAtMs: t.fetchedAtMs };
    case "hide":
      return { status: "hidden", ageSec: i };
    case "fallback":
      return { status: "fallback", ageSec: i };
  }
}
function O(e) {
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
function q(e, t, n) {
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const i = C(t, n);
  return !(e.daysOfWeek && e.daysOfWeek.length > 0 && !e.daysOfWeek.includes(i.dayOfWeek) || e.dailyStart && e.dailyEnd && !M(i.minutesOfDay, e.dailyStart, e.dailyEnd));
}
function R(e, t, n) {
  const i = e.layout.zones.find((a) => a.id === t);
  if (!i) return null;
  const r = e.settings.timezone, o = e.schedules.filter((a) => a.zoneId === t).filter((a) => q(a, n, r));
  if (o.length === 0) return i.playlistId;
  let s = o[0];
  for (const a of o.slice(1))
    a.priority >= s.priority && (s = a);
  return s.playlistId;
}
function W(e, t, n) {
  if (!e) return !0;
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const i = C(t, n);
  if (e.dailyStart && e.dailyEnd && !M(i.minutesOfDay, e.dailyStart, e.dailyEnd))
    return !1;
  if (e.daysOfWeek && e.daysOfWeek.length > 0) {
    const r = (i.dayOfWeek + 5) % 7 + 1, o = !!(e.dailyStart && e.dailyEnd) && x(e.dailyStart) > x(e.dailyEnd) && i.minutesOfDay < x(e.dailyEnd);
    if (!e.daysOfWeek.includes(o ? r : i.dayOfWeek)) return !1;
  }
  return !0;
}
function _(e, t) {
  const n = C(t, e.timezone), i = (n.dayOfWeek + 5) % 7 + 1;
  return e.displayOff.some((r) => {
    if (!M(n.minutesOfDay, r.from, r.to)) return !1;
    if (r.daysOfWeek.length === 0) return !0;
    const o = x(r.from), s = x(r.to), a = o > s && n.minutesOfDay < s;
    return r.daysOfWeek.includes(a ? i : n.dayOfWeek);
  });
}
const j = 130, U = 2500, B = 6e4, H = 1.9;
function Z(e) {
  const t = e.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}
function J(e) {
  const t = Z(e);
  return Math.round(U + t / j * 6e4);
}
function X(e) {
  return e.kind !== "template" ? "" : Object.values(e.fields).filter((t) => typeof t == "string").join(" ");
}
function V(e) {
  const t = "durationMs" in e && e.durationMs ? e.durationMs : 0, n = J(X(e)), i = Math.min(Math.max(t, n), B);
  return { effectiveMs: i, requestedMs: t, extended: i > t };
}
function Y(e) {
  const t = Math.round(e * H / 100);
  return {
    eyebrow: Math.round(t * 0.72),
    title: Math.round(t * 2.4),
    body: t,
    caption: Math.round(t * 0.8)
  };
}
function z(e, t, n) {
  for (let i = 1; i <= e.length; i++) {
    const r = (t + i) % e.length, o = e[r];
    if (o !== void 0 && n(o)) return r;
  }
  return null;
}
function G(e, t) {
  for (let n = 0; n < e.length; n++) {
    const i = e[n];
    if (i !== void 0 && t(i)) return n;
  }
  return null;
}
function A(e) {
  const { state: t, playlistId: n, slideIds: i, isEligible: r, durationMsOf: o, nowMs: s } = e, a = t && t.playlistId === n ? i[t.index] ?? null : null, l = (d) => {
    if (d === null)
      return { state: null, currentSlideId: null, changed: a !== null };
    const m = i[d];
    return {
      state: { playlistId: n, index: d, slideStartedAtMs: s },
      currentSlideId: m,
      changed: m !== a
    };
  };
  if (!t || t.playlistId !== n || t.index >= i.length)
    return l(G(i, r));
  const u = i[t.index];
  if (u === void 0 || !r(u))
    return l(z(i, t.index, r));
  const p = o(u), h = s - t.slideStartedAtMs;
  if (!(p === null ? e.mediaEnded === !0 : h >= p))
    return { state: t, currentSlideId: u, changed: !1 };
  const c = z(i, t.index, r);
  return l(c === null ? null : c);
}
function K(e) {
  const { manifest: t, nowMs: n } = e, i = new Map(t.slides.map((f) => [f.id, f])), r = new Map(t.assets.map((f) => [f.id, f])), o = new Map(t.playlists.map((f) => [f.id, f])), s = new Map(
    t.dataSources.map((f) => [
      f.id,
      T(f, e.sources.get(f.id), n)
    ])
  ), a = t.settings.showScreenCodeWatermark ? e.screenCode ?? null : null, l = t.settings.branding?.accent ?? null, u = t.emergency;
  if (u && n < Date.parse(u.validUntil))
    return {
      screen: { mode: "emergency", zones: [], emergency: u, identify: null, watermark: a, accent: l },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (e.identify)
    return {
      screen: { mode: "identify", zones: [], emergency: null, identify: e.identify, watermark: null, accent: l },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (_(t.settings, n))
    return {
      screen: { mode: "display-off", zones: [], emergency: null, identify: null, watermark: null, accent: l },
      rotations: new Map(e.rotations),
      transitions: []
    };
  const p = (f) => {
    const v = i.get(f);
    if (!v || !W(v.visibility, n, t.settings.timezone)) return !1;
    switch (v.kind) {
      case "media":
        return e.availableAssetIds.has(v.assetId);
      case "template":
        return v.assetIds.every((k) => e.availableAssetIds.has(k));
      case "widget":
        return !0;
      case "data": {
        const k = s.get(v.sourceId);
        if (k === void 0 || !O(k)) return !1;
        if (v.view.startsWith("timetable") && "payload" in k) {
          const I = Q(k.payload, v.params.classId);
          if (I?.date && I.date !== L(n, t.settings.timezone)) return !1;
        }
        return !0;
      }
    }
  }, h = (f) => {
    const v = i.get(f);
    return v ? v.kind === "media" && v.durationMs === void 0 ? null : V(v).effectiveMs : 0;
  }, b = e.forceFallback ? "fallback" : "normal", c = /* @__PURE__ */ new Map(), d = [], m = [];
  for (const f of t.layout.zones) {
    const v = e.forceFallback ? t.fallbackPlaylistId : R(t, f.id, n) ?? f.playlistId, k = o.get(v), I = e.rotations.get(f.id), E = I && I.playlistId === v ? k?.slideIds[I.index] ?? null : null, S = A({
      state: I,
      playlistId: v,
      slideIds: k?.slideIds ?? [],
      isEligible: p,
      durationMsOf: h,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(f.id) ?? !1
    });
    S.state && c.set(f.id, S.state), S.changed && d.push({
      zoneId: f.id,
      fromSlideId: E,
      toSlideId: S.currentSlideId,
      atMs: n
    });
    const P = S.currentSlideId ? i.get(S.currentSlideId) : void 0;
    if (m.push({
      zoneId: f.id,
      rect: f.rect,
      playlistId: v,
      slide: P ? F(P, r, s, t.settings.timezone) : null
    }), e.forceFallback) break;
  }
  if (!e.forceFallback && m.every((f) => f.slide === null)) {
    const f = t.defaultPlaylistId ?? t.fallbackPlaylistId, v = o.get(f), k = t.layout.zones[0]?.id ?? "principal", I = A({
      state: e.rotations.get(k),
      playlistId: f,
      slideIds: v?.slideIds ?? [],
      isEligible: p,
      durationMsOf: h,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(k) ?? !1
    }), E = I.currentSlideId ? i.get(I.currentSlideId) : void 0;
    if (E)
      return I.state && c.set(k, I.state), {
        screen: {
          mode: "normal",
          zones: [
            {
              zoneId: k,
              rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
              playlistId: f,
              slide: F(E, r, s, t.settings.timezone)
            }
          ],
          emergency: null,
          identify: null,
          watermark: a,
          accent: l
        },
        rotations: c,
        transitions: d
      };
  }
  const w = e.forceFallback ? m.map((f) => ({ ...f, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } })) : ee(m);
  return {
    screen: { mode: b, zones: w, emergency: null, identify: null, watermark: a, accent: l },
    rotations: c,
    transitions: d
  };
}
function F(e, t, n, i) {
  switch (e.kind) {
    case "media": {
      const r = t.get(e.assetId);
      return r ? { kind: "media", slideId: e.id, asset: r, fit: e.fit ?? "entier" } : null;
    }
    case "template":
      return { kind: "template", slideId: e.id, templateId: e.templateId, fields: e.fields };
    case "widget":
      return { kind: "widget", slideId: e.id, widget: e.widget, config: e.config };
    case "data": {
      const r = n.get(e.sourceId);
      return !r || !O(r) ? null : {
        kind: "data",
        slideId: e.id,
        sourceId: e.sourceId,
        view: e.view,
        payload: "payload" in r ? r.payload : null,
        params: e.params,
        staleLabel: $(r, "fr-FR", i)
      };
    }
  }
}
function Q(e, t) {
  const n = e?.days;
  return Array.isArray(n) ? t ? n.find((i) => i.classId === t) ?? null : n[0] ?? null : e ?? null;
}
function ee(e) {
  const t = /* @__PURE__ */ new Map();
  for (const l of e) {
    const u = `${l.rect.yPercent}:${l.rect.heightPercent}`, p = t.get(u);
    p ? p.push(l) : t.set(u, [l]);
  }
  const n = [];
  for (const l of t.values()) {
    const u = l.filter((d) => d.slide !== null);
    if (u.length === 0) continue;
    const p = l.reduce((d, m) => d + m.rect.widthPercent, 0), h = u.reduce((d, m) => d + m.rect.widthPercent, 0), b = h > 0 ? p / h : 1;
    let c = Math.min(...l.map((d) => d.rect.xPercent));
    n.push(
      u.map((d) => {
        const m = d.rect.widthPercent * b, y = { ...d, rect: { ...d.rect, xPercent: c, widthPercent: m } };
        return c += m, y;
      })
    );
  }
  if (n.length === 0) return [];
  const i = [...t.values()].reduce((l, u) => l + (u[0]?.rect.heightPercent ?? 0), 0), r = n.reduce((l, u) => l + (u[0]?.rect.heightPercent ?? 0), 0), o = r > 0 ? i / r : 1, s = [];
  let a = Math.min(...e.map((l) => l.rect.yPercent));
  for (const l of n.sort((u, p) => (u[0]?.rect.yPercent ?? 0) - (p[0]?.rect.yPercent ?? 0))) {
    const u = (l[0]?.rect.heightPercent ?? 0) * o;
    for (const p of l)
      s.push({ ...p, rect: { ...p.rect, yPercent: a, heightPercent: u } });
    a += u;
  }
  return s;
}
const te = 1.7, ne = 780;
function N(e) {
  const [t, n] = e.split(":").map(Number);
  return (t ?? 0) * 60 + (n ?? 0);
}
function re(e, t) {
  const n = new Intl.DateTimeFormat("fr-FR", {
    timeZone: t,
    hour: "2-digit",
    minute: "2-digit",
    hour12: !1
  }), [i, r] = n.format(new Date(e)).split(":").map(Number);
  return (i ?? 0) * 60 + (r ?? 0);
}
function ie(e, t, n = ne) {
  if (e.length === 0) return [];
  const i = e.filter((a) => N(a.time) < n), r = e.filter((a) => N(a.time) >= n), o = t < n ? i : r;
  if (o.length > 0) return o;
  const s = t < n ? r : i;
  return s.length > 0 ? s : [...e];
}
function oe(e, t, n) {
  if (t <= 0) return n;
  const i = e * 0.9 / t / 2.5, r = n * te;
  return Math.round(Math.min(Math.max(i, r), n * 4));
}
function ae(e, t) {
  const n = Math.ceil(e - t);
  return n < 8 ? null : {
    coursePx: n,
    dureeMs: Math.round(n / 28 * 2 * 1e3) + 6e3
  };
}
const le = `
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
  /* Pas de curseur sur une dalle de couloir. On le masque ici plutôt qu'avec
     un outil du systeme : unclutter ne vaut que pour X, et les boitiers
     tournent aussi sous Wayland. La page est a nous, elle sait le faire
     partout. */
  cursor: none;
  /* Ni selection ni tirer-deposer : personne ne saisit rien sur un mur, et
     un texte surligne par un doigt curieux resterait bleu jusqu'au prochain
     redemarrage. */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
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
  /* Le defilement de la liste, lui, reste : ce n'est pas un ornement, c'est
     le seul moyen de voir les seances qui depassent de la dalle. L'eteindre
     supprimerait de l'information au lieu d'epargner une animation. */
}

/* L'image tient en entier par défaut. Rogner ferait disparaitre un titre
   sans prévenir, et personne ne s'en apercevrait avant de passer devant. */
.couloir-media { width: 100%; height: 100%; object-fit: contain; display: block }
.couloir-slide--remplir .couloir-media { object-fit: cover }
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
/* Une journée se lit du haut. Centrée verticalement, elle laisse deux
   grandes bandes vides sur une dalle entière — et l'oeil cherche où
   commencer. */
.couloir-slide:has(> .couloir-list),
.couloir-slide:has(> .couloir-eyebrow + .couloir-list) { justify-content: flex-start; }

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

/* Le defilement d'une journee trop longue pour la dalle.
   La course et la duree sont posees en ligne par le rendu, qui seul connait
   la hauteur reelle du texte. Les paliers sont des temps d'arret : en haut on
   lit l'heure qu'il est, en bas la fin de la journee.
   (Fichier ecrit dans un litteral de gabarit : aucun accent grave ici.) */
.couloir-defile {
  animation: couloir-defile var(--defile-duree, 30s) ease-in-out infinite;
  will-change: transform;
}
@keyframes couloir-defile {
  0%, 14%   { transform: translateY(0) }
  50%, 64%  { transform: translateY(var(--defile-course, 0px)) }
  100%      { transform: translateY(0) }
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
function se(e, t = {}) {
  const n = e.ownerDocument, i = n.createElement("style");
  i.textContent = le, e.appendChild(i);
  const r = n.createElement("div");
  r.className = "couloir-root", e.appendChild(r);
  let o = () => {
  };
  const s = /* @__PURE__ */ new Map();
  let a = "";
  const l = () => {
    const c = r.clientHeight || 1080, d = Y(c);
    r.style.setProperty("--fs-eyebrow", `${d.eyebrow}px`), r.style.setProperty("--fs-title", `${d.title}px`), r.style.setProperty("--fs-body", `${d.body}px`), r.style.setProperty("--fs-caption", `${d.caption}px`), r.style.setProperty("--pad", `${Math.round(c * 0.045)}px`);
  }, u = new ResizeObserver(l);
  u.observe(r), l();
  function p(c) {
    const d = `${c.mode}:${c.emergency?.id ?? ""}:${c.identify?.screenCode ?? ""}`;
    if (c.mode === "normal" || c.mode === "fallback") return !1;
    if (d === a) return !0;
    a = d, r.replaceChildren(), s.clear();
    const m = n.createElement("div");
    return c.mode === "emergency" && c.emergency ? (m.className = "couloir-full couloir-full--emergency", m.append(
      g(n, "p", "couloir-eyebrow", "Message important"),
      g(n, "h1", "couloir-title", c.emergency.title)
    ), c.emergency.body && m.append(g(n, "p", "couloir-body", c.emergency.body))) : c.mode === "identify" && c.identify ? (m.className = "couloir-full couloir-full--identify", m.append(
      g(n, "div", "couloir-code", c.identify.screenCode),
      g(n, "p", "couloir-body", c.identify.label),
      g(n, "p", "couloir-body", c.identify.ipAddress)
    )) : m.className = "couloir-full couloir-full--off", r.appendChild(m), !0;
  }
  function h(c) {
    a !== "" && (r.replaceChildren(), s.clear(), a = "");
    const d = /* @__PURE__ */ new Set();
    for (const y of c.zones) {
      d.add(y.zoneId);
      let w = r.querySelector(`[data-zone="${y.zoneId}"]`);
      w || (w = n.createElement("section"), w.className = "couloir-zone", w.dataset.zone = y.zoneId, r.appendChild(w)), w.style.left = `${y.rect.xPercent}%`, w.style.top = `${y.rect.yPercent}%`, w.style.width = `${y.rect.widthPercent}%`, w.style.height = `${y.rect.heightPercent}%`;
      const f = y.slide ? ce(y.slide) : null;
      if (s.get(y.zoneId) !== f) {
        if (w.replaceChildren(), f === null) {
          s.delete(y.zoneId);
          continue;
        }
        s.set(y.zoneId, f), w.appendChild(de(n, y, y.slide, t, o));
      }
    }
    for (const y of [...r.querySelectorAll("[data-zone]")]) {
      const w = y.dataset.zone;
      w && !d.has(w) && (y.remove(), s.delete(w));
    }
    let m = r.querySelector(".couloir-watermark");
    c.watermark ? (m || (m = g(n, "div", "couloir-watermark", c.watermark), r.appendChild(m)), m.textContent = c.watermark) : m?.remove();
  }
  let b = null;
  return {
    update(c) {
      c.accent !== b && (b = c.accent, c.accent ? r.style.setProperty("--accent", c.accent) : r.style.removeProperty("--accent")), !p(c) && h(c);
    },
    onMediaEnded(c) {
      o = c;
    },
    destroy() {
      u.disconnect(), r.remove(), i.remove();
    }
  };
}
function ce(e) {
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
function g(e, t, n, i) {
  const r = e.createElement(t);
  return r.className = n, i !== void 0 && (r.textContent = i), r;
}
function de(e, t, n, i, r) {
  const o = e.createElement("div");
  switch (o.className = "couloir-slide", o.dataset.slide = n.slideId, n.kind) {
    case "media": {
      o.classList.add("couloir-slide--media"), n.fit === "remplir" && o.classList.add("couloir-slide--remplir");
      const s = i.assetUrl?.(n.asset.id) ?? n.asset.url;
      if (n.asset.mime.startsWith("video/")) {
        const a = e.createElement("video");
        a.className = "couloir-media", a.src = s, a.muted = !0, a.autoplay = !0, a.playsInline = !0, a.addEventListener("ended", () => r(t.zoneId)), a.addEventListener("error", () => r(t.zoneId)), o.appendChild(a);
      } else {
        const a = e.createElement("img");
        a.className = "couloir-media", a.src = s, a.alt = "", o.appendChild(a);
      }
      return o;
    }
    case "template": {
      const s = (p) => {
        const h = n.fields[p];
        return typeof h == "string" ? h : void 0;
      }, a = s("eyebrow"), l = s("titre") ?? s("title"), u = s("texte") ?? s("body");
      return a && o.appendChild(g(e, "p", "couloir-eyebrow", a)), l && o.appendChild(g(e, "h1", "couloir-title", l)), u && o.appendChild(g(e, "p", "couloir-body", u)), o;
    }
    case "widget": {
      if (n.widget === "ticker") {
        o.classList.add("couloir-slide--ticker");
        const s = typeof n.config.text == "string" ? n.config.text : "", a = g(e, "div", "couloir-ticker-viewport");
        a.appendChild(g(e, "span", "couloir-ticker-text", s)), o.appendChild(a);
        const l = g(e, "div", "couloir-clock", ""), u = () => {
          l.textContent = new Intl.DateTimeFormat(i.locale ?? "fr-FR", {
            timeZone: i.timezone ?? "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit"
          }).format(/* @__PURE__ */ new Date());
        };
        u();
        const p = setInterval(u, 1e4);
        return new MutationObserver((h, b) => {
          l.isConnected || (clearInterval(p), b.disconnect());
        }).observe(o.ownerDocument.body, { childList: !0, subtree: !0 }), o.appendChild(l), o;
      }
      return o.appendChild(g(e, "p", "couloir-eyebrow", n.widget)), o;
    }
    case "data":
      return he(e, o, n, i.timezone ?? "Europe/Paris"), n.staleLabel && o.appendChild(g(e, "p", "couloir-stale", n.staleLabel)), o;
  }
}
const ue = ["heureFin", "module", "salle", "enseignant"];
function fe(e) {
  return e === void 0 ? new Set(ue) : new Set(
    e.split(",").map((t) => t.trim()).filter(Boolean)
  );
}
function me(e, t) {
  const n = e?.days;
  if (Array.isArray(n))
    return t ? n.find((r) => r.classId === t) ?? null : n[0] ?? null;
  const i = e;
  return i && Array.isArray(i.entries) ? i : null;
}
function pe(e, t, n) {
  const i = n.payload, r = Array.isArray(i) ? i : i?.articles ?? [];
  if (r.length === 0) return;
  const o = Number(n.params.index ?? 0), s = r[(o % r.length + r.length) % r.length];
  if (s?.titre) {
    if (s.image) {
      const a = e.createElement("img");
      a.className = "couloir-illustration", a.src = s.image, a.alt = "", a.addEventListener("error", () => a.remove()), t.appendChild(a);
    }
    s.categorie && t.appendChild(g(e, "p", "couloir-eyebrow", s.categorie)), t.appendChild(g(e, "h1", "couloir-title", s.titre)), s.extrait && t.appendChild(g(e, "p", "couloir-body", s.extrait));
  }
}
function ge(e, t, n, i) {
  if (i <= 0) return;
  const r = e.defaultView, o = () => {
    if (!t.isConnected) return;
    const s = t.clientHeight;
    if (s <= 0) return;
    const a = Number.parseFloat(r?.getComputedStyle(t).fontSize ?? "24") || 24;
    n.style.fontSize = `${oe(s, i, a)}px`;
    const l = ae(t.scrollHeight, s);
    n.classList.toggle("couloir-defile", l !== null), l && (n.style.setProperty("--defile-course", `-${l.coursePx}px`), n.style.setProperty("--defile-duree", `${l.dureeMs}ms`));
  };
  r?.requestAnimationFrame ? r.requestAnimationFrame(() => r.requestAnimationFrame(o)) : o(), e.fonts?.ready?.then(o).catch(() => {
  });
}
function he(e, t, n, i) {
  if (n.view.startsWith("timetable")) {
    const r = me(n.payload, n.params.classId);
    if (!r) return;
    const o = fe(n.params.champs);
    if (t.appendChild(g(e, "p", "couloir-eyebrow", r.classLabel)), r.notice) {
      t.appendChild(g(e, "p", "couloir-body", r.notice));
      return;
    }
    const s = n.params.demiJournee === "1" ? ie(r.entries, re(Date.now(), i)) : r.entries, a = e.createElement("ul");
    a.className = "couloir-list";
    for (const l of s) {
      const u = l.change && l.change !== "none", p = e.createElement("li");
      p.className = u ? "couloir-row couloir-row--changed" : "couloir-row", l.change === "cancelled" && p.classList.add("couloir-row--cancelled");
      const h = e.createElement("time");
      h.appendChild(e.createTextNode(l.time)), o.has("heureFin") && l.endTime && l.endTime !== l.time && h.appendChild(g(e, "span", "couloir-fin", l.endTime));
      const b = e.createElement("span");
      b.appendChild(e.createTextNode(l.subject)), l.note && b.appendChild(g(e, "span", "couloir-badge", l.note)), o.has("module") && l.detail && b.appendChild(g(e, "span", "couloir-detail", l.detail));
      const c = e.createElement("span");
      c.className = "room", l.change === "cancelled" ? c.appendChild(e.createTextNode("—")) : (o.has("salle") && c.appendChild(e.createTextNode(l.room)), o.has("enseignant") && l.teacher && c.appendChild(g(e, "span", "couloir-prof", l.teacher))), p.append(h, b, c), a.appendChild(p);
    }
    t.appendChild(a), ge(e, t, a, s.length);
    return;
  }
  n.view.startsWith("news") && pe(e, t, n);
}
function we(e, t) {
  const n = se(e, t), i = t.pollMs ?? 2e3, r = t.tickMs ?? 500;
  let o = null, s = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Set(), l = !1;
  n.onMediaEnded((d) => {
    a.add(d), h();
  });
  function u(d) {
    if (typeof document > "u") return;
    const m = d.screenCode ? d.screenCode : d.pairing ? `À rattacher · ${d.pairing.code}` : "Couloir";
    document.title !== m && (document.title = m);
  }
  async function p() {
    if (!l)
      try {
        const d = await fetch(t.stateUrl, { cache: "no-store" });
        if (d.ok) {
          const m = await d.json();
          m.manifest?.version !== o?.manifest?.version && (s = /* @__PURE__ */ new Map()), o = m, u(m);
        }
      } catch {
      }
  }
  function h() {
    if (l) return;
    if (!o?.manifest) {
      n.update(ye(o));
      return;
    }
    const d = K({
      manifest: o.manifest,
      nowMs: Date.now(),
      sources: new Map(Object.entries(o.sources)),
      availableAssetIds: new Set(o.availableAssetIds),
      rotations: s,
      forceFallback: o.forceFallback,
      identify: o.identify,
      mediaEndedZoneIds: a,
      ...o.screenCode !== null ? { screenCode: o.screenCode } : {}
    });
    a = /* @__PURE__ */ new Set(), s = d.rotations, n.update(d.screen), d.transitions.length > 0 && t.transitionsUrl && ve(t.transitionsUrl, d.transitions);
  }
  const b = setInterval(() => void p(), i), c = setInterval(h, r);
  return p().then(h), {
    stop() {
      l = !0, clearInterval(b), clearInterval(c), n.destroy();
    }
  };
}
function ye(e) {
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
async function ve(e, t) {
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
  U as GLANCE_TIME_MS,
  B as MAX_SENSIBLE_DURATION_MS,
  H as MIN_BODY_TEXT_HEIGHT_PERCENT,
  j as READING_WORDS_PER_MINUTE,
  le as RENDERER_CSS,
  R as activePlaylistId,
  A as advanceRotation,
  ee as collapseEmptyZones,
  Z as countWords,
  L as dateLocale,
  K as direct,
  V as effectiveDuration,
  _ as isDisplayOffPeriod,
  O as isDisplayable,
  q as isScheduleActive,
  W as isVisible,
  M as isWithinDailyWindow,
  C as localMoment,
  J as minReadableDurationMs,
  se as mountRenderer,
  x as parseClock,
  T as resolveSource,
  X as slideText,
  $ as stalenessLabel,
  we as startPlayer,
  Y as typeScale
};
