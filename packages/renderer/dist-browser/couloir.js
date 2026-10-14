const Y = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};
function G(e, t) {
  const n = new Intl.DateTimeFormat("en-CA", {
    timeZone: t,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(e)), i = (r) => n.find((o) => o.type === r)?.value ?? "";
  return `${i("year")}-${i("month")}-${i("day")}`;
}
function T(e, t) {
  const n = new Intl.DateTimeFormat("en-US", {
    timeZone: t,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: !1
  }).formatToParts(new Date(e)), i = (a) => n.find((l) => l.type === a)?.value ?? "", r = Number(i("hour")) % 24, o = Number(i("minute"));
  return {
    dayOfWeek: Y[i("weekday")] ?? 1,
    minutesOfDay: r * 60 + o
  };
}
function F(e) {
  const [t, n] = e.split(":");
  return Number(t) * 60 + Number(n);
}
function O(e, t, n) {
  const i = F(t), r = F(n);
  return i === r ? !0 : i < r ? e >= i && e < r : e >= i || e < r;
}
function K(e, t, n) {
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
function H(e) {
  return e.status === "usable" || e.status === "stale-shown";
}
function Q(e, t = "fr-FR", n = "Europe/Paris") {
  return e.status !== "stale-shown" ? null : `Mis à jour ${new Intl.DateTimeFormat(t, {
    timeZone: n,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(e.fetchedAtMs))}`;
}
function ee(e, t, n) {
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const i = T(t, n);
  return !(e.daysOfWeek && e.daysOfWeek.length > 0 && !e.daysOfWeek.includes(i.dayOfWeek) || e.dailyStart && e.dailyEnd && !O(i.minutesOfDay, e.dailyStart, e.dailyEnd));
}
function te(e, t, n) {
  const i = e.layout.zones.find((l) => l.id === t);
  if (!i) return null;
  const r = e.settings.timezone, o = e.schedules.filter((l) => l.zoneId === t).filter((l) => ee(l, n, r));
  if (o.length === 0) return i.playlistId;
  let a = o[0];
  for (const l of o.slice(1))
    l.priority >= a.priority && (a = l);
  return a.playlistId;
}
function ne(e, t, n) {
  if (!e) return !0;
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const i = T(t, n);
  if (e.dailyStart && e.dailyEnd && !O(i.minutesOfDay, e.dailyStart, e.dailyEnd))
    return !1;
  if (e.daysOfWeek && e.daysOfWeek.length > 0) {
    const r = (i.dayOfWeek + 5) % 7 + 1, o = !!(e.dailyStart && e.dailyEnd) && F(e.dailyStart) > F(e.dailyEnd) && i.minutesOfDay < F(e.dailyEnd);
    if (!e.daysOfWeek.includes(o ? r : i.dayOfWeek)) return !1;
  }
  return !0;
}
function re(e, t) {
  const n = T(t, e.timezone), i = (n.dayOfWeek + 5) % 7 + 1;
  return e.displayOff.some((r) => {
    if (!O(n.minutesOfDay, r.from, r.to)) return !1;
    if (r.daysOfWeek.length === 0) return !0;
    const o = F(r.from), a = F(r.to), l = o > a && n.minutesOfDay < a;
    return r.daysOfWeek.includes(l ? i : n.dayOfWeek);
  });
}
const ie = 130, ae = 2500, oe = 6e4, le = 1.9;
function se(e) {
  const t = e.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}
function ce(e) {
  const t = se(e);
  return Math.round(ae + t / ie * 6e4);
}
function ue(e) {
  return e.kind !== "template" ? "" : Object.values(e.fields).filter((t) => typeof t == "string").join(" ");
}
function de(e) {
  const t = "durationMs" in e && e.durationMs ? e.durationMs : 0, n = ce(ue(e)), i = Math.min(Math.max(t, n), oe);
  return { effectiveMs: i, requestedMs: t, extended: i > t };
}
function fe(e, t = 1) {
  const n = Math.round(
    e * le * t / 100
  );
  return {
    eyebrow: Math.round(n * 0.72),
    title: Math.round(n * 2.4),
    body: n,
    caption: Math.round(n * 0.8)
  };
}
function R(e, t, n) {
  for (let i = 1; i <= e.length; i++) {
    const r = (t + i) % e.length, o = e[r];
    if (o !== void 0 && n(o)) return r;
  }
  return null;
}
function me(e, t) {
  for (let n = 0; n < e.length; n++) {
    const i = e[n];
    if (i !== void 0 && t(i)) return n;
  }
  return null;
}
function _(e) {
  const { state: t, playlistId: n, slideIds: i, isEligible: r, durationMsOf: o, nowMs: a } = e, l = t && t.playlistId === n ? i[t.index] ?? null : null, u = (p) => {
    if (p === null)
      return { state: null, currentSlideId: null, changed: l !== null };
    const s = i[p];
    return {
      state: { playlistId: n, index: p, slideStartedAtMs: a },
      currentSlideId: s,
      changed: s !== l
    };
  };
  if (!t || t.playlistId !== n || t.index >= i.length)
    return u(me(i, r));
  const c = i[t.index];
  if (c === void 0 || !r(c))
    return u(R(i, t.index, r));
  const d = o(c), y = a - t.slideStartedAtMs;
  if (!(d === null ? e.mediaEnded === !0 : y >= d))
    return { state: t, currentSlideId: c, changed: !1 };
  const S = R(i, t.index, r);
  return u(S === null ? null : S);
}
function pe(e) {
  const { manifest: t, nowMs: n } = e, i = new Map(t.slides.map((f) => [f.id, f])), r = new Map(t.assets.map((f) => [f.id, f])), o = new Map(t.playlists.map((f) => [f.id, f])), a = new Map(
    t.dataSources.map((f) => [
      f.id,
      K(f, e.sources.get(f.id), n)
    ])
  ), l = t.settings.showScreenCodeWatermark ? e.screenCode ?? null : null, u = t.settings.branding?.accent ?? null, c = t.settings.zoom ?? null, d = t.emergency;
  if (d && n < Date.parse(d.validUntil))
    return {
      screen: { mode: "emergency", zones: [], emergency: d, identify: null, watermark: l, accent: u, zoom: c },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (e.identify)
    return {
      screen: { mode: "identify", zones: [], emergency: null, identify: e.identify, watermark: null, accent: u, zoom: c },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (re(t.settings, n))
    return {
      screen: { mode: "display-off", zones: [], emergency: null, identify: null, watermark: null, accent: u, zoom: c },
      rotations: new Map(e.rotations),
      transitions: []
    };
  const y = (f) => {
    const x = i.get(f);
    if (!x || !ne(x.visibility, n, t.settings.timezone)) return !1;
    switch (x.kind) {
      case "media":
        return e.availableAssetIds.has(x.assetId);
      case "template":
        return x.assetIds.every((E) => e.availableAssetIds.has(E));
      case "widget":
        return !0;
      case "data": {
        const E = a.get(x.sourceId);
        if (E === void 0 || !H(E)) return !1;
        if (x.view.startsWith("timetable") && "payload" in E) {
          const P = he(E.payload, x.params.classId);
          if (P?.date && P.date !== G(n, t.settings.timezone)) return !1;
        }
        return !0;
      }
    }
  }, I = (f) => {
    const x = i.get(f);
    return x ? x.kind === "media" && x.durationMs === void 0 ? null : de(x).effectiveMs : 0;
  }, S = e.forceFallback ? "fallback" : "normal", p = /* @__PURE__ */ new Map(), s = [], b = [];
  for (const f of t.layout.zones) {
    const x = e.forceFallback ? t.fallbackPlaylistId : te(t, f.id, n) ?? f.playlistId, E = o.get(x), P = e.rotations.get(f.id), h = P && P.playlistId === x ? E?.slideIds[P.index] ?? null : null, w = _({
      state: P,
      playlistId: x,
      slideIds: E?.slideIds ?? [],
      isEligible: y,
      durationMsOf: I,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(f.id) ?? !1
    });
    w.state && p.set(f.id, w.state), w.changed && s.push({
      zoneId: f.id,
      fromSlideId: h,
      toSlideId: w.currentSlideId,
      atMs: n
    });
    const v = w.currentSlideId ? i.get(w.currentSlideId) : void 0;
    if (b.push({
      zoneId: f.id,
      rect: f.rect,
      playlistId: x,
      slide: v ? j(v, r, a, t.settings.timezone) : null
    }), e.forceFallback) break;
  }
  if (!e.forceFallback && b.every((f) => f.slide === null)) {
    const f = t.defaultPlaylistId ?? t.fallbackPlaylistId, x = o.get(f), E = t.layout.zones[0]?.id ?? "principal", P = _({
      state: e.rotations.get(E),
      playlistId: f,
      slideIds: x?.slideIds ?? [],
      isEligible: y,
      durationMsOf: I,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(E) ?? !1
    }), h = P.currentSlideId ? i.get(P.currentSlideId) : void 0;
    if (h)
      return P.state && p.set(E, P.state), {
        screen: {
          mode: "normal",
          zones: [
            {
              zoneId: E,
              rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
              playlistId: f,
              slide: j(h, r, a, t.settings.timezone)
            }
          ],
          emergency: null,
          identify: null,
          watermark: l,
          accent: u,
          zoom: c
        },
        rotations: p,
        transitions: s
      };
  }
  const g = e.forceFallback ? b.map((f) => ({ ...f, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } })) : ge(b);
  return {
    screen: {
      mode: S,
      zones: g,
      emergency: null,
      identify: null,
      watermark: l,
      accent: u,
      zoom: c
    },
    rotations: p,
    transitions: s
  };
}
function j(e, t, n, i) {
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
      return !r || !H(r) ? null : {
        kind: "data",
        slideId: e.id,
        sourceId: e.sourceId,
        view: e.view,
        payload: "payload" in r ? r.payload : null,
        params: e.params,
        staleLabel: Q(r, "fr-FR", i)
      };
    }
  }
}
function he(e, t) {
  const n = e?.days;
  return Array.isArray(n) ? t ? n.find((i) => i.classId === t) ?? null : n[0] ?? null : e ?? null;
}
function ge(e) {
  const t = /* @__PURE__ */ new Map();
  for (const u of e) {
    const c = `${u.rect.yPercent}:${u.rect.heightPercent}`, d = t.get(c);
    d ? d.push(u) : t.set(c, [u]);
  }
  const n = [];
  for (const u of t.values()) {
    const c = u.filter((p) => p.slide !== null);
    if (c.length === 0) continue;
    const d = u.reduce((p, s) => p + s.rect.widthPercent, 0), y = c.reduce((p, s) => p + s.rect.widthPercent, 0), I = y > 0 ? d / y : 1;
    let S = Math.min(...u.map((p) => p.rect.xPercent));
    n.push(
      c.map((p) => {
        const s = p.rect.widthPercent * I, b = { ...p, rect: { ...p.rect, xPercent: S, widthPercent: s } };
        return S += s, b;
      })
    );
  }
  if (n.length === 0) return [];
  const i = [...t.values()].reduce((u, c) => u + (c[0]?.rect.heightPercent ?? 0), 0), r = n.reduce((u, c) => u + (c[0]?.rect.heightPercent ?? 0), 0), o = r > 0 ? i / r : 1, a = [];
  let l = Math.min(...e.map((u) => u.rect.yPercent));
  for (const u of n.sort((c, d) => (c[0]?.rect.yPercent ?? 0) - (d[0]?.rect.yPercent ?? 0))) {
    const c = (u[0]?.rect.heightPercent ?? 0) * o;
    for (const d of u)
      a.push({ ...d, rect: { ...d.rect, yPercent: l, heightPercent: c } });
    l += c;
  }
  return a;
}
const U = 0.92, ye = 0.6, xe = 2.5;
function ve(e) {
  return typeof e != "number" || !Number.isFinite(e) || e <= 0 ? 1 : Math.min(Math.max(e, ye), xe);
}
function be(e, t, n) {
  const i = Math.round(n.largeur) || 0, r = Math.round(n.hauteur) || 0, a = !(i > 0 && r > 0) || e >= i * U && t >= r * U;
  return {
    largeurPx: Math.round(e),
    hauteurPx: Math.round(t),
    largeurDallePx: i,
    hauteurDallePx: r,
    densite: n.densite > 0 ? n.densite : 1,
    pleinEcran: a
  };
}
function we(e, t) {
  return e ? e.largeurPx !== t.largeurPx || e.hauteurPx !== t.hauteurPx || e.largeurDallePx !== t.largeurDallePx || e.hauteurDallePx !== t.hauteurDallePx || e.densite !== t.densite || e.pleinEcran !== t.pleinEcran : !0;
}
const ke = 1.7, Ce = 780;
function W(e) {
  const [t, n] = e.split(":").map(Number);
  return (t ?? 0) * 60 + (n ?? 0);
}
function q(e, t) {
  const n = new Intl.DateTimeFormat("fr-FR", {
    timeZone: t,
    hour: "2-digit",
    minute: "2-digit",
    hour12: !1
  }), [i, r] = n.format(new Date(e)).split(":").map(Number);
  return (i ?? 0) * 60 + (r ?? 0);
}
function Ie(e, t, n = Ce) {
  if (e.length === 0) return [];
  const i = e.filter((l) => W(l.time) < n), r = e.filter((l) => W(l.time) >= n), o = t < n ? i : r;
  if (o.length > 0) return o;
  const a = t < n ? r : i;
  return a.length > 0 ? a : [...e];
}
function Se(e, t, n) {
  if (t <= 0) return n;
  const i = e * 0.9 / t / 2.5, r = n * ke;
  return Math.round(Math.min(Math.max(i, r), n * 4));
}
function Ee(e, t) {
  const n = Math.ceil(e - t);
  return n < 8 ? null : {
    coursePx: n,
    dureeMs: Math.round(n / 28 * 2 * 1e3) + 6e3
  };
}
const Me = 120, Pe = 60;
function D(e) {
  const [t, n] = e.split(":").map(Number);
  return (t ?? 0) * 60 + (n ?? 0);
}
function ze(e, t, n = Me) {
  const i = [...e].sort((u, c) => D(u.time) - D(c.time)), r = [], o = [];
  let a = null;
  for (const u of i) {
    const c = D(u.time), d = u.endTime ? D(u.endTime) : c + Pe;
    c <= t && t < d ? r.push(u) : t < c && c <= t + n ? o.push(u) : c > t + n && a === null && (a = u);
  }
  const l = r.length === 0 && o.length === 0 && a === null;
  return { enCours: r, aSuivre: o, prochain: a, journeeTerminee: l };
}
function Ae(e) {
  return e.trim().replace(/^CCI\s+/i, "").replace(/^SALLE\s+/i, "").trim() || e.trim();
}
function Fe(e) {
  const t = /\bb[aâ]t(?:iment)?\.?\s+([A-Z0-9]+)\s*$/i.exec(e.trim());
  return t ? `Bâtiment ${t[1].toUpperCase()}` : e.trim();
}
function N(e) {
  const [t, n] = e.split(":").map(Number);
  return t === void 0 || Number.isNaN(t) ? e : n ? `${t} h ${String(n).padStart(2, "0")}` : `${t} h`;
}
const Le = `
:host, .couloir-root {
  /* Fond clair, encre sombre.
     L'ancien fond quasi noir, avec son vert vif et ses majuscules espacees,
     faisait tableau de bord technique ; les personnes qui passent devant le
     trouvaient sombre et peu lisible. L'accent reprend le bleu de
     l'etablissement, dans sa variante foncee quand il porte du texte : la
     variante vive n'atteint pas le contraste requis sur fond clair. */
  --ink: #14202A;
  --ink-soft: #4B5E6C;
  --ink-faint: #7D8F9B;
  --ground: #F4F7F8;
  --surface: #FFFFFF;
  --accent: #0A7B92;
  --accent-vif: #11A6C4;
  --signal: #C3215D;
  --rule: rgba(20, 32, 42, 0.12);
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
/* Les affiches gardent un fond sombre : une photo y rend mieux, et les bandes
   de part et d'autre d'une image qui ne remplit pas la dalle se fondent dans
   le noir au lieu de l'encadrer de blanc. */
.couloir-slide--media { padding: 0; background: #0E1211 }

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
.couloir-slide:has(> .couloir-liste-vue),
.couloir-slide:has(> .couloir-eyebrow + .couloir-liste-vue) { justify-content: flex-start; }

/* La fenetre dans laquelle la journee defile.
   La hauteur minimale nulle n'est pas decorative : sans elle, un enfant de
   conteneur flex refuse de retrecir sous la hauteur de son contenu, le
   debordement n'est donc jamais coupe, et la liste ressort par-dessus le
   sur-titre en defilant.
   (Pas d'accent grave dans ce fichier : il terminerait le litteral.) */
.couloir-liste-vue { flex: 1; min-height: 0; overflow: hidden; }

/* La taille du texte se pose ICI, sur la liste, et nulle part ailleurs.
   Le rendu la recalcule d'apres la place disponible et l'ecrit en style en
   ligne ; les lignes en heritent. Chaque ligne la redeclarait auparavant a
   partir de --fs-body, ce qui annulait le calcul juste apres l'avoir fait :
   le texte restait a sa taille de base sur une dalle aux deux tiers vide, et
   rien dans le code ne montrait le conflit. */
.couloir-list {
  display: flex; flex-direction: column; gap: .5em; margin: 0; padding: 0;
  list-style: none;
  font-size: var(--fs-body);
}
.couloir-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: .8em;
  /* start et non baseline : chaque colonne porte maintenant deux lignes, et
     un alignement sur la première ligne de texte décalerait les blocs.
     (Pas d'accent grave dans ce fichier : il est écrit dans un littéral de
     gabarit, et un seul y terminerait la chaîne.) */
  align-items: start;
  /* Herite de la liste : voir le commentaire ci-dessus. */
  font-size: inherit;
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

/* --- maintenant et ensuite --- */
/* Ce qu'un ecran de couloir montre par defaut : les cours en cours et ceux
   des deux prochaines heures. Toutes les tailles internes sont en em, et le
   rendu fixe celle du corps a la plus grande qui laisse tout tenir. */
.couloir-slide--maintenant {
  justify-content: flex-start;
  padding: calc(var(--pad) * 0.75) var(--pad);
}
.mx {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  container-type: inline-size;
}
.mx-tete {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1em;
  font-size: calc(var(--fs-body) * 1.9);
  padding-bottom: .4em;
  margin-bottom: .45em;
  border-bottom: 2px solid var(--rule);
}
.mx-lieu { margin: 0; font-weight: 700; letter-spacing: -.01em; color: var(--ink) }
.mx-horloge { margin: 0; display: flex; align-items: baseline; gap: .55em; color: var(--ink-soft) }
.mx-heure { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums }
.mx-date { font-size: .7em }
.mx-corps {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: .3em;
}
.mx-titre {
  display: flex;
  align-items: center;
  gap: .5em;
  margin: .15em 0 .1em;
  font-size: .5em;
  font-weight: 600;
  color: var(--ink-soft);
}
.mx-bloc--en-cours .mx-titre::before {
  content: "";
  width: .65em;
  height: .65em;
  border-radius: 50%;
  background: var(--accent-vif);
}
.mx-liste { list-style: none; margin: 0; padding: 0 }
/* La pagination masque des lignes et des sections par l'attribut hidden. Sans
   cette regle, le display: grid des lignes l'emporte sur celui du navigateur,
   et rien ne disparait : l'indicateur tournait sur des pages identiques. */
.mx [hidden] { display: none !important }
.mx-ligne {
  display: grid;
  grid-template-columns: 4.4em 1fr auto;
  align-items: center;
  gap: .7em;
  padding: .26em .45em;
  border-bottom: 1px solid var(--rule);
}
/* En cours : la ligne se detache sur une carte blanche marquee d'un filet
   bleu, pour qu'on la repere avant meme de la lire. */
.mx-ligne--en-cours {
  background: var(--surface);
  box-shadow: inset .13em 0 0 var(--accent-vif);
  border-radius: .1em;
}
.mx-horaire {
  font-size: .55em;
  line-height: 1.2;
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums;
}
.mx-groupe { display: flex; flex-direction: column; min-width: 0 }
.mx-groupe-nom {
  font-weight: 600;
  line-height: 1.15;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.mx-detail { font-size: .55em; color: var(--ink-soft); margin-top: .15em }
.mx-note {
  align-self: flex-start;
  margin-top: .25em;
  padding: .05em .45em;
  font-size: .45em;
  font-weight: 700;
  color: var(--signal);
  border: 1px solid currentColor;
  border-radius: .35em;
}
.mx-salle {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
  min-width: 2.4em;
}
/* La salle est ce qu'on cherche : c'est le plus grand texte de la ligne. */
.mx-salle-nom {
  font-size: 1.3em;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -.01em;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.mx-prof { font-size: .5em; color: var(--ink-soft); margin-top: .25em }
.mx-ligne--annulee .mx-groupe-nom { color: var(--ink-soft); text-decoration: line-through }
.mx-ligne--annulee .mx-salle-nom { font-size: .75em; color: var(--signal) }
.mx-ligne--changee .mx-salle-nom { color: var(--signal) }
.mx-vide {
  margin: auto 0;
  max-width: 24ch;
  font-size: calc(var(--fs-body) * 2);
  font-weight: 600;
  line-height: 1.25;
  color: var(--ink-soft);
}
.mx-pages {
  min-height: 1.2em;
  margin: .3em 0 0;
  text-align: right;
  font-size: var(--fs-caption);
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}
/* Dans une colonne etroite, a cote d'une affiche, l'horaire passe sous le
   groupe et l'en-tete s'empile : la salle garde sa place a droite. */
@container (max-width: 900px) {
  .mx-tete { flex-direction: column; gap: .1em; font-size: calc(var(--fs-body) * 1.3) }
  .mx-ligne { grid-template-columns: 1fr auto; row-gap: .1em }
  .mx-horaire { grid-column: 1 / -1 }
  /* Trois lignes : sur deux, des groupes qui ne different que par leur fin
     devenaient indiscernables. */
  .mx-groupe-nom { -webkit-line-clamp: 3 }
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

.couloir-full--identify { background: var(--accent); color: #FFFFFF }
.couloir-full--identify .couloir-body { color: #FFFFFF; opacity: .85 }
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
`, Z = Symbol.for("couloir.ajusteur");
function De(e, t = {}) {
  const n = e.ownerDocument, i = n.createElement("style");
  i.textContent = Le, e.appendChild(i);
  const r = n.createElement("div");
  r.className = "couloir-root", e.appendChild(r);
  let o = () => {
  };
  const a = /* @__PURE__ */ new Map();
  let l = "", u = 1, c = null;
  const d = () => {
    const s = r.clientHeight || 1080, b = fe(s, u);
    r.style.setProperty("--fs-eyebrow", `${b.eyebrow}px`), r.style.setProperty("--fs-title", `${b.title}px`), r.style.setProperty("--fs-body", `${b.body}px`), r.style.setProperty("--fs-caption", `${b.caption}px`), r.style.setProperty("--pad", `${Math.round(s * 0.045)}px`);
    for (const g of r.querySelectorAll(".couloir-list"))
      g[Z]?.();
    const C = n.defaultView;
    if (t.onResolution && C) {
      const g = be(r.clientWidth, s, {
        largeur: C.screen?.width ?? 0,
        hauteur: C.screen?.height ?? 0,
        densite: C.devicePixelRatio ?? 1
      });
      we(c, g) && (c = g, t.onResolution(g));
    }
  }, y = new ResizeObserver(d);
  y.observe(r), d();
  function I(s) {
    const b = `${s.mode}:${s.emergency?.id ?? ""}:${s.identify?.screenCode ?? ""}`;
    if (s.mode === "normal" || s.mode === "fallback") return !1;
    if (b === l) return !0;
    l = b, r.replaceChildren(), a.clear();
    const C = n.createElement("div");
    return s.mode === "emergency" && s.emergency ? (C.className = "couloir-full couloir-full--emergency", C.append(
      m(n, "p", "couloir-eyebrow", "Message important"),
      m(n, "h1", "couloir-title", s.emergency.title)
    ), s.emergency.body && C.append(m(n, "p", "couloir-body", s.emergency.body))) : s.mode === "identify" && s.identify ? (C.className = "couloir-full couloir-full--identify", C.append(
      m(n, "div", "couloir-code", s.identify.screenCode),
      m(n, "p", "couloir-body", s.identify.label),
      m(n, "p", "couloir-body", s.identify.ipAddress)
    )) : C.className = "couloir-full couloir-full--off", r.appendChild(C), !0;
  }
  function S(s) {
    l !== "" && (r.replaceChildren(), a.clear(), l = "");
    const b = /* @__PURE__ */ new Set();
    for (const g of s.zones) {
      b.add(g.zoneId);
      let f = r.querySelector(`[data-zone="${g.zoneId}"]`);
      f || (f = n.createElement("section"), f.className = "couloir-zone", f.dataset.zone = g.zoneId, r.appendChild(f)), f.style.left = `${g.rect.xPercent}%`, f.style.top = `${g.rect.yPercent}%`, f.style.width = `${g.rect.widthPercent}%`, f.style.height = `${g.rect.heightPercent}%`;
      const x = g.slide ? Ne(g.slide) : null;
      if (a.get(g.zoneId) !== x) {
        if (f.replaceChildren(), x === null) {
          a.delete(g.zoneId);
          continue;
        }
        a.set(g.zoneId, x), f.appendChild(qe(n, g, g.slide, t, o));
      }
    }
    for (const g of [...r.querySelectorAll("[data-zone]")]) {
      const f = g.dataset.zone;
      f && !b.has(f) && (g.remove(), a.delete(f));
    }
    let C = r.querySelector(".couloir-watermark");
    s.watermark ? (C || (C = m(n, "div", "couloir-watermark", s.watermark), r.appendChild(C)), C.textContent = s.watermark) : C?.remove();
  }
  let p = null;
  return {
    update(s) {
      const b = ve(s.zoom);
      b !== u && (u = b, d()), s.accent !== p && (p = s.accent, s.accent ? r.style.setProperty("--accent", s.accent) : r.style.removeProperty("--accent")), !I(s) && S(s);
    },
    onMediaEnded(s) {
      o = s;
    },
    destroy() {
      y.disconnect(), r.remove(), i.remove();
    }
  };
}
function Ne(e) {
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
function m(e, t, n, i) {
  const r = e.createElement(t);
  return r.className = n, i !== void 0 && (r.textContent = i), r;
}
function qe(e, t, n, i, r) {
  const o = e.createElement("div");
  switch (o.className = "couloir-slide", o.dataset.slide = n.slideId, n.kind) {
    case "media": {
      o.classList.add("couloir-slide--media"), n.fit === "remplir" && o.classList.add("couloir-slide--remplir");
      const a = i.assetUrl?.(n.asset.id) ?? n.asset.url;
      if (n.asset.mime.startsWith("video/")) {
        const l = e.createElement("video");
        l.className = "couloir-media", l.src = a, l.muted = !0, l.autoplay = !0, l.playsInline = !0, l.addEventListener("ended", () => r(t.zoneId)), l.addEventListener("error", () => r(t.zoneId)), o.appendChild(l);
      } else {
        const l = e.createElement("img");
        l.className = "couloir-media", l.src = a, l.alt = "", o.appendChild(l);
      }
      return o;
    }
    case "template": {
      const a = (d) => {
        const y = n.fields[d];
        return typeof y == "string" ? y : void 0;
      }, l = a("eyebrow"), u = a("titre") ?? a("title"), c = a("texte") ?? a("body");
      return l && o.appendChild(m(e, "p", "couloir-eyebrow", l)), u && o.appendChild(m(e, "h1", "couloir-title", u)), c && o.appendChild(m(e, "p", "couloir-body", c)), o;
    }
    case "widget": {
      if (n.widget === "ticker") {
        o.classList.add("couloir-slide--ticker");
        const a = typeof n.config.text == "string" ? n.config.text : "", l = m(e, "div", "couloir-ticker-viewport");
        l.appendChild(m(e, "span", "couloir-ticker-text", a)), o.appendChild(l);
        const u = m(e, "div", "couloir-clock", ""), c = () => {
          u.textContent = new Intl.DateTimeFormat(i.locale ?? "fr-FR", {
            timeZone: i.timezone ?? "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit"
          }).format(/* @__PURE__ */ new Date());
        };
        c();
        const d = setInterval(c, 1e4);
        return new MutationObserver((y, I) => {
          u.isConnected || (clearInterval(d), I.disconnect());
        }).observe(o.ownerDocument.body, { childList: !0, subtree: !0 }), o.appendChild(u), o;
      }
      return o.appendChild(m(e, "p", "couloir-eyebrow", n.widget)), o;
    }
    case "data":
      return je(e, o, n, i.timezone ?? "Europe/Paris"), n.staleLabel && o.appendChild(m(e, "p", "couloir-stale", n.staleLabel)), o;
  }
}
const Te = ["heureFin", "module", "salle", "enseignant"];
function B(e) {
  return e === void 0 ? new Set(Te) : new Set(
    e.split(",").map((t) => t.trim()).filter(Boolean)
  );
}
function Oe(e, t) {
  const n = e?.days;
  if (Array.isArray(n))
    return t ? n.find((r) => r.classId === t) ?? null : n[0] ?? null;
  const i = e;
  return i && Array.isArray(i.entries) ? i : null;
}
function $e(e, t, n) {
  const i = n.payload, r = Array.isArray(i) ? i : i?.articles ?? [];
  if (r.length === 0) return;
  const o = Number(n.params.index ?? 0), a = r[(o % r.length + r.length) % r.length];
  if (a?.titre) {
    if (a.image) {
      const l = e.createElement("img");
      l.className = "couloir-illustration", l.src = a.image, l.alt = "", l.addEventListener("error", () => l.remove()), t.appendChild(l);
    }
    a.categorie && t.appendChild(m(e, "p", "couloir-eyebrow", a.categorie)), t.appendChild(m(e, "h1", "couloir-title", a.titre)), a.extrait && t.appendChild(m(e, "p", "couloir-body", a.extrait));
  }
}
function Re(e, t, n, i) {
  if (i <= 0) return;
  const r = e.defaultView, o = () => {
    if (!t.isConnected) return;
    const a = t.clientHeight;
    if (a <= 0) return;
    const l = Number.parseFloat(
      r?.getComputedStyle(t).getPropertyValue("--fs-body") ?? ""
    ) || 24, u = `${Se(a, i, l)}px`;
    n.style.fontSize !== u && (n.style.fontSize = u);
    const c = Ee(n.scrollHeight, a);
    if (n.classList.toggle("couloir-defile", c !== null), c) {
      const d = `-${c.coursePx}px`, y = `${c.dureeMs}ms`;
      n.style.getPropertyValue("--defile-course") !== d && (n.style.setProperty("--defile-course", d), n.style.setProperty("--defile-duree", y));
    }
  };
  n[Z] = o, r?.requestAnimationFrame ? r.requestAnimationFrame(() => r.requestAnimationFrame(o)) : o(), e.fonts?.ready?.then(o).catch(() => {
  });
}
function _e(e, t, n, i, r) {
  const o = i === void 0 ? /* @__PURE__ */ new Set() : B(i);
  t.classList.add("couloir-slide--maintenant");
  const a = m(e, "div", "mx");
  t.appendChild(a);
  const l = e.defaultView;
  let u = -1, c = [], d = 0, y = 0, I = !1, S = 0;
  const p = (h, w) => {
    const v = m(e, "li", "mx-ligne");
    w && v.classList.add("mx-ligne--en-cours"), h.change === "cancelled" ? v.classList.add("mx-ligne--annulee") : h.change && h.change !== "none" && v.classList.add("mx-ligne--changee");
    const z = w ? h.endTime ? `jusqu'à ${N(h.endTime)}` : "en cours" : N(h.time);
    v.appendChild(m(e, "span", "mx-horaire", z));
    const M = m(e, "span", "mx-groupe");
    M.appendChild(m(e, "span", "mx-groupe-nom", h.subject)), h.note && M.appendChild(m(e, "span", "mx-note", h.note)), o.has("module") && h.detail && M.appendChild(m(e, "span", "mx-detail", h.detail)), v.appendChild(M);
    const k = m(e, "span", "mx-salle");
    return h.change === "cancelled" ? k.appendChild(m(e, "span", "mx-salle-nom", "Annulé")) : (k.appendChild(m(e, "span", "mx-salle-nom", Ae(h.room))), o.has("enseignant") && h.teacher && k.appendChild(m(e, "span", "mx-prof", h.teacher))), v.appendChild(k), v;
  }, s = (h, w, v) => {
    const z = m(e, "section", v ? "mx-bloc mx-bloc--en-cours" : "mx-bloc");
    z.appendChild(m(e, "h2", "mx-titre", h));
    const M = m(e, "ul", "mx-liste");
    for (const k of w) M.appendChild(p(k, v));
    return z.appendChild(M), z;
  }, b = () => {
    c.forEach((w, v) => {
      for (const z of w) z.hidden = v !== d;
    });
    for (const w of a.querySelectorAll(".mx-bloc"))
      w.hidden = ![...w.querySelectorAll(".mx-ligne")].some(
        (v) => !v.hidden
      );
    const h = a.querySelector(".mx-pages");
    h && (h.textContent = c.length > 1 ? `${d + 1} / ${c.length}` : "");
  }, C = (h) => {
    const w = l?.getComputedStyle(a).getPropertyValue("--fs-body") ?? "", v = Number.parseFloat(w) || 21, z = v * 3.2, M = v * 1.8;
    let k = z;
    for (h.style.fontSize = `${k}px`; h.scrollHeight > h.clientHeight + 1 && k > M; )
      k = Math.max(M, k * 0.92), h.style.fontSize = `${Math.round(k)}px`;
    const A = [...h.querySelectorAll(".mx-ligne")];
    if (c = [A], h.scrollHeight > h.clientHeight + 1 && A.length > 1) {
      const J = Math.max(...A.map((L) => L.offsetHeight)), X = h.querySelector(".mx-titre")?.offsetHeight ?? 0, $ = Math.max(1, Math.floor((h.clientHeight - 2 * X) / J));
      c = [];
      for (let L = 0; L < A.length; L += $) c.push(A.slice(L, L + $));
    }
    d = Math.min(d, c.length - 1), b();
  }, g = () => {
    const h = Date.now(), w = q(h, r);
    u = w, a.replaceChildren();
    const v = m(e, "header", "mx-tete");
    v.appendChild(m(e, "p", "mx-lieu", Fe(n.classLabel)));
    const z = m(e, "p", "mx-horloge");
    z.appendChild(
      m(e, "span", "mx-heure", N(`${Math.floor(w / 60)}:${w % 60}`))
    ), z.appendChild(
      m(
        e,
        "span",
        "mx-date",
        new Intl.DateTimeFormat("fr-FR", {
          timeZone: r,
          weekday: "long",
          day: "numeric",
          month: "long"
        }).format(new Date(h))
      )
    ), v.appendChild(z), a.appendChild(v);
    const M = m(e, "div", "mx-corps");
    if (a.appendChild(M), a.appendChild(m(e, "p", "mx-pages")), n.notice) {
      M.appendChild(m(e, "p", "mx-vide", n.notice));
      return;
    }
    const k = ze(n.entries, w);
    if (k.enCours.length > 0 && M.appendChild(s("En ce moment", k.enCours, !0)), k.aSuivre.length > 0 && M.appendChild(s("À suivre", k.aSuivre, !1)), k.enCours.length === 0 && k.aSuivre.length === 0) {
      const A = k.journeeTerminee || !k.prochain ? "Les cours sont terminés pour aujourd'hui." : `Pas de cours dans les deux prochaines heures. Reprise à ${N(k.prochain.time)}.`;
      M.appendChild(m(e, "p", "mx-vide", A));
      return;
    }
    C(M);
  }, f = 2e3, x = 1e4, E = () => {
    if (!a.isConnected) {
      (I || ++S > 5) && clearInterval(P);
      return;
    }
    if (I = !0, q(Date.now(), r) !== u) {
      g(), y = 0;
      return;
    }
    c.length > 1 && (y += f, y >= x && (y = 0, d = (d + 1) % c.length, b()));
  }, P = setInterval(E, f);
  setTimeout(E, 0), e.fonts?.ready?.then(() => {
    a.isConnected && g();
  }).catch(() => {
  });
}
function je(e, t, n, i) {
  if (n.view.startsWith("timetable")) {
    const r = Oe(n.payload, n.params.classId);
    if (!r) return;
    if ((n.params.affichage ?? (n.params.demiJournee === "1" ? "demi-journee" : "maintenant")) === "maintenant") {
      _e(e, t, r, n.params.champs, i);
      return;
    }
    const a = B(n.params.champs);
    if (t.appendChild(m(e, "p", "couloir-eyebrow", r.classLabel)), r.notice) {
      t.appendChild(m(e, "p", "couloir-body", r.notice));
      return;
    }
    const l = n.params.demiJournee === "1" ? Ie(r.entries, q(Date.now(), i)) : r.entries, u = e.createElement("ul");
    u.className = "couloir-list";
    for (const d of l) {
      const y = d.change && d.change !== "none", I = e.createElement("li");
      I.className = y ? "couloir-row couloir-row--changed" : "couloir-row", d.change === "cancelled" && I.classList.add("couloir-row--cancelled");
      const S = e.createElement("time");
      S.appendChild(e.createTextNode(d.time)), a.has("heureFin") && d.endTime && d.endTime !== d.time && S.appendChild(m(e, "span", "couloir-fin", d.endTime));
      const p = e.createElement("span");
      p.appendChild(e.createTextNode(d.subject)), d.note && p.appendChild(m(e, "span", "couloir-badge", d.note)), a.has("module") && d.detail && p.appendChild(m(e, "span", "couloir-detail", d.detail));
      const s = e.createElement("span");
      s.className = "room", d.change === "cancelled" ? s.appendChild(e.createTextNode("—")) : (a.has("salle") && s.appendChild(e.createTextNode(d.room)), a.has("enseignant") && d.teacher && s.appendChild(m(e, "span", "couloir-prof", d.teacher))), I.append(S, p, s), u.appendChild(I);
    }
    const c = e.createElement("div");
    c.className = "couloir-liste-vue", c.appendChild(u), t.appendChild(c), Re(e, c, u, l.length);
    return;
  }
  n.view.startsWith("news") && $e(e, t, n);
}
function Ue(e, t, n) {
  return !e || !t || e === t ? !1 : n !== t;
}
const V = "couloir-rechargement";
function We() {
  try {
    return globalThis.sessionStorage?.getItem(V) ?? null;
  } catch {
    return null;
  }
}
function He(e) {
  try {
    globalThis.sessionStorage?.setItem(V, e);
  } catch {
  }
}
function Ve(e, t) {
  const n = De(e, t), i = t.pollMs ?? 2e3, r = t.tickMs ?? 500;
  let o = null, a = /* @__PURE__ */ new Map(), l = /* @__PURE__ */ new Set(), u = !1;
  n.onMediaEnded((p) => {
    l.add(p), y();
  });
  function c(p) {
    if (typeof document > "u") return;
    const s = p.screenCode ? p.screenCode : p.pairing ? `À rattacher · ${p.pairing.code}` : "Couloir";
    document.title !== s && (document.title = s);
  }
  async function d() {
    if (!u)
      try {
        const p = await fetch(t.stateUrl, { cache: "no-store" });
        if (p.ok) {
          const s = await p.json();
          if (Ue(t.rendu, s.rendu, We())) {
            He(s.rendu), globalThis.location?.reload();
            return;
          }
          s.manifest?.version !== o?.manifest?.version && (a = /* @__PURE__ */ new Map()), o = s, c(s);
        }
      } catch {
      }
  }
  function y() {
    if (u) return;
    if (!o?.manifest) {
      n.update(Ze(o));
      return;
    }
    const p = pe({
      manifest: o.manifest,
      nowMs: Date.now(),
      sources: new Map(Object.entries(o.sources)),
      availableAssetIds: new Set(o.availableAssetIds),
      rotations: a,
      forceFallback: o.forceFallback,
      identify: o.identify,
      mediaEndedZoneIds: l,
      ...o.screenCode !== null ? { screenCode: o.screenCode } : {}
    });
    l = /* @__PURE__ */ new Set(), a = p.rotations, n.update(p.screen), p.transitions.length > 0 && t.transitionsUrl && Be(t.transitionsUrl, p.transitions);
  }
  const I = setInterval(() => void d(), i), S = setInterval(y, r);
  return d().then(y), {
    stop() {
      u = !0, clearInterval(I), clearInterval(S), n.destroy();
    }
  };
}
function Ze(e) {
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
async function Be(e, t) {
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
  ae as GLANCE_TIME_MS,
  oe as MAX_SENSIBLE_DURATION_MS,
  le as MIN_BODY_TEXT_HEIGHT_PERCENT,
  ie as READING_WORDS_PER_MINUTE,
  Le as RENDERER_CSS,
  te as activePlaylistId,
  _ as advanceRotation,
  ge as collapseEmptyZones,
  se as countWords,
  G as dateLocale,
  pe as direct,
  Ue as doitRecharger,
  de as effectiveDuration,
  re as isDisplayOffPeriod,
  H as isDisplayable,
  ee as isScheduleActive,
  ne as isVisible,
  O as isWithinDailyWindow,
  T as localMoment,
  ce as minReadableDurationMs,
  De as mountRenderer,
  F as parseClock,
  K as resolveSource,
  ue as slideText,
  Q as stalenessLabel,
  Ve as startPlayer,
  fe as typeScale
};
