/**
 * La feuille de style du noyau de rendu, injectée à la volée.
 *
 * Volontairement sans framework et sans dépendance : ce code doit tourner
 * dans le WebView d'un boîtier Android à 60 €, dans une application Tizen et
 * dans Chromium sur un Raspberry Pi. Du DOM et du CSS, rien d'autre.
 *
 * Toutes les tailles sont dérivées de la hauteur de la dalle via des
 * variables, jamais fixées en pixels : la même mise en page tient en 1080p
 * comme en 4K sans qu'on la refasse.
 */
export const RENDERER_CSS = `
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
`;
