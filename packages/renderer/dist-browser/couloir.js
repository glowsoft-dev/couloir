const R = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};
function $(e, t) {
  const n = new Intl.DateTimeFormat("en-CA", {
    timeZone: t,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(e)), i = (r) => n.find((o) => o.type === r)?.value ?? "";
  return `${i("year")}-${i("month")}-${i("day")}`;
}
function P(e, t) {
  const n = new Intl.DateTimeFormat("en-US", {
    timeZone: t,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: !1
  }).formatToParts(new Date(e)), i = (s) => n.find((a) => a.type === s)?.value ?? "", r = Number(i("hour")) % 24, o = Number(i("minute"));
  return {
    dayOfWeek: R[i("weekday")] ?? 1,
    minutesOfDay: r * 60 + o
  };
}
function E(e) {
  const [t, n] = e.split(":");
  return Number(t) * 60 + Number(n);
}
function C(e, t, n) {
  const i = E(t), r = E(n);
  return i === r ? !0 : i < r ? e >= i && e < r : e >= i || e < r;
}
function q(e, t, n) {
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
function L(e) {
  return e.status === "usable" || e.status === "stale-shown";
}
function _(e, t = "fr-FR", n = "Europe/Paris") {
  return e.status !== "stale-shown" ? null : `Mis à jour ${new Intl.DateTimeFormat(t, {
    timeZone: n,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(e.fetchedAtMs))}`;
}
function W(e, t, n) {
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const i = P(t, n);
  return !(e.daysOfWeek && e.daysOfWeek.length > 0 && !e.daysOfWeek.includes(i.dayOfWeek) || e.dailyStart && e.dailyEnd && !C(i.minutesOfDay, e.dailyStart, e.dailyEnd));
}
function U(e, t, n) {
  const i = e.layout.zones.find((a) => a.id === t);
  if (!i) return null;
  const r = e.settings.timezone, o = e.schedules.filter((a) => a.zoneId === t).filter((a) => W(a, n, r));
  if (o.length === 0) return i.playlistId;
  let s = o[0];
  for (const a of o.slice(1))
    a.priority >= s.priority && (s = a);
  return s.playlistId;
}
function j(e, t, n) {
  if (!e) return !0;
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const i = P(t, n);
  if (e.dailyStart && e.dailyEnd && !C(i.minutesOfDay, e.dailyStart, e.dailyEnd))
    return !1;
  if (e.daysOfWeek && e.daysOfWeek.length > 0) {
    const r = (i.dayOfWeek + 5) % 7 + 1, o = !!(e.dailyStart && e.dailyEnd) && E(e.dailyStart) > E(e.dailyEnd) && i.minutesOfDay < E(e.dailyEnd);
    if (!e.daysOfWeek.includes(o ? r : i.dayOfWeek)) return !1;
  }
  return !0;
}
function Z(e, t) {
  const n = P(t, e.timezone), i = (n.dayOfWeek + 5) % 7 + 1;
  return e.displayOff.some((r) => {
    if (!C(n.minutesOfDay, r.from, r.to)) return !1;
    if (r.daysOfWeek.length === 0) return !0;
    const o = E(r.from), s = E(r.to), a = o > s && n.minutesOfDay < s;
    return r.daysOfWeek.includes(a ? i : n.dayOfWeek);
  });
}
const B = 130, H = 2500, V = 6e4, J = 1.9;
function X(e) {
  const t = e.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}
function Y(e) {
  const t = X(e);
  return Math.round(H + t / B * 6e4);
}
function G(e) {
  return e.kind !== "template" ? "" : Object.values(e.fields).filter((t) => typeof t == "string").join(" ");
}
function K(e) {
  const t = "durationMs" in e && e.durationMs ? e.durationMs : 0, n = Y(G(e)), i = Math.min(Math.max(t, n), V);
  return { effectiveMs: i, requestedMs: t, extended: i > t };
}
function Q(e, t = 1) {
  const n = Math.round(
    e * J * t / 100
  );
  return {
    eyebrow: Math.round(n * 0.72),
    title: Math.round(n * 2.4),
    body: n,
    caption: Math.round(n * 0.8)
  };
}
function A(e, t, n) {
  for (let i = 1; i <= e.length; i++) {
    const r = (t + i) % e.length, o = e[r];
    if (o !== void 0 && n(o)) return r;
  }
  return null;
}
function ee(e, t) {
  for (let n = 0; n < e.length; n++) {
    const i = e[n];
    if (i !== void 0 && t(i)) return n;
  }
  return null;
}
function D(e) {
  const { state: t, playlistId: n, slideIds: i, isEligible: r, durationMsOf: o, nowMs: s } = e, a = t && t.playlistId === n ? i[t.index] ?? null : null, l = (f) => {
    if (f === null)
      return { state: null, currentSlideId: null, changed: a !== null };
    const c = i[f];
    return {
      state: { playlistId: n, index: f, slideStartedAtMs: s },
      currentSlideId: c,
      changed: c !== a
    };
  };
  if (!t || t.playlistId !== n || t.index >= i.length)
    return l(ee(i, r));
  const d = i[t.index];
  if (d === void 0 || !r(d))
    return l(A(i, t.index, r));
  const m = o(d), g = s - t.slideStartedAtMs;
  if (!(m === null ? e.mediaEnded === !0 : g >= m))
    return { state: t, currentSlideId: d, changed: !1 };
  const b = A(i, t.index, r);
  return l(b === null ? null : b);
}
function te(e) {
  const { manifest: t, nowMs: n } = e, i = new Map(t.slides.map((u) => [u.id, u])), r = new Map(t.assets.map((u) => [u.id, u])), o = new Map(t.playlists.map((u) => [u.id, u])), s = new Map(
    t.dataSources.map((u) => [
      u.id,
      q(u, e.sources.get(u.id), n)
    ])
  ), a = t.settings.showScreenCodeWatermark ? e.screenCode ?? null : null, l = t.settings.branding?.accent ?? null, d = t.settings.zoom ?? null, m = t.emergency;
  if (m && n < Date.parse(m.validUntil))
    return {
      screen: { mode: "emergency", zones: [], emergency: m, identify: null, watermark: a, accent: l, zoom: d },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (e.identify)
    return {
      screen: { mode: "identify", zones: [], emergency: null, identify: e.identify, watermark: null, accent: l, zoom: d },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (Z(t.settings, n))
    return {
      screen: { mode: "display-off", zones: [], emergency: null, identify: null, watermark: null, accent: l, zoom: d },
      rotations: new Map(e.rotations),
      transitions: []
    };
  const g = (u) => {
    const h = i.get(u);
    if (!h || !j(h.visibility, n, t.settings.timezone)) return !1;
    switch (h.kind) {
      case "media":
        return e.availableAssetIds.has(h.assetId);
      case "template":
        return h.assetIds.every((k) => e.availableAssetIds.has(k));
      case "widget":
        return !0;
      case "data": {
        const k = s.get(h.sourceId);
        if (k === void 0 || !L(k)) return !1;
        if (h.view.startsWith("timetable") && "payload" in k) {
          const x = ne(k.payload, h.params.classId);
          if (x?.date && x.date !== $(n, t.settings.timezone)) return !1;
        }
        return !0;
      }
    }
  }, I = (u) => {
    const h = i.get(u);
    return h ? h.kind === "media" && h.durationMs === void 0 ? null : K(h).effectiveMs : 0;
  }, b = e.forceFallback ? "fallback" : "normal", f = /* @__PURE__ */ new Map(), c = [], v = [];
  for (const u of t.layout.zones) {
    const h = e.forceFallback ? t.fallbackPlaylistId : U(t, u.id, n) ?? u.playlistId, k = o.get(h), x = e.rotations.get(u.id), M = x && x.playlistId === h ? k?.slideIds[x.index] ?? null : null, S = D({
      state: x,
      playlistId: h,
      slideIds: k?.slideIds ?? [],
      isEligible: g,
      durationMsOf: I,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(u.id) ?? !1
    });
    S.state && f.set(u.id, S.state), S.changed && c.push({
      zoneId: u.id,
      fromSlideId: M,
      toSlideId: S.currentSlideId,
      atMs: n
    });
    const z = S.currentSlideId ? i.get(S.currentSlideId) : void 0;
    if (v.push({
      zoneId: u.id,
      rect: u.rect,
      playlistId: h,
      slide: z ? F(z, r, s, t.settings.timezone) : null
    }), e.forceFallback) break;
  }
  if (!e.forceFallback && v.every((u) => u.slide === null)) {
    const u = t.defaultPlaylistId ?? t.fallbackPlaylistId, h = o.get(u), k = t.layout.zones[0]?.id ?? "principal", x = D({
      state: e.rotations.get(k),
      playlistId: u,
      slideIds: h?.slideIds ?? [],
      isEligible: g,
      durationMsOf: I,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(k) ?? !1
    }), M = x.currentSlideId ? i.get(x.currentSlideId) : void 0;
    if (M)
      return x.state && f.set(k, x.state), {
        screen: {
          mode: "normal",
          zones: [
            {
              zoneId: k,
              rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
              playlistId: u,
              slide: F(M, r, s, t.settings.timezone)
            }
          ],
          emergency: null,
          identify: null,
          watermark: a,
          accent: l,
          zoom: d
        },
        rotations: f,
        transitions: c
      };
  }
  const p = e.forceFallback ? v.map((u) => ({ ...u, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } })) : re(v);
  return {
    screen: {
      mode: b,
      zones: p,
      emergency: null,
      identify: null,
      watermark: a,
      accent: l,
      zoom: d
    },
    rotations: f,
    transitions: c
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
      return !r || !L(r) ? null : {
        kind: "data",
        slideId: e.id,
        sourceId: e.sourceId,
        view: e.view,
        payload: "payload" in r ? r.payload : null,
        params: e.params,
        staleLabel: _(r, "fr-FR", i)
      };
    }
  }
}
function ne(e, t) {
  const n = e?.days;
  return Array.isArray(n) ? t ? n.find((i) => i.classId === t) ?? null : n[0] ?? null : e ?? null;
}
function re(e) {
  const t = /* @__PURE__ */ new Map();
  for (const l of e) {
    const d = `${l.rect.yPercent}:${l.rect.heightPercent}`, m = t.get(d);
    m ? m.push(l) : t.set(d, [l]);
  }
  const n = [];
  for (const l of t.values()) {
    const d = l.filter((f) => f.slide !== null);
    if (d.length === 0) continue;
    const m = l.reduce((f, c) => f + c.rect.widthPercent, 0), g = d.reduce((f, c) => f + c.rect.widthPercent, 0), I = g > 0 ? m / g : 1;
    let b = Math.min(...l.map((f) => f.rect.xPercent));
    n.push(
      d.map((f) => {
        const c = f.rect.widthPercent * I, v = { ...f, rect: { ...f.rect, xPercent: b, widthPercent: c } };
        return b += c, v;
      })
    );
  }
  if (n.length === 0) return [];
  const i = [...t.values()].reduce((l, d) => l + (d[0]?.rect.heightPercent ?? 0), 0), r = n.reduce((l, d) => l + (d[0]?.rect.heightPercent ?? 0), 0), o = r > 0 ? i / r : 1, s = [];
  let a = Math.min(...e.map((l) => l.rect.yPercent));
  for (const l of n.sort((d, m) => (d[0]?.rect.yPercent ?? 0) - (m[0]?.rect.yPercent ?? 0))) {
    const d = (l[0]?.rect.heightPercent ?? 0) * o;
    for (const m of l)
      s.push({ ...m, rect: { ...m.rect, yPercent: a, heightPercent: d } });
    a += d;
  }
  return s;
}
const N = 0.92, ie = 0.6, oe = 2.5;
function ae(e) {
  return typeof e != "number" || !Number.isFinite(e) || e <= 0 ? 1 : Math.min(Math.max(e, ie), oe);
}
function le(e, t, n) {
  const i = Math.round(n.largeur) || 0, r = Math.round(n.hauteur) || 0, s = !(i > 0 && r > 0) || e >= i * N && t >= r * N;
  return {
    largeurPx: Math.round(e),
    hauteurPx: Math.round(t),
    largeurDallePx: i,
    hauteurDallePx: r,
    densite: n.densite > 0 ? n.densite : 1,
    pleinEcran: s
  };
}
function se(e, t) {
  return e ? e.largeurPx !== t.largeurPx || e.hauteurPx !== t.hauteurPx || e.largeurDallePx !== t.largeurDallePx || e.hauteurDallePx !== t.hauteurDallePx || e.densite !== t.densite || e.pleinEcran !== t.pleinEcran : !0;
}
const ce = 1.7, ue = 780;
function O(e) {
  const [t, n] = e.split(":").map(Number);
  return (t ?? 0) * 60 + (n ?? 0);
}
function de(e, t) {
  const n = new Intl.DateTimeFormat("fr-FR", {
    timeZone: t,
    hour: "2-digit",
    minute: "2-digit",
    hour12: !1
  }), [i, r] = n.format(new Date(e)).split(":").map(Number);
  return (i ?? 0) * 60 + (r ?? 0);
}
function fe(e, t, n = ue) {
  if (e.length === 0) return [];
  const i = e.filter((a) => O(a.time) < n), r = e.filter((a) => O(a.time) >= n), o = t < n ? i : r;
  if (o.length > 0) return o;
  const s = t < n ? r : i;
  return s.length > 0 ? s : [...e];
}
function me(e, t, n) {
  if (t <= 0) return n;
  const i = e * 0.9 / t / 2.5, r = n * ce;
  return Math.round(Math.min(Math.max(i, r), n * 4));
}
function pe(e, t) {
  const n = Math.ceil(e - t);
  return n < 8 ? null : {
    coursePx: n,
    dureeMs: Math.round(n / 28 * 2 * 1e3) + 6e3
  };
}
const ge = `
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
`, T = Symbol.for("couloir.ajusteur");
function he(e, t = {}) {
  const n = e.ownerDocument, i = n.createElement("style");
  i.textContent = ge, e.appendChild(i);
  const r = n.createElement("div");
  r.className = "couloir-root", e.appendChild(r);
  let o = () => {
  };
  const s = /* @__PURE__ */ new Map();
  let a = "", l = 1, d = null;
  const m = () => {
    const c = r.clientHeight || 1080, v = Q(c, l);
    r.style.setProperty("--fs-eyebrow", `${v.eyebrow}px`), r.style.setProperty("--fs-title", `${v.title}px`), r.style.setProperty("--fs-body", `${v.body}px`), r.style.setProperty("--fs-caption", `${v.caption}px`), r.style.setProperty("--pad", `${Math.round(c * 0.045)}px`);
    for (const p of r.querySelectorAll(".couloir-list"))
      p[T]?.();
    const w = n.defaultView;
    if (t.onResolution && w) {
      const p = le(r.clientWidth, c, {
        largeur: w.screen?.width ?? 0,
        hauteur: w.screen?.height ?? 0,
        densite: w.devicePixelRatio ?? 1
      });
      se(d, p) && (d = p, t.onResolution(p));
    }
  }, g = new ResizeObserver(m);
  g.observe(r), m();
  function I(c) {
    const v = `${c.mode}:${c.emergency?.id ?? ""}:${c.identify?.screenCode ?? ""}`;
    if (c.mode === "normal" || c.mode === "fallback") return !1;
    if (v === a) return !0;
    a = v, r.replaceChildren(), s.clear();
    const w = n.createElement("div");
    return c.mode === "emergency" && c.emergency ? (w.className = "couloir-full couloir-full--emergency", w.append(
      y(n, "p", "couloir-eyebrow", "Message important"),
      y(n, "h1", "couloir-title", c.emergency.title)
    ), c.emergency.body && w.append(y(n, "p", "couloir-body", c.emergency.body))) : c.mode === "identify" && c.identify ? (w.className = "couloir-full couloir-full--identify", w.append(
      y(n, "div", "couloir-code", c.identify.screenCode),
      y(n, "p", "couloir-body", c.identify.label),
      y(n, "p", "couloir-body", c.identify.ipAddress)
    )) : w.className = "couloir-full couloir-full--off", r.appendChild(w), !0;
  }
  function b(c) {
    a !== "" && (r.replaceChildren(), s.clear(), a = "");
    const v = /* @__PURE__ */ new Set();
    for (const p of c.zones) {
      v.add(p.zoneId);
      let u = r.querySelector(`[data-zone="${p.zoneId}"]`);
      u || (u = n.createElement("section"), u.className = "couloir-zone", u.dataset.zone = p.zoneId, r.appendChild(u)), u.style.left = `${p.rect.xPercent}%`, u.style.top = `${p.rect.yPercent}%`, u.style.width = `${p.rect.widthPercent}%`, u.style.height = `${p.rect.heightPercent}%`;
      const h = p.slide ? ye(p.slide) : null;
      if (s.get(p.zoneId) !== h) {
        if (u.replaceChildren(), h === null) {
          s.delete(p.zoneId);
          continue;
        }
        s.set(p.zoneId, h), u.appendChild(ve(n, p, p.slide, t, o));
      }
    }
    for (const p of [...r.querySelectorAll("[data-zone]")]) {
      const u = p.dataset.zone;
      u && !v.has(u) && (p.remove(), s.delete(u));
    }
    let w = r.querySelector(".couloir-watermark");
    c.watermark ? (w || (w = y(n, "div", "couloir-watermark", c.watermark), r.appendChild(w)), w.textContent = c.watermark) : w?.remove();
  }
  let f = null;
  return {
    update(c) {
      const v = ae(c.zoom);
      v !== l && (l = v, m()), c.accent !== f && (f = c.accent, c.accent ? r.style.setProperty("--accent", c.accent) : r.style.removeProperty("--accent")), !I(c) && b(c);
    },
    onMediaEnded(c) {
      o = c;
    },
    destroy() {
      g.disconnect(), r.remove(), i.remove();
    }
  };
}
function ye(e) {
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
function y(e, t, n, i) {
  const r = e.createElement(t);
  return r.className = n, i !== void 0 && (r.textContent = i), r;
}
function ve(e, t, n, i, r) {
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
      const s = (m) => {
        const g = n.fields[m];
        return typeof g == "string" ? g : void 0;
      }, a = s("eyebrow"), l = s("titre") ?? s("title"), d = s("texte") ?? s("body");
      return a && o.appendChild(y(e, "p", "couloir-eyebrow", a)), l && o.appendChild(y(e, "h1", "couloir-title", l)), d && o.appendChild(y(e, "p", "couloir-body", d)), o;
    }
    case "widget": {
      if (n.widget === "ticker") {
        o.classList.add("couloir-slide--ticker");
        const s = typeof n.config.text == "string" ? n.config.text : "", a = y(e, "div", "couloir-ticker-viewport");
        a.appendChild(y(e, "span", "couloir-ticker-text", s)), o.appendChild(a);
        const l = y(e, "div", "couloir-clock", ""), d = () => {
          l.textContent = new Intl.DateTimeFormat(i.locale ?? "fr-FR", {
            timeZone: i.timezone ?? "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit"
          }).format(/* @__PURE__ */ new Date());
        };
        d();
        const m = setInterval(d, 1e4);
        return new MutationObserver((g, I) => {
          l.isConnected || (clearInterval(m), I.disconnect());
        }).observe(o.ownerDocument.body, { childList: !0, subtree: !0 }), o.appendChild(l), o;
      }
      return o.appendChild(y(e, "p", "couloir-eyebrow", n.widget)), o;
    }
    case "data":
      return Ee(e, o, n, i.timezone ?? "Europe/Paris"), n.staleLabel && o.appendChild(y(e, "p", "couloir-stale", n.staleLabel)), o;
  }
}
const we = ["heureFin", "module", "salle", "enseignant"];
function be(e) {
  return e === void 0 ? new Set(we) : new Set(
    e.split(",").map((t) => t.trim()).filter(Boolean)
  );
}
function Ie(e, t) {
  const n = e?.days;
  if (Array.isArray(n))
    return t ? n.find((r) => r.classId === t) ?? null : n[0] ?? null;
  const i = e;
  return i && Array.isArray(i.entries) ? i : null;
}
function ke(e, t, n) {
  const i = n.payload, r = Array.isArray(i) ? i : i?.articles ?? [];
  if (r.length === 0) return;
  const o = Number(n.params.index ?? 0), s = r[(o % r.length + r.length) % r.length];
  if (s?.titre) {
    if (s.image) {
      const a = e.createElement("img");
      a.className = "couloir-illustration", a.src = s.image, a.alt = "", a.addEventListener("error", () => a.remove()), t.appendChild(a);
    }
    s.categorie && t.appendChild(y(e, "p", "couloir-eyebrow", s.categorie)), t.appendChild(y(e, "h1", "couloir-title", s.titre)), s.extrait && t.appendChild(y(e, "p", "couloir-body", s.extrait));
  }
}
function xe(e, t, n, i) {
  if (i <= 0) return;
  const r = e.defaultView, o = () => {
    if (!t.isConnected) return;
    const s = t.clientHeight;
    if (s <= 0) return;
    const a = Number.parseFloat(
      r?.getComputedStyle(t).getPropertyValue("--fs-body") ?? ""
    ) || 24, l = `${me(s, i, a)}px`;
    n.style.fontSize !== l && (n.style.fontSize = l);
    const d = pe(t.scrollHeight, s);
    if (n.classList.toggle("couloir-defile", d !== null), d) {
      const m = `-${d.coursePx}px`, g = `${d.dureeMs}ms`;
      n.style.getPropertyValue("--defile-course") !== m && (n.style.setProperty("--defile-course", m), n.style.setProperty("--defile-duree", g));
    }
  };
  n[T] = o, r?.requestAnimationFrame ? r.requestAnimationFrame(() => r.requestAnimationFrame(o)) : o(), e.fonts?.ready?.then(o).catch(() => {
  });
}
function Ee(e, t, n, i) {
  if (n.view.startsWith("timetable")) {
    const r = Ie(n.payload, n.params.classId);
    if (!r) return;
    const o = be(n.params.champs);
    if (t.appendChild(y(e, "p", "couloir-eyebrow", r.classLabel)), r.notice) {
      t.appendChild(y(e, "p", "couloir-body", r.notice));
      return;
    }
    const s = n.params.demiJournee === "1" ? fe(r.entries, de(Date.now(), i)) : r.entries, a = e.createElement("ul");
    a.className = "couloir-list";
    for (const l of s) {
      const d = l.change && l.change !== "none", m = e.createElement("li");
      m.className = d ? "couloir-row couloir-row--changed" : "couloir-row", l.change === "cancelled" && m.classList.add("couloir-row--cancelled");
      const g = e.createElement("time");
      g.appendChild(e.createTextNode(l.time)), o.has("heureFin") && l.endTime && l.endTime !== l.time && g.appendChild(y(e, "span", "couloir-fin", l.endTime));
      const I = e.createElement("span");
      I.appendChild(e.createTextNode(l.subject)), l.note && I.appendChild(y(e, "span", "couloir-badge", l.note)), o.has("module") && l.detail && I.appendChild(y(e, "span", "couloir-detail", l.detail));
      const b = e.createElement("span");
      b.className = "room", l.change === "cancelled" ? b.appendChild(e.createTextNode("—")) : (o.has("salle") && b.appendChild(e.createTextNode(l.room)), o.has("enseignant") && l.teacher && b.appendChild(y(e, "span", "couloir-prof", l.teacher))), m.append(g, I, b), a.appendChild(m);
    }
    t.appendChild(a), xe(e, t, a, s.length);
    return;
  }
  n.view.startsWith("news") && ke(e, t, n);
}
function Pe(e, t) {
  const n = he(e, t), i = t.pollMs ?? 2e3, r = t.tickMs ?? 500;
  let o = null, s = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Set(), l = !1;
  n.onMediaEnded((f) => {
    a.add(f), g();
  });
  function d(f) {
    if (typeof document > "u") return;
    const c = f.screenCode ? f.screenCode : f.pairing ? `À rattacher · ${f.pairing.code}` : "Couloir";
    document.title !== c && (document.title = c);
  }
  async function m() {
    if (!l)
      try {
        const f = await fetch(t.stateUrl, { cache: "no-store" });
        if (f.ok) {
          const c = await f.json();
          c.manifest?.version !== o?.manifest?.version && (s = /* @__PURE__ */ new Map()), o = c, d(c);
        }
      } catch {
      }
  }
  function g() {
    if (l) return;
    if (!o?.manifest) {
      n.update(Se(o));
      return;
    }
    const f = te({
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
    a = /* @__PURE__ */ new Set(), s = f.rotations, n.update(f.screen), f.transitions.length > 0 && t.transitionsUrl && Me(t.transitionsUrl, f.transitions);
  }
  const I = setInterval(() => void m(), i), b = setInterval(g, r);
  return m().then(g), {
    stop() {
      l = !0, clearInterval(I), clearInterval(b), n.destroy();
    }
  };
}
function Se(e) {
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
    zoom: null,
    watermark: null
  } : {
    mode: "normal",
    // L'écran d'attente précède tout manifeste : aucune identité connue.
    accent: null,
    zoom: null,
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
async function Me(e, t) {
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
  H as GLANCE_TIME_MS,
  V as MAX_SENSIBLE_DURATION_MS,
  J as MIN_BODY_TEXT_HEIGHT_PERCENT,
  B as READING_WORDS_PER_MINUTE,
  ge as RENDERER_CSS,
  U as activePlaylistId,
  D as advanceRotation,
  re as collapseEmptyZones,
  X as countWords,
  $ as dateLocale,
  te as direct,
  K as effectiveDuration,
  Z as isDisplayOffPeriod,
  L as isDisplayable,
  W as isScheduleActive,
  j as isVisible,
  C as isWithinDailyWindow,
  P as localMoment,
  Y as minReadableDurationMs,
  he as mountRenderer,
  E as parseClock,
  q as resolveSource,
  G as slideText,
  _ as stalenessLabel,
  Pe as startPlayer,
  Q as typeScale
};
