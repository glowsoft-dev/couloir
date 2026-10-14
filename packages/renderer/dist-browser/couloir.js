const K = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};
function Q(e, t) {
  const n = new Intl.DateTimeFormat("en-CA", {
    timeZone: t,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(e)), i = (r) => n.find((a) => a.type === r)?.value ?? "";
  return `${i("year")}-${i("month")}-${i("day")}`;
}
function R(e, t) {
  const n = new Intl.DateTimeFormat("en-US", {
    timeZone: t,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: !1
  }).formatToParts(new Date(e)), i = (l) => n.find((o) => o.type === l)?.value ?? "", r = Number(i("hour")) % 24, a = Number(i("minute"));
  return {
    dayOfWeek: K[i("weekday")] ?? 1,
    minutesOfDay: r * 60 + a
  };
}
function q(e) {
  const [t, n] = e.split(":");
  return Number(t) * 60 + Number(n);
}
function j(e, t, n) {
  const i = q(t), r = q(n);
  return i === r ? !0 : i < r ? e >= i && e < r : e >= i || e < r;
}
function ee(e, t, n) {
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
function J(e) {
  return e.status === "usable" || e.status === "stale-shown";
}
function te(e, t = "fr-FR", n = "Europe/Paris") {
  return e.status !== "stale-shown" ? null : `Mis à jour ${new Intl.DateTimeFormat(t, {
    timeZone: n,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(e.fetchedAtMs))}`;
}
function ne(e, t, n) {
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const i = R(t, n);
  return !(e.daysOfWeek && e.daysOfWeek.length > 0 && !e.daysOfWeek.includes(i.dayOfWeek) || e.dailyStart && e.dailyEnd && !j(i.minutesOfDay, e.dailyStart, e.dailyEnd));
}
function re(e, t, n) {
  const i = e.layout.zones.find((o) => o.id === t);
  if (!i) return null;
  const r = e.settings.timezone, a = e.schedules.filter((o) => o.zoneId === t).filter((o) => ne(o, n, r));
  if (a.length === 0) return i.playlistId;
  let l = a[0];
  for (const o of a.slice(1))
    o.priority >= l.priority && (l = o);
  return l.playlistId;
}
function ie(e, t, n) {
  if (!e) return !0;
  if (e.startsAt && t < Date.parse(e.startsAt) || e.endsAt && t >= Date.parse(e.endsAt)) return !1;
  const i = R(t, n);
  if (e.dailyStart && e.dailyEnd && !j(i.minutesOfDay, e.dailyStart, e.dailyEnd))
    return !1;
  if (e.daysOfWeek && e.daysOfWeek.length > 0) {
    const r = (i.dayOfWeek + 5) % 7 + 1, a = !!(e.dailyStart && e.dailyEnd) && q(e.dailyStart) > q(e.dailyEnd) && i.minutesOfDay < q(e.dailyEnd);
    if (!e.daysOfWeek.includes(a ? r : i.dayOfWeek)) return !1;
  }
  return !0;
}
function ae(e, t) {
  const n = R(t, e.timezone), i = (n.dayOfWeek + 5) % 7 + 1;
  return e.displayOff.some((r) => {
    if (!j(n.minutesOfDay, r.from, r.to)) return !1;
    if (r.daysOfWeek.length === 0) return !0;
    const a = q(r.from), l = q(r.to), o = a > l && n.minutesOfDay < l;
    return r.daysOfWeek.includes(o ? i : n.dayOfWeek);
  });
}
const oe = 130, le = 2500, se = 6e4, ce = 1.9;
function ue(e) {
  const t = e.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}
function de(e) {
  const t = ue(e);
  return Math.round(le + t / oe * 6e4);
}
function me(e) {
  return e.kind !== "template" ? "" : Object.values(e.fields).filter((t) => typeof t == "string").join(" ");
}
function fe(e) {
  const t = "durationMs" in e && e.durationMs ? e.durationMs : 0, n = de(me(e)), i = Math.min(Math.max(t, n), se);
  return { effectiveMs: i, requestedMs: t, extended: i > t };
}
function pe(e, t = 1) {
  const n = Math.round(
    e * ce * t / 100
  );
  return {
    eyebrow: Math.round(n * 0.72),
    title: Math.round(n * 2.4),
    body: n,
    caption: Math.round(n * 0.8)
  };
}
function _(e, t, n) {
  for (let i = 1; i <= e.length; i++) {
    const r = (t + i) % e.length, a = e[r];
    if (a !== void 0 && n(a)) return r;
  }
  return null;
}
function he(e, t) {
  for (let n = 0; n < e.length; n++) {
    const i = e[n];
    if (i !== void 0 && t(i)) return n;
  }
  return null;
}
function U(e) {
  const { state: t, playlistId: n, slideIds: i, isEligible: r, durationMsOf: a, nowMs: l } = e, o = t && t.playlistId === n ? i[t.index] ?? null : null, u = (p) => {
    if (p === null)
      return { state: null, currentSlideId: null, changed: o !== null };
    const s = i[p];
    return {
      state: { playlistId: n, index: p, slideStartedAtMs: l },
      currentSlideId: s,
      changed: s !== o
    };
  };
  if (!t || t.playlistId !== n || t.index >= i.length)
    return u(he(i, r));
  const c = i[t.index];
  if (c === void 0 || !r(c))
    return u(_(i, t.index, r));
  const d = a(c), x = l - t.slideStartedAtMs;
  if (!(d === null ? e.mediaEnded === !0 : x >= d))
    return { state: t, currentSlideId: c, changed: !1 };
  const b = _(i, t.index, r);
  return u(b === null ? null : b);
}
function ge(e) {
  const { manifest: t, nowMs: n } = e, i = new Map(t.slides.map((m) => [m.id, m])), r = new Map(t.assets.map((m) => [m.id, m])), a = new Map(t.playlists.map((m) => [m.id, m])), l = new Map(
    t.dataSources.map((m) => [
      m.id,
      ee(m, e.sources.get(m.id), n)
    ])
  ), o = t.settings.showScreenCodeWatermark ? e.screenCode ?? null : null, u = t.settings.branding?.accent ?? null, c = t.settings.zoom ?? null, d = t.emergency;
  if (d && n < Date.parse(d.validUntil))
    return {
      screen: { mode: "emergency", zones: [], emergency: d, identify: null, watermark: o, accent: u, zoom: c },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (e.identify)
    return {
      screen: { mode: "identify", zones: [], emergency: null, identify: e.identify, watermark: null, accent: u, zoom: c },
      rotations: new Map(e.rotations),
      transitions: []
    };
  if (ae(t.settings, n))
    return {
      screen: { mode: "display-off", zones: [], emergency: null, identify: null, watermark: null, accent: u, zoom: c },
      rotations: new Map(e.rotations),
      transitions: []
    };
  const x = (m) => {
    const y = i.get(m);
    if (!y || !ie(y.visibility, n, t.settings.timezone)) return !1;
    switch (y.kind) {
      case "media":
        return e.availableAssetIds.has(y.assetId);
      case "template":
        return y.assetIds.every((I) => e.availableAssetIds.has(I));
      case "widget":
        return !0;
      case "data": {
        const I = l.get(y.sourceId);
        if (I === void 0 || !J(I)) return !1;
        if (y.view.startsWith("timetable") && "payload" in I) {
          const z = ye(I.payload, y.params.classId);
          if (z?.date && z.date !== Q(n, t.settings.timezone)) return !1;
        }
        return !0;
      }
    }
  }, v = (m) => {
    const y = i.get(m);
    return y ? y.kind === "media" && y.durationMs === void 0 ? null : fe(y).effectiveMs : 0;
  }, b = e.forceFallback ? "fallback" : "normal", p = /* @__PURE__ */ new Map(), s = [], w = [];
  for (const m of t.layout.zones) {
    const y = e.forceFallback ? t.fallbackPlaylistId : re(t, m.id, n) ?? m.playlistId, I = a.get(y), z = e.rotations.get(m.id), D = z && z.playlistId === y ? I?.slideIds[z.index] ?? null : null, h = U({
      state: z,
      playlistId: y,
      slideIds: I?.slideIds ?? [],
      isEligible: x,
      durationMsOf: v,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(m.id) ?? !1
    });
    h.state && p.set(m.id, h.state), h.changed && s.push({
      zoneId: m.id,
      fromSlideId: D,
      toSlideId: h.currentSlideId,
      atMs: n
    });
    const P = h.currentSlideId ? i.get(h.currentSlideId) : void 0;
    if (w.push({
      zoneId: m.id,
      rect: m.rect,
      playlistId: y,
      slide: P ? W(P, r, l, t.settings.timezone) : null
    }), e.forceFallback) break;
  }
  if (!e.forceFallback && w.every((m) => m.slide === null)) {
    const m = t.defaultPlaylistId ?? t.fallbackPlaylistId, y = a.get(m), I = t.layout.zones[0]?.id ?? "principal", z = U({
      state: e.rotations.get(I),
      playlistId: m,
      slideIds: y?.slideIds ?? [],
      isEligible: x,
      durationMsOf: v,
      nowMs: n,
      mediaEnded: e.mediaEndedZoneIds?.has(I) ?? !1
    }), D = z.currentSlideId ? i.get(z.currentSlideId) : void 0;
    if (D)
      return z.state && p.set(I, z.state), {
        screen: {
          mode: "normal",
          zones: [
            {
              zoneId: I,
              rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
              playlistId: m,
              slide: W(D, r, l, t.settings.timezone)
            }
          ],
          emergency: null,
          identify: null,
          watermark: o,
          accent: u,
          zoom: c
        },
        rotations: p,
        transitions: s
      };
  }
  const g = e.forceFallback ? w.map((m) => ({ ...m, rect: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 } })) : xe(w);
  return {
    screen: {
      mode: b,
      zones: g,
      emergency: null,
      identify: null,
      watermark: o,
      accent: u,
      zoom: c
    },
    rotations: p,
    transitions: s
  };
}
function W(e, t, n, i) {
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
      return !r || !J(r) ? null : {
        kind: "data",
        slideId: e.id,
        sourceId: e.sourceId,
        view: e.view,
        payload: "payload" in r ? r.payload : null,
        params: e.params,
        staleLabel: te(r, "fr-FR", i)
      };
    }
  }
}
function ye(e, t) {
  const n = e?.days;
  return Array.isArray(n) ? t ? n.find((i) => i.classId === t) ?? null : n[0] ?? null : e ?? null;
}
function xe(e) {
  const t = /* @__PURE__ */ new Map();
  for (const u of e) {
    const c = `${u.rect.yPercent}:${u.rect.heightPercent}`, d = t.get(c);
    d ? d.push(u) : t.set(c, [u]);
  }
  const n = [];
  for (const u of t.values()) {
    const c = u.filter((p) => p.slide !== null);
    if (c.length === 0) continue;
    const d = u.reduce((p, s) => p + s.rect.widthPercent, 0), x = c.reduce((p, s) => p + s.rect.widthPercent, 0), v = x > 0 ? d / x : 1;
    let b = Math.min(...u.map((p) => p.rect.xPercent));
    n.push(
      c.map((p) => {
        const s = p.rect.widthPercent * v, w = { ...p, rect: { ...p.rect, xPercent: b, widthPercent: s } };
        return b += s, w;
      })
    );
  }
  if (n.length === 0) return [];
  const i = [...t.values()].reduce((u, c) => u + (c[0]?.rect.heightPercent ?? 0), 0), r = n.reduce((u, c) => u + (c[0]?.rect.heightPercent ?? 0), 0), a = r > 0 ? i / r : 1, l = [];
  let o = Math.min(...e.map((u) => u.rect.yPercent));
  for (const u of n.sort((c, d) => (c[0]?.rect.yPercent ?? 0) - (d[0]?.rect.yPercent ?? 0))) {
    const c = (u[0]?.rect.heightPercent ?? 0) * a;
    for (const d of u)
      l.push({ ...d, rect: { ...d.rect, yPercent: o, heightPercent: c } });
    o += c;
  }
  return l;
}
const B = 0.92, ve = 0.6, be = 2.5;
function we(e) {
  return typeof e != "number" || !Number.isFinite(e) || e <= 0 ? 1 : Math.min(Math.max(e, ve), be);
}
function Ce(e, t, n) {
  const i = Math.round(n.largeur) || 0, r = Math.round(n.hauteur) || 0, l = !(i > 0 && r > 0) || e >= i * B && t >= r * B;
  return {
    largeurPx: Math.round(e),
    hauteurPx: Math.round(t),
    largeurDallePx: i,
    hauteurDallePx: r,
    densite: n.densite > 0 ? n.densite : 1,
    pleinEcran: l
  };
}
function ke(e, t) {
  return e ? e.largeurPx !== t.largeurPx || e.hauteurPx !== t.hauteurPx || e.largeurDallePx !== t.largeurDallePx || e.hauteurDallePx !== t.hauteurDallePx || e.densite !== t.densite || e.pleinEcran !== t.pleinEcran : !0;
}
const Ie = 1.7, Se = 780;
function Z(e) {
  const [t, n] = e.split(":").map(Number);
  return (t ?? 0) * 60 + (n ?? 0);
}
function O(e, t) {
  const n = new Intl.DateTimeFormat("fr-FR", {
    timeZone: t,
    hour: "2-digit",
    minute: "2-digit",
    hour12: !1
  }), [i, r] = n.format(new Date(e)).split(":").map(Number);
  return (i ?? 0) * 60 + (r ?? 0);
}
function Ee(e, t, n = Se) {
  if (e.length === 0) return [];
  const i = e.filter((o) => Z(o.time) < n), r = e.filter((o) => Z(o.time) >= n), a = t < n ? i : r;
  if (a.length > 0) return a;
  const l = t < n ? r : i;
  return l.length > 0 ? l : [...e];
}
function Me(e, t, n) {
  if (t <= 0) return n;
  const i = e * 0.9 / t / 2.5, r = n * Ie;
  return Math.round(Math.min(Math.max(i, r), n * 4));
}
function Pe(e, t) {
  const n = Math.ceil(e - t);
  return n < 8 ? null : {
    coursePx: n,
    dureeMs: Math.round(n / 28 * 2 * 1e3) + 6e3
  };
}
const ze = 120, Fe = 60;
function T(e) {
  const [t, n] = e.split(":").map(Number);
  return (t ?? 0) * 60 + (n ?? 0);
}
function Ae(e, t, n = ze) {
  const i = [...e].sort((u, c) => T(u.time) - T(c.time)), r = [], a = [];
  let l = null;
  for (const u of i) {
    const c = T(u.time), d = u.endTime ? T(u.endTime) : c + Fe;
    c <= t && t < d ? r.push(u) : t < c && c <= t + n ? a.push(u) : c > t + n && l === null && (l = u);
  }
  const o = r.length === 0 && a.length === 0 && l === null;
  return { enCours: r, aSuivre: a, prochain: l, journeeTerminee: o };
}
function Le(e) {
  return e.trim().replace(/^CCI\s+/i, "").replace(/^SALLE\s+/i, "").trim() || e.trim();
}
function De(e) {
  const t = /\bb[aâ]t(?:iment)?\.?\s+([A-Z0-9]+)\s*$/i.exec(e.trim());
  return t ? `Bâtiment ${t[1].toUpperCase()}` : e.trim();
}
function Ne(e) {
  const t = e.trim().replace(/\s*\bb[aâ]t(?:iment)?\.?\s+[A-Z0-9]+\s*$/i, "").trim();
  return t === e.trim() ? "" : t;
}
function $(e) {
  const [t, n] = e.split(":").map(Number);
  return t === void 0 || Number.isNaN(t) ? e : n ? `${t} h ${String(n).padStart(2, "0")}` : `${t} h`;
}
const qe = `
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
/* Un tableau de hall, pas une liste d'application : pas de cartes, pas de
   coins arrondis, pas de pastilles. Des bandes separees par un filet franc,
   et la salle dans un bloc plein, comme un numero de quai. Les tailles
   derivent toutes de --mx-h, la hauteur d'une ligne, que le rendu pose a une
   fraction fixe de la dalle.

   La police est la DejaVu Sans Condensed, presente sur tous les boitiers :
   grand oeil, chiffres nets, 1 l I bien distincts, et assez etroite pour
   loger un nom de groupe a grande taille. */
.couloir-slide--maintenant {
  justify-content: flex-start;
  padding: calc(var(--pad) * 0.6) var(--pad) calc(var(--pad) * 0.45);
}
.mx {
  --mx-encre: #0B0D0E;
  --mx-doux: #4A5055;
  --mx-filet: rgba(11, 13, 14, 0.16);
  /* Le bleu du campus, assombri pour porter du blanc a 7:1. Moins lourd
     qu'un bloc noir sur un fond clair. */
  --mx-bloc: #0A5C70;
  --mx-vert: #0A7A3D;
  --mx-rouge: #C3122F;
  --mx-h: 400px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  container-type: inline-size;
  font-family: "DejaVu Sans Condensed", "DejaVu Sans", "Arial Narrow", Arial, sans-serif;
  color: var(--mx-encre);
}
.mx p { margin: 0 }
.mx [hidden] { display: none !important }
.mx-tete {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1em;
  font-size: calc(var(--fs-body) * 2.4);
  line-height: 1.1;
  padding-bottom: .3em;
  border-bottom: .12em solid var(--mx-encre);
}
.mx-lieu { display: flex; align-items: baseline; gap: .6em; min-width: 0 }
.mx-batiment { font-weight: 700; white-space: nowrap }
.mx-campus { font-size: .62em; color: var(--mx-doux); white-space: nowrap }
.mx-horloge { display: flex; align-items: baseline; gap: .5em; white-space: nowrap }
.mx-heure { font-weight: 700; font-variant-numeric: tabular-nums }
.mx-date { font-size: .62em; color: var(--mx-doux) }
.mx-corps {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.mx-liste { list-style: none; margin: 0; padding: 0 }
.mx-ligne {
  box-sizing: border-box;
  height: var(--mx-h);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: calc(var(--mx-h) * 0.09);
  padding: calc(var(--mx-h) * 0.07) 0;
  border-bottom: 3px solid var(--mx-filet);
  overflow: hidden;
}
.mx-texte { display: flex; flex-direction: column; gap: calc(var(--mx-h) * 0.035); min-width: 0 }
.mx-horaire {
  font-size: calc(var(--mx-h) * 0.115);
  line-height: 1.1;
  color: var(--mx-doux);
  font-variant-numeric: tabular-nums;
}
.mx-etat { font-weight: 700; color: var(--mx-encre) }
.mx-ligne--en-cours .mx-etat { color: var(--mx-vert) }
.mx-groupe { display: flex; flex-direction: column; min-width: 0 }
.mx-groupe-nom {
  font-size: calc(var(--mx-h) * 0.235);
  font-weight: 700;
  line-height: 1.06;
  text-wrap: balance;
  letter-spacing: -.005em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
}
/* Un nom trop long pour deux lignes passe sur trois, un peu plus petit,
   plutot que d'etre coupe : deux groupes ne different souvent que par la fin. */
.mx-ligne--longue .mx-groupe-nom { font-size: calc(var(--mx-h) * 0.175); -webkit-line-clamp: 3 }
.mx-detail, .mx-prof {
  margin-top: .3em;
  font-size: calc(var(--mx-h) * 0.1);
  color: var(--mx-doux);
}
.mx-note {
  margin-top: .3em;
  font-size: calc(var(--mx-h) * 0.1);
  font-weight: 700;
  color: var(--mx-rouge);
}
/* Le bloc de la salle. Plein quand le cours a lieu, cercle d'un trait
   epais quand il est a venir : la difference se voit avant de se lire. */
.mx-salle {
  box-sizing: border-box;
  align-self: stretch;
  min-width: calc(var(--mx-h) * 1.15);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 calc(var(--mx-h) * 0.08);
  background: var(--mx-bloc);
  color: #FFFFFF;
}
.mx-ligne--a-suivre .mx-salle {
  background: transparent;
  color: var(--mx-bloc);
  border: calc(var(--mx-h) * 0.025) solid var(--mx-bloc);
}
.mx-salle-nom {
  font-size: calc(var(--mx-h) * 0.5);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -.02em;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.mx-ligne--annulee .mx-salle { background: var(--mx-rouge); border-color: var(--mx-rouge); color: #FFFFFF }
.mx-ligne--annulee .mx-salle-nom { font-size: calc(var(--mx-h) * 0.22); letter-spacing: 0 }
.mx-ligne--annulee .mx-groupe-nom { color: var(--mx-doux); text-decoration: line-through }
.mx-ligne--changee .mx-salle { outline: calc(var(--mx-h) * 0.025) solid var(--mx-rouge); outline-offset: -1px }
.mx-vide {
  margin: auto 0;
  max-width: 20ch;
  font-size: calc(var(--fs-body) * 3.4);
  font-weight: 700;
  line-height: 1.15;
}
/* Les pages : une barre par page, la courante se remplit pendant qu'elle est
   affichee. Visible de loin, et elle dit quand vient la suite. */
.mx-pages {
  display: flex;
  gap: .6em;
  height: calc(var(--fs-body) * 0.55);
  margin-top: calc(var(--fs-body) * 0.6);
}
.mx-pages:empty { visibility: hidden }
.mx-page { flex: 1; position: relative; background: var(--mx-filet); overflow: hidden }
.mx-page--vue { background: var(--mx-bloc) }
.mx-page--courante::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--mx-bloc);
  transform-origin: left center;
  animation: mx-remplir var(--mx-bascule, 10s) linear forwards;
}
@keyframes mx-remplir { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@media (prefers-reduced-motion: reduce) {
  .mx-page--courante::after { animation: none; transform: none }
}
/* Dans une colonne etroite, a cote d'une affiche : la salle passe sous le
   groupe, alignee a gauche, et l'en-tete s'empile. */
@container (max-width: 900px) {
  .mx-tete { flex-direction: column; gap: .15em; font-size: calc(var(--fs-body) * 1.5) }
  .mx-ligne { grid-template-columns: minmax(0, 1fr); row-gap: calc(var(--mx-h) * 0.05) }
  .mx-salle { justify-self: start; align-self: start; min-width: 0; padding: .04em .3em }
  .mx-salle-nom { font-size: calc(var(--mx-h) * 0.26) }
  .mx-horaire { font-size: calc(var(--mx-h) * 0.085) }
  .mx-groupe-nom { font-size: calc(var(--mx-h) * 0.12); -webkit-line-clamp: 3 }
  .mx-ligne--longue .mx-groupe-nom { font-size: calc(var(--mx-h) * 0.1); -webkit-line-clamp: 4 }
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
`, X = Symbol.for("couloir.ajusteur");
function Te(e, t = {}) {
  const n = e.ownerDocument, i = n.createElement("style");
  i.textContent = qe, e.appendChild(i);
  const r = n.createElement("div");
  r.className = "couloir-root", e.appendChild(r);
  let a = () => {
  };
  const l = /* @__PURE__ */ new Map();
  let o = "", u = 1, c = null;
  const d = () => {
    const s = r.clientHeight || 1080, w = pe(s, u);
    r.style.setProperty("--fs-eyebrow", `${w.eyebrow}px`), r.style.setProperty("--fs-title", `${w.title}px`), r.style.setProperty("--fs-body", `${w.body}px`), r.style.setProperty("--fs-caption", `${w.caption}px`), r.style.setProperty("--pad", `${Math.round(s * 0.045)}px`);
    for (const g of r.querySelectorAll(".couloir-list"))
      g[X]?.();
    const C = n.defaultView;
    if (t.onResolution && C) {
      const g = Ce(r.clientWidth, s, {
        largeur: C.screen?.width ?? 0,
        hauteur: C.screen?.height ?? 0,
        densite: C.devicePixelRatio ?? 1
      });
      ke(c, g) && (c = g, t.onResolution(g));
    }
  }, x = new ResizeObserver(d);
  x.observe(r), d();
  function v(s) {
    const w = `${s.mode}:${s.emergency?.id ?? ""}:${s.identify?.screenCode ?? ""}`;
    if (s.mode === "normal" || s.mode === "fallback") return !1;
    if (w === o) return !0;
    o = w, r.replaceChildren(), l.clear();
    const C = n.createElement("div");
    return s.mode === "emergency" && s.emergency ? (C.className = "couloir-full couloir-full--emergency", C.append(
      f(n, "p", "couloir-eyebrow", "Message important"),
      f(n, "h1", "couloir-title", s.emergency.title)
    ), s.emergency.body && C.append(f(n, "p", "couloir-body", s.emergency.body))) : s.mode === "identify" && s.identify ? (C.className = "couloir-full couloir-full--identify", C.append(
      f(n, "div", "couloir-code", s.identify.screenCode),
      f(n, "p", "couloir-body", s.identify.label),
      f(n, "p", "couloir-body", s.identify.ipAddress)
    )) : C.className = "couloir-full couloir-full--off", r.appendChild(C), !0;
  }
  function b(s) {
    o !== "" && (r.replaceChildren(), l.clear(), o = "");
    const w = /* @__PURE__ */ new Set();
    for (const g of s.zones) {
      w.add(g.zoneId);
      let m = r.querySelector(`[data-zone="${g.zoneId}"]`);
      m || (m = n.createElement("section"), m.className = "couloir-zone", m.dataset.zone = g.zoneId, r.appendChild(m)), m.style.left = `${g.rect.xPercent}%`, m.style.top = `${g.rect.yPercent}%`, m.style.width = `${g.rect.widthPercent}%`, m.style.height = `${g.rect.heightPercent}%`;
      const y = g.slide ? $e(g.slide) : null;
      if (l.get(g.zoneId) !== y) {
        if (m.replaceChildren(), y === null) {
          l.delete(g.zoneId);
          continue;
        }
        l.set(g.zoneId, y), m.appendChild(Oe(n, g, g.slide, t, a));
      }
    }
    for (const g of [...r.querySelectorAll("[data-zone]")]) {
      const m = g.dataset.zone;
      m && !w.has(m) && (g.remove(), l.delete(m));
    }
    let C = r.querySelector(".couloir-watermark");
    s.watermark ? (C || (C = f(n, "div", "couloir-watermark", s.watermark), r.appendChild(C)), C.textContent = s.watermark) : C?.remove();
  }
  let p = null;
  return {
    update(s) {
      const w = we(s.zoom);
      w !== u && (u = w, d()), s.accent !== p && (p = s.accent, s.accent ? r.style.setProperty("--accent", s.accent) : r.style.removeProperty("--accent")), !v(s) && b(s);
    },
    onMediaEnded(s) {
      a = s;
    },
    destroy() {
      x.disconnect(), r.remove(), i.remove();
    }
  };
}
function $e(e) {
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
function f(e, t, n, i) {
  const r = e.createElement(t);
  return r.className = n, i !== void 0 && (r.textContent = i), r;
}
function Oe(e, t, n, i, r) {
  const a = e.createElement("div");
  switch (a.className = "couloir-slide", a.dataset.slide = n.slideId, n.kind) {
    case "media": {
      a.classList.add("couloir-slide--media"), n.fit === "remplir" && a.classList.add("couloir-slide--remplir");
      const l = i.assetUrl?.(n.asset.id) ?? n.asset.url;
      if (n.asset.mime.startsWith("video/")) {
        const o = e.createElement("video");
        o.className = "couloir-media", o.src = l, o.muted = !0, o.autoplay = !0, o.playsInline = !0, o.addEventListener("ended", () => r(t.zoneId)), o.addEventListener("error", () => r(t.zoneId)), a.appendChild(o);
      } else {
        const o = e.createElement("img");
        o.className = "couloir-media", o.src = l, o.alt = "", a.appendChild(o);
      }
      return a;
    }
    case "template": {
      const l = (d) => {
        const x = n.fields[d];
        return typeof x == "string" ? x : void 0;
      }, o = l("eyebrow"), u = l("titre") ?? l("title"), c = l("texte") ?? l("body");
      return o && a.appendChild(f(e, "p", "couloir-eyebrow", o)), u && a.appendChild(f(e, "h1", "couloir-title", u)), c && a.appendChild(f(e, "p", "couloir-body", c)), a;
    }
    case "widget": {
      if (n.widget === "ticker") {
        a.classList.add("couloir-slide--ticker");
        const l = typeof n.config.text == "string" ? n.config.text : "", o = f(e, "div", "couloir-ticker-viewport");
        o.appendChild(f(e, "span", "couloir-ticker-text", l)), a.appendChild(o);
        const u = f(e, "div", "couloir-clock", ""), c = () => {
          u.textContent = new Intl.DateTimeFormat(i.locale ?? "fr-FR", {
            timeZone: i.timezone ?? "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit"
          }).format(/* @__PURE__ */ new Date());
        };
        c();
        const d = setInterval(c, 1e4);
        return new MutationObserver((x, v) => {
          u.isConnected || (clearInterval(d), v.disconnect());
        }).observe(a.ownerDocument.body, { childList: !0, subtree: !0 }), a.appendChild(u), a;
      }
      return a.appendChild(f(e, "p", "couloir-eyebrow", n.widget)), a;
    }
    case "data":
      return Be(e, a, n, i.timezone ?? "Europe/Paris"), n.staleLabel && a.appendChild(f(e, "p", "couloir-stale", n.staleLabel)), a;
  }
}
const Re = ["heureFin", "module", "salle", "enseignant"];
function Y(e) {
  return e === void 0 ? new Set(Re) : new Set(
    e.split(",").map((t) => t.trim()).filter(Boolean)
  );
}
function je(e, t) {
  const n = e?.days;
  if (Array.isArray(n))
    return t ? n.find((r) => r.classId === t) ?? null : n[0] ?? null;
  const i = e;
  return i && Array.isArray(i.entries) ? i : null;
}
function _e(e, t, n) {
  const i = n.payload, r = Array.isArray(i) ? i : i?.articles ?? [];
  if (r.length === 0) return;
  const a = Number(n.params.index ?? 0), l = r[(a % r.length + r.length) % r.length];
  if (l?.titre) {
    if (l.image) {
      const o = e.createElement("img");
      o.className = "couloir-illustration", o.src = l.image, o.alt = "", o.addEventListener("error", () => o.remove()), t.appendChild(o);
    }
    l.categorie && t.appendChild(f(e, "p", "couloir-eyebrow", l.categorie)), t.appendChild(f(e, "h1", "couloir-title", l.titre)), l.extrait && t.appendChild(f(e, "p", "couloir-body", l.extrait));
  }
}
function Ue(e, t, n, i) {
  if (i <= 0) return;
  const r = e.defaultView, a = () => {
    if (!t.isConnected) return;
    const l = t.clientHeight;
    if (l <= 0) return;
    const o = Number.parseFloat(
      r?.getComputedStyle(t).getPropertyValue("--fs-body") ?? ""
    ) || 24, u = `${Me(l, i, o)}px`;
    n.style.fontSize !== u && (n.style.fontSize = u);
    const c = Pe(n.scrollHeight, l);
    if (n.classList.toggle("couloir-defile", c !== null), c) {
      const d = `-${c.coursePx}px`, x = `${c.dureeMs}ms`;
      n.style.getPropertyValue("--defile-course") !== d && (n.style.setProperty("--defile-course", d), n.style.setProperty("--defile-duree", x));
    }
  };
  n[X] = a, r?.requestAnimationFrame ? r.requestAnimationFrame(() => r.requestAnimationFrame(a)) : a(), e.fonts?.ready?.then(a).catch(() => {
  });
}
function We(e, t, n, i, r) {
  const a = i.champs, l = a === void 0 ? /* @__PURE__ */ new Set() : Y(a), o = Math.min(4, Math.max(1, Number.parseInt(i.lignes ?? "", 10) || 2)), u = i.campus?.trim() || Ne(n.classLabel);
  t.classList.add("couloir-slide--maintenant");
  const c = f(e, "div", "mx");
  c.style.setProperty("--mx-bascule", `${V}ms`), t.appendChild(c);
  const d = e.defaultView;
  let x = -1, v = [], b = 0, p = 0, s = !1, w = 0;
  const C = (h, P) => {
    const k = f(e, "li", "mx-ligne");
    k.classList.add(P ? "mx-ligne--en-cours" : "mx-ligne--a-suivre");
    const S = h.change === "cancelled";
    S ? k.classList.add("mx-ligne--annulee") : h.change && h.change !== "none" && k.classList.add("mx-ligne--changee");
    const E = f(e, "div", "mx-texte"), A = f(e, "p", "mx-horaire");
    P ? (A.appendChild(f(e, "b", "mx-etat", "En cours")), h.endTime && A.append(` jusqu’à ${$(h.endTime)}`)) : A.appendChild(f(e, "b", "mx-etat", `À ${$(h.time)}`)), E.appendChild(A);
    const M = f(e, "div", "mx-groupe");
    M.appendChild(f(e, "p", "mx-groupe-nom", h.subject)), h.note && M.appendChild(f(e, "p", "mx-note", h.note)), l.has("module") && h.detail && M.appendChild(f(e, "p", "mx-detail", h.detail)), !S && l.has("enseignant") && h.teacher && M.appendChild(f(e, "p", "mx-prof", h.teacher)), E.appendChild(M), k.appendChild(E);
    const F = f(e, "div", "mx-salle");
    return F.appendChild(
      f(e, "span", "mx-salle-nom", S ? "Annulé" : Le(h.room))
    ), k.appendChild(F), k;
  }, g = () => {
    v.forEach((P, k) => {
      for (const S of P) S.hidden = k !== b;
    });
    const h = c.querySelector(".mx-pages");
    h && (h.replaceChildren(), !(v.length < 2) && v.forEach((P, k) => {
      const S = f(e, "span", "mx-page");
      k < b && S.classList.add("mx-page--vue"), k === b && S.classList.add("mx-page--courante"), h.appendChild(S);
    }));
  }, m = (h, P) => {
    const k = Math.floor(h.clientHeight / o);
    k > 0 && h.style.setProperty("--mx-h", `${k}px`);
    const S = [...P.querySelectorAll(".mx-ligne")];
    for (const E of S) {
      const A = E.querySelector(".mx-groupe-nom");
      A && A.scrollHeight > A.clientHeight + 1 && E.classList.add("mx-ligne--longue");
      const M = E.querySelector(".mx-salle-nom"), F = E.clientWidth * 0.42;
      if (M && F > 0) {
        let L = Number.parseFloat(d?.getComputedStyle(M).fontSize ?? "") || 0;
        const N = L * 0.35;
        for (; M.offsetWidth > F && L > N; )
          L *= 0.9, M.style.fontSize = `${Math.round(L)}px`;
      }
    }
    v = [];
    for (let E = 0; E < S.length; E += o)
      v.push(S.slice(E, E + o));
    b = Math.min(b, Math.max(0, v.length - 1)), g();
  }, y = () => {
    const h = Date.now(), P = O(h, r);
    x = P, c.replaceChildren();
    const k = f(e, "header", "mx-tete"), S = f(e, "p", "mx-lieu");
    S.appendChild(f(e, "span", "mx-batiment", De(n.classLabel))), u && S.appendChild(f(e, "span", "mx-campus", u)), k.appendChild(S);
    const E = f(e, "p", "mx-horloge");
    E.appendChild(
      f(e, "span", "mx-heure", $(`${Math.floor(P / 60)}:${P % 60}`))
    );
    const A = new Intl.DateTimeFormat("fr-FR", {
      timeZone: r,
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(new Date(h));
    E.appendChild(f(e, "span", "mx-date", A)), k.appendChild(E), c.appendChild(k);
    const M = f(e, "div", "mx-corps");
    if (c.appendChild(M), c.appendChild(f(e, "div", "mx-pages")), n.notice) {
      M.appendChild(f(e, "p", "mx-vide", n.notice));
      return;
    }
    const F = Ae(n.entries, P);
    if (F.enCours.length === 0 && F.aSuivre.length === 0) {
      const N = F.journeeTerminee || !F.prochain ? "Les cours sont terminés pour aujourd'hui." : `Pas de cours dans les deux prochaines heures. Reprise à ${$(F.prochain.time)}.`;
      M.appendChild(f(e, "p", "mx-vide", N));
      return;
    }
    const L = f(e, "ul", "mx-liste");
    for (const N of F.enCours) L.appendChild(C(N, !0));
    for (const N of F.aSuivre) L.appendChild(C(N, !1));
    M.appendChild(L), m(M, L);
  }, I = () => {
    if (!c.isConnected) {
      (s || ++w > 5) && clearInterval(z);
      return;
    }
    if (s = !0, O(Date.now(), r) !== x) {
      y(), p = 0;
      return;
    }
    v.length > 1 && (p += H, p >= V && (p = 0, b = (b + 1) % v.length, g()));
  }, z = setInterval(I, H);
  setTimeout(I, 0);
  const D = () => {
    c.isConnected ? y() : e.fonts?.removeEventListener?.("loadingdone", D);
  };
  e.fonts?.ready?.then(D).catch(() => {
  }), e.fonts?.addEventListener?.("loadingdone", D);
}
const H = 2e3, V = 8e3;
function Be(e, t, n, i) {
  if (n.view.startsWith("timetable")) {
    const r = je(n.payload, n.params.classId);
    if (!r) return;
    if ((n.params.affichage ?? (n.params.demiJournee === "1" ? "demi-journee" : "maintenant")) === "maintenant") {
      We(e, t, r, n.params, i);
      return;
    }
    const l = Y(n.params.champs);
    if (t.appendChild(f(e, "p", "couloir-eyebrow", r.classLabel)), r.notice) {
      t.appendChild(f(e, "p", "couloir-body", r.notice));
      return;
    }
    const o = n.params.demiJournee === "1" ? Ee(r.entries, O(Date.now(), i)) : r.entries, u = e.createElement("ul");
    u.className = "couloir-list";
    for (const d of o) {
      const x = d.change && d.change !== "none", v = e.createElement("li");
      v.className = x ? "couloir-row couloir-row--changed" : "couloir-row", d.change === "cancelled" && v.classList.add("couloir-row--cancelled");
      const b = e.createElement("time");
      b.appendChild(e.createTextNode(d.time)), l.has("heureFin") && d.endTime && d.endTime !== d.time && b.appendChild(f(e, "span", "couloir-fin", d.endTime));
      const p = e.createElement("span");
      p.appendChild(e.createTextNode(d.subject)), d.note && p.appendChild(f(e, "span", "couloir-badge", d.note)), l.has("module") && d.detail && p.appendChild(f(e, "span", "couloir-detail", d.detail));
      const s = e.createElement("span");
      s.className = "room", d.change === "cancelled" ? s.appendChild(e.createTextNode("—")) : (l.has("salle") && s.appendChild(e.createTextNode(d.room)), l.has("enseignant") && d.teacher && s.appendChild(f(e, "span", "couloir-prof", d.teacher))), v.append(b, p, s), u.appendChild(v);
    }
    const c = e.createElement("div");
    c.className = "couloir-liste-vue", c.appendChild(u), t.appendChild(c), Ue(e, c, u, o.length);
    return;
  }
  n.view.startsWith("news") && _e(e, t, n);
}
function Ze(e, t, n) {
  return !e || !t || e === t ? !1 : n !== t;
}
const G = "couloir-rechargement";
function He() {
  try {
    return globalThis.sessionStorage?.getItem(G) ?? null;
  } catch {
    return null;
  }
}
function Ve(e) {
  try {
    globalThis.sessionStorage?.setItem(G, e);
  } catch {
  }
}
function Ye(e, t) {
  const n = Te(e, t), i = t.pollMs ?? 2e3, r = t.tickMs ?? 500;
  let a = null, l = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Set(), u = !1;
  n.onMediaEnded((p) => {
    o.add(p), x();
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
          if (Ze(t.rendu, s.rendu, He())) {
            Ve(s.rendu), globalThis.location?.reload();
            return;
          }
          s.manifest?.version !== a?.manifest?.version && (l = /* @__PURE__ */ new Map()), a = s, c(s);
        }
      } catch {
      }
  }
  function x() {
    if (u) return;
    if (!a?.manifest) {
      n.update(Je(a));
      return;
    }
    const p = ge({
      manifest: a.manifest,
      nowMs: Date.now(),
      sources: new Map(Object.entries(a.sources)),
      availableAssetIds: new Set(a.availableAssetIds),
      rotations: l,
      forceFallback: a.forceFallback,
      identify: a.identify,
      mediaEndedZoneIds: o,
      ...a.screenCode !== null ? { screenCode: a.screenCode } : {}
    });
    o = /* @__PURE__ */ new Set(), l = p.rotations, n.update(p.screen), p.transitions.length > 0 && t.transitionsUrl && Xe(t.transitionsUrl, p.transitions);
  }
  const v = setInterval(() => void d(), i), b = setInterval(x, r);
  return d().then(x), {
    stop() {
      u = !0, clearInterval(v), clearInterval(b), n.destroy();
    }
  };
}
function Je(e) {
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
async function Xe(e, t) {
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
  le as GLANCE_TIME_MS,
  se as MAX_SENSIBLE_DURATION_MS,
  ce as MIN_BODY_TEXT_HEIGHT_PERCENT,
  oe as READING_WORDS_PER_MINUTE,
  qe as RENDERER_CSS,
  re as activePlaylistId,
  U as advanceRotation,
  xe as collapseEmptyZones,
  ue as countWords,
  Q as dateLocale,
  ge as direct,
  Ze as doitRecharger,
  fe as effectiveDuration,
  ae as isDisplayOffPeriod,
  J as isDisplayable,
  ne as isScheduleActive,
  ie as isVisible,
  j as isWithinDailyWindow,
  R as localMoment,
  de as minReadableDurationMs,
  Te as mountRenderer,
  q as parseClock,
  ee as resolveSource,
  me as slideText,
  te as stalenessLabel,
  Ye as startPlayer,
  pe as typeScale
};
