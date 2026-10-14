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
`;
