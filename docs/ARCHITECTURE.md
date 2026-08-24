# Architecture

Document technique. Le cahier des charges fonctionnel est dans [`cahier-des-charges.html`](./cahier-des-charges.html).

---

## Le principe qui commande tout le reste

**L'écran n'attend jamais le serveur pour afficher quelque chose.**

Le serveur prépare un *manifeste* — la liste complète de ce qu'un écran doit
afficher. L'écran le récupère, télécharge ce qui lui manque, vérifie, puis
bascule. Rien n'est servi en direct au moment du rendu.

Deux invariants en découlent, et tout le code est organisé autour :

1. **Une perte de réseau ne change rien à ce qui est affiché.**
2. **On ne bascule sur un nouveau manifeste que lorsque 100 % de ses médias
   sont présents et vérifiés.** Sinon on reste sur le précédent.

Ces deux règles sont testées, pas supposées — voir `packages/agent/src/state.test.ts`.

---

## Découpage en trois couches

Le multiplateforme ne tient que si le code spécifique est confiné dans la
couche la plus fine.

| Couche | Où | Portabilité |
|---|---|---|
| **Noyau de rendu** | `packages/renderer` | 100 % partagé — web |
| **Agent** | `packages/agent` | 100 % partagé — TypeScript |
| **Coque native** | `apps/player-linux` | une par plateforme |

L'agent ne sait ni lire un fichier ni ouvrir une connexion. Il passe par les
**portes** définies dans [`packages/agent/src/ports.ts`](../packages/agent/src/ports.ts) :
`net`, `store`, `queue`, `display`, `system`, `clock`.

> **Ajouter une plateforme = implémenter `ports.ts`.**
> Jamais toucher à l'agent ni au noyau de rendu.

Une opération qu'une plateforme ne sait pas faire lève `UnsupportedOperation`.
Elle ne renvoie **pas** un succès de façade : la console doit pouvoir dire
« ce bouton est gris parce que l'appareil ne sait pas faire », et non « ça a raté ».

---

## Structure du dépôt

```
packages/
  protocol/     le contrat serveur ↔ écrans. Schémas Zod + logique pure.
                Aucune dépendance à Node : tourne aussi dans un WebView
                Android et dans un navigateur.
  agent/        machine à états, backoff, contrat d'abstraction.
  renderer/     le noyau de rendu. Deux moitiés séparées :
                  - décision : director, rotation, schedule, staleness,
                    readability — pur, testable sans navigateur ;
                  - application : dom/ — du DOM et du CSS, sans framework.
apps/
  server/       API Fastify, service des médias, persistance PostgreSQL.
  player-linux/ coque Linux : les six portes, le serveur local, systemd.
  console/      interface de pilotage (React).
```

`@couloir/protocol` est la **seule** dépendance partagée entre le serveur,
l'agent et les coques. Toute évolution du protocole passe par lui et par
`SCHEMA_VERSION`.

---

## Le protocole

### Deux identités distinctes

| | Quoi | Change quand |
|---|---|---|
| `deviceId` | le boîtier | on remplace le matériel |
| `screenId` | l'emplacement | jamais |

C'est ce qui permet de remplacer un Raspberry Pi par un boîtier Android sans
retoucher un seul contenu : le `screenId` porte les playlists et l'historique.

### Enrôlement

```
1. l'appareil génère une paire de clés   → POST /v1/enroll/start
2. il affiche un code à 6 caractères + QR
3. on le rattache depuis la console      → POST /v1/enroll/claim
4. il récupère son identité              → GET  /v1/enroll/status
```

Le code utilise un alphabet sans ambiguïté visuelle (ni `O`/`0`, ni `I`/`1`) :
on le saisit depuis un téléphone, debout dans un couloir. Usage unique,
expiration à 24 h.

### Synchronisation

```
GET /v1/devices/me/manifest      If-None-Match: "<etag>"
  → 304  rien n'a changé  (quelques centaines d'octets)
  → 200  nouveau manifeste + ETag
```

Deux canaux complémentaires :

- **push MQTT** sur `couloir/screens/{id}/cmd` pour la réactivité ;
- **poll périodique** (60 s par défaut) comme filet de sécurité si le push est tombé.

Le manifeste contient sa propre liste de fichiers avec empreinte SHA-256, ce
qui permet à l'agent de calculer **hors ligne** ce qui lui manque.

### Négociation de capacités

Le player déclare ses codecs, sa résolution et son espace disque. Le serveur
choisit le dérivé adapté — voir `chooseVideoDerivative`. Une 4K ne part pas
sur un boîtier 1080p. Si rien ne convient, le contenu est écarté de la
rotation et la console explique pourquoi, en français, à une personne du
service communication.

### Télémétrie

Journalisée en local avec l'heure réelle, envoyée par lots, **purgée
seulement après acquittement**. Chaque événement porte son propre `eventId`,
ce qui rend le renvoi idempotent : un lot rejoué deux fois ne crée pas de
doublon. C'est ce qui garantit qu'une coupure de 48 h ne fait perdre aucune
preuve de diffusion.

---

## La machine à états de l'agent

Écrite comme une **fonction pure** : on reçoit un état et un événement, on
renvoie le nouvel état et la liste des effets. Aucun accès réseau, aucun
accès disque, aucune horloge implicite.

Conséquence pratique : toute la résilience — la partie la plus risquée du
projet et la plus pénible à reproduire sur du vrai matériel — se teste en
mémoire, en trois millisecondes.

```
                    horloge douteuse
      boot ─────────────────────────► clock-unreliable ──► (repli + NTP)
        │                                     │
        └──────────────► syncing ◄────────────┘
                            │
              médias manquants│  tout en cache
                   ┌─────────┴──────────┐
                   ▼                    ▼
               staging ──────────────► active
        (l'écran affiche toujours       │  ▲
         la version précédente)         │  │
                                        ▼  │
             réseau perdu ──────────► degraded
                                        │
                        > 7 jours       ▼
                                    fallback
```

### Comportements encodés

| Situation | Ce qui se passe |
|---|---|
| Horloge non fiable au démarrage | playlist de repli, on ne joue **aucun** programme horaire |
| Réseau perdu | `degraded`, **affichage inchangé**, backoff 5 s → 15 s → 60 s → 5 min |
| Coupure > 7 jours | `fallback`, playlist embarquée |
| Retour du réseau | dispersion aléatoire 0–60 s avant de contacter le serveur |
| Manifeste avec médias manquants | `staging`, l'écran continue l'ancienne version |
| Téléchargement échoué | on garde l'ancienne version, jamais de manifeste partiel |
| Manifeste plus ancien rejoué | ignoré |

**Pourquoi la dispersion au retour** : quarante écrans qui redémarrent
ensemble après une coupure de courant tomberaient tous sur le serveur à la
même seconde.

**Pourquoi l'horloge** : le Raspberry Pi n'a pas d'horloge sauvegardée. Sans
module RTC, une coupure de courant sans réseau le fait redémarrer à une date
fantaisiste — et toute la programmation horaire part de travers. Le champ
`features.reliableClock` porte cette information jusqu'à la console.

---

## Choix techniques et pourquoi

| Choix | Raison |
|---|---|
| **TypeScript partout** | le même agent tourne dans la coque Linux, dans Electron et dans le navigateur. C'est ce qui rend le multiplateforme abordable. |
| **Zod pour le protocole** | un schéma sert à la fois de validation à l'exécution et de type à la compilation. Une seule source de vérité. |
| **Machine à états pure** | teste la résilience sans matériel, sans réseau, sans attendre 7 jours. |
| **Portes injectées** | un test n'a besoin d'aucun mock de framework, juste d'un objet littéral. |
| **ETag sur le manifeste** | un écran à jour coûte quelques centaines d'octets par cycle. |
| **`eventId` généré côté agent** | rend le rattrapage après coupure idempotent sans coordination. |
| **Positions de zones en %** | une mise en page fonctionne en 1080p comme en 4K sans recalcul. |
| **`findBrokenReferences`** | attrape à l'émission la classe de bugs la plus pénible : une playlist qui pointe vers une diapo supprimée, découverte sur un écran posé en hauteur. |

---

## Le player assemblé

Deux processus, délibérément séparés :

```
  ┌─ couloir-player.service ──────────┐        ┌─ couloir-kiosk.service ─┐
  │  agent : réseau, cache, file      │        │  Chromium --kiosk       │
  │  d'attente, machine à états       │◄──────►│  → 127.0.0.1:8080       │
  │  serveur local sur 8080           │  HTTP  │                         │
  └───────────────────────────────────┘        └─────────────────────────┘
```

**Pourquoi séparés** : Chromium peut planter, être relancé par son chien de
garde ou recharger sa page. L'agent, lui, garde son cache, sa file de
télémétrie et sa position dans la synchronisation. Le navigateur ne joint
jamais le serveur de l'école — tout ce qu'il demande est déjà sur la machine.

Le serveur local expose quatre choses : la page de rendu, le bundle du noyau,
`/state` (ce que l'agent sait), et `/media/:id` depuis le cache disque.

### Ce que le player garde sur son disque

| Fichier | Rôle | Pourquoi il doit survivre |
|---|---|---|
| `identity.json` | rattachement à un emplacement | sinon il faut retourner dans le couloir saisir un code à chaque coupure |
| `manifest.json` | le contenu appliqué + dernier contact | sans lui, un écran rallumé sans réseau perd son contenu alors que ses médias sont là |
| `cache/` | les médias vérifiés | c'est l'autonomie de sept jours |
| `telemetry.jsonl` | preuves de diffusion en attente | purgé seulement après acquittement du serveur |

Le **dernier contact** est conservé avec le manifeste, et ce n'est pas un
détail : sans lui, un écran qui redémarre repart avec « jamais contacté »,
en conclut que sa coupure dure depuis toujours, et bascule immédiatement sur
sa page de repli — alors qu'il vient de retrouver un contenu valide.

## Défauts trouvés en regardant tourner un vrai écran

Aucun de ces quatre n'était visible en test unitaire. Ils ont tous un test
de régression désormais.

| Défaut | Conséquence | Correction |
|---|---|---|
| Le contenu partait d'une opacité nulle et ne devenait visible qu'à la fin du fondu | navigateur qui gèle ses animations → **écran noir** | l'entrée n'anime que la position, jamais l'opacité |
| Le serveur local ne renvoyait pas de `Content-Type` | image cassée dans le navigateur | le type vient du manifeste, qui fait autorité |
| Le manifeste n'existait qu'en mémoire | un rallumage pendant une coupure perdait le contenu | conservé sur disque, rechargé au démarrage |
| Un écran neuf dont le premier téléchargement échoue restait en `staging` | rien à l'écran, aucun signal | bascule sur le contenu embarqué |

## La persistance

L'API ne connaît qu'une interface, `Store`. Deux implémentations la
respectent : `MemoryStore` pour les tests et les démonstrations,
`PostgresStore` en production. C'est ce qui permet de tester tout le serveur
sans conteneur — et de changer de moteur sans toucher aux routes.

Tout y est **asynchrone, y compris côté mémoire**. Une interface qui ment sur
son coût finit toujours par se payer au moment de la bascule.

### Migrations en SQL brut

Pas d'ORM ni de générateur de code. Le schéma est petit et stable, et une
migration qu'on peut lire telle quelle est une migration qu'on pourra relire
dans deux ans, quand il faudra comprendre pourquoi un index existe. Chaque
fichier s'applique une fois, dans une transaction.

### Ce que le schéma encode

| Contrainte | Ce qu'elle empêche |
|---|---|
| `screens.code` unique | deux `A·1·12` dans le bâtiment, donc un repérage impossible |
| index partiel sur `devices.screen_id` | deux boîtiers pilotant le même écran |
| index partiel sur `devices.pairing_code` | deux écrans affichant le même code d'appairage |
| clé primaire `(screen_id, version)` sur `manifests` | l'écrasement de l'historique — c'est lui qui permettra le retour en arrière |
| `ON CONFLICT (event_id) DO NOTHING` | qu'un lot rejoué après coupure gonfle le rapport d'une campagne |

Le remplacement d'un boîtier est une **transaction** : détacher l'ancien et
rattacher le nouveau se font ensemble, ou pas du tout. L'index unique impose
d'ailleurs cet ordre.

Le jeton d'appareil n'est stocké que sous forme d'empreinte, et n'est délivré
qu'une fois — au rattachement.

### Vérifié en conditions réelles

Le serveur redémarre, rejoue ses migrations sans rien casser, et un player
enrôlé continue d'être servi. Avant PostgreSQL, il recevait un 403 : le
serveur avait tout oublié.

Un battement de cœur resté bloqué dans la file locale d'un player pendant
son arrêt est remonté ensuite **avec son horodatage d'origine**, et la file
n'a été vidée qu'après acquittement.

## Authentification des appareils

Chaque écran génère une paire Ed25519 à son premier démarrage. **La clé
privée ne quitte jamais le boîtier** ; le serveur n'en connaît que la partie
publique. Une base serveur compromise ne permet donc pas d'usurper un écran.

Ce qui est signé, dans cet ordre :

```
couloir-ed25519-v1 \n MÉTHODE \n chemin+requête \n horodatage \n sha256(corps)
```

Chaque élément ferme une attaque précise :

| Élément signé | Ce qu'il empêche |
|---|---|
| méthode et chemin | rejouer une signature valide sur une autre route |
| empreinte du corps | glisser de fausses preuves de diffusion dans un lot authentique |
| horodatage (±5 min) | rejouer indéfiniment une requête interceptée |
| fenêtre anti-rejeu | rejouer la même requête à l'intérieur de la tolérance |

Cinq minutes de tolérance : assez large pour un Raspberry Pi qui vient de
resynchroniser son heure après une coupure, assez étroit pour que la fenêtre
de rejeu reste courte. Un décalage est refusé avec `retryable: true` et un
message explicite — l'agent doit pouvoir repartir seul.

**L'enrôlement reste non signé** : l'appareil n'a pas encore d'identité
reconnue quand il se déclare. C'est précisément le rôle du code d'appairage,
saisi par un humain, de faire ce premier pont de confiance.

**La révocation est gratuite** : détacher un boîtier de son écran suffit à
ce que ses requêtes soient refusées. C'est le même chemin que le
remplacement de matériel.

Le format de clé transporté est **32 octets bruts en base64url**, celui que
produisent naturellement WebCrypto et les bibliothèques Android : les futures
coques n'auront rien à convertir. Le protocole ne contient que le *format* de
signature, aucune primitive — chaque plateforme signe avec ce qu'elle a.

Le fichier d'identité du player est en `0600` : il contient la clé privée.

## La console

API séparée de celle des écrans, sous `/v1/console`. Les deux n'ont ni les
mêmes clients, ni la même authentification, ni la même surface : un player ne
doit pas pouvoir publier, une console ne doit pas pouvoir remonter de la
télémétrie.

### Le composeur

La console manipule des idées simples — « ces trois images, quinze secondes
chacune, avec les cours dans une colonne ». Le manifeste, lui, est un objet
normalisé avec ses identifiants croisés, sa playlist de repli et ses sources
de données. `compose()` fait la traduction, en logique pure.

C'est la pièce qui mérite le plus de tests : une erreur ici produit un écran
vide qu'on ne diagnostiquera qu'en montant sur une échelle. Elle revalide
d'ailleurs sa propre sortie — une composition incohérente est un bug du
composeur, jamais une faute de l'utilisateur.

### L'état du parc

Déduit du dernier battement de cœur, jamais déclaré : un écran débranché n'a
aucun moyen de dire qu'il est parti. Muet au-delà de trois minutes, soit
trois battements manqués. La requête agrège en SQL plutôt qu'écran par
écran — la console rafraîchit cette vue toutes les cinq secondes.

### Dette assumée

L'accès est un **jeton partagé** en `Bearer`, absent par défaut. Les comptes
nominatifs, les rôles et le journal d'audit promis au cahier des charges
restent à faire. Une console sans aucune protection serait pire que des
`curl` ; un jeton partagé n'est pas une authentification.

## Ce que la VM Linux a révélé

Toute la coque `player-linux` avait été écrite sans jamais tourner sur Linux.
Une VM Debian 12 arm64 — `apps/player-linux/lima/couloir-pi.yaml` — a sorti
quatre défauts en une heure, tous invisibles depuis un Mac.

| Défaut | Ce qui serait arrivé sur un vrai Pi |
|---|---|
| L'URL des médias venait de l'en-tête `Host` de **celui qui publie** | publier depuis `localhost` produisait des adresses que les écrans ne savaient pas joindre. Le manifeste arrivait, les médias jamais. |
| `chromium-browser` n'existe pas sur Debian, seulement sur Raspberry Pi OS | installation en échec, ou kiosque qui ne démarre pas |
| L'unité systemd figeait `/usr/bin/node`, absent quand Node vient de nodejs.org | service en boucle de redémarrage, écran noir |
| Aucun artefact déployable : `node_modules` d'un monorepo pnpm est un maillage de liens symboliques | rien à copier sur le boîtier |

Un cinquième, plus retors : la détection du paquet navigateur échouait
**toujours**, en silence. `grep -q` ferme le tuyau dès qu'il trouve, la
commande amont reçoit un SIGPIPE et sort en 141, et `set -o pipefail` en fait
un échec. La sortie est désormais capturée avant d'être filtrée.

Et une correction de conception au passage : `WatchdogSec` était armé dans
l'unité systemd alors que l'agent n'envoie aucun battement par `sd_notify`.
Un chien de garde qu'on n'alimente pas redémarre l'écran toutes les deux
minutes — il valait mieux le retirer que le laisser mordre.

### L'artefact déployable

Deux fichiers, rien à installer :

```
couloir-player.mjs   l'agent et son serveur local, tout inclus (esbuild)
couloir.js           le noyau de rendu servi au navigateur
```

C'est aussi ce qui rend supportable la mise à jour d'un parc de quarante
écrans.

### Ce que la VM ne dit pas

HDMI, CEC, `vcgencmd`, la sortie vidéo, le module RTC. Tout ce qui tient au
matériel du Pi ne se vérifiera que sur un vrai boîtier. Le code doit se
dégrader proprement en leur absence — et c'est vérifié : sans `xrandr` la
résolution retombe sur 1920×1080, sans zone thermique la température est
simplement absente du battement de cœur.

## L'emploi du temps

Construit chez nous plutôt que branché sur celui de l'école. Deux raisons :
la question du logiciel de l'établissement traînait depuis le début du
projet, et surtout **les changements de dernière minute sont ce qui a le plus
de valeur sur un écran de couloir** — or c'est justement ce que les exports
d'emploi du temps rendent le plus mal.

Périmètre assumé : alimenter les écrans. Ni les profs, ni les élèves, ni les
parents ne s'en servent. Ce n'est pas un remplaçant d'Hyperplanning, et ce
n'est surtout pas un *générateur* d'emplois du temps — répartir classes,
profs et salles sans conflit est un problème d'optimisation qui se construit
sur des années, pas en marge d'un projet d'affichage.

### Une grille qui se répète, corrigée au jour le jour

C'est ainsi que fonctionne un établissement : l'ossature bouge deux fois par
an, les exceptions tombent tous les matins. D'où deux tables distinctes —
`lessons` pour la grille, `timetable_exceptions` pour les changements datés.

Le calcul est dans `engine.ts`, en **logique pure** : on lui donne la grille,
les exceptions et le calendrier, il rend la journée. Aucune base, aucune
horloge implicite — on rejoue une année scolaire entière dans un test,
vacances et quinzaines comprises, plutôt que d'attendre le bon jour.

### Trois décisions qui se voient à l'écran

| Décision | Pourquoi |
|---|---|
| **Un cours annulé reste affiché**, barré | le faire disparaître priverait l'élève de l'information qui l'intéresse le plus : il se déplacerait pour rien |
| Le week-end n'est **pas** décrété | beaucoup d'établissements ont cours le samedi matin. C'est la grille qui décide, pas une règle en dur |
| Vacances annoncées par un libellé | une liste vide ressemble à un échec de chargement |

La quinzaine se compte depuis une **date d'ancrage**, pas depuis le numéro de
semaine ISO : les établissements ne s'accordent pas sur le point de départ, et
une année qui commence en semaine B n'a rien d'exceptionnel. Réglage absent :
tous les cours s'affichent, parce qu'un paramètre oublié ne doit pas vider un
écran.

### Les trois modes d'affichage

Ils tombent sur le même mécanisme. Le composeur produit **une diapositive par
classe**, toutes branchées sur la même source :

- **fixe** — une seule classe retenue, l'écran devant les terminales montre
  toujours la terminale ;
- **rotation** — toutes les classes s'enchaînent dans la colonne ;
- **rotation mêlée** — elles s'intercalent avec les actualités et les
  affiches, puisque c'est déjà ce que fait la playlist principale.

Une source, N diapositives qui y piochent par `params.classId` : l'agent ne
fait qu'un appel réseau même pour trente classes, et chaque classe garde sa
propre preuve de diffusion.

### Séparation des accès

`/v1/console/timetable` pour la saisie, protégé par le jeton de la console.
`/v1/timetable` pour la lecture par les écrans, sans jeton — c'est une source
de données du manifeste, un player doit pouvoir la joindre. Ce qui en sort ne
contient aucune donnée d'élève : des matières, des salles, et le nom d'usage
d'un enseignant — exactement ce qui figurait déjà sur les panneaux papier.

## Une seule adresse

Le serveur sert la console lui-même : l'interface à la racine, l'API sous
`/v1`. Deux serveurs distincts obligeraient à retenir deux URL, à gérer deux
certificats et du CORS pour rien.

Le repli SPA renvoie `index.html` pour toute route inconnue — mais **pas**
pour les chemins d'API : renvoyer la console à un player qui se trompe
d'adresse le laisserait deviner longtemps. Les 404 d'API restent francs.

Les fichiers sont résolus **à la requête**, pas indexés au démarrage :
reconstruire la console pendant que le serveur tourne servait sinon la page
de repli à la place des fichiers, avec un type MIME faux.

## L'administration

Quatre onglets, et l'ordre n'est pas neutre.

| Onglet | À quelle fréquence |
|---|---|
| **Aujourd'hui** | tous les matins — c'est l'onglet par défaut |
| **Écrans** | à la pose, puis quand on publie |
| **Grille** | deux fois par an |
| **Réglages** | une fois par an |

« Aujourd'hui » est ouvert d'emblée parce que c'est le geste du quotidien :
signaler trois absences et deux changements de salle, puis repartir. Le
formulaire s'ouvre à côté de la liste, sans boîte de dialogue.

**L'aperçu de l'écran** est dessiné comme le vrai rendu, à droite de la
saisie : on pose un changement et on le voit tel que les élèves le verront.
Sans ça il faudrait aller dans un couloir pour vérifier une faute de frappe.

Dans l'éditeur de grille, le raccourci qui rend la saisie d'une année
supportable : **dupliquer un cours sur les autres jours**. Une matière revient
rarement une seule fois par semaine. Les créneaux déjà pris sont laissés tels
quels plutôt qu'écrasés.

## L'aperçu avant publication

Le **vrai noyau de rendu**, pas une imitation : la console importe le même
paquet que celui qui tourne dans les couloirs. Un aperçu redessiné à la main
finirait par mentir le jour où le rendu évolue sans lui.

Deux décisions le rendent fidèle :

- **le même composeur.** L'aperçu passe par une route qui compose le
  manifeste sans l'enregistrer, en partageant la résolution des classes avec
  la publication. Deux chemins distincts divergeraient tôt ou tard ;
- **la taille réelle, réduite après coup.** La scène fait 1280×720 et subit
  une transformation d'échelle. Les tailles de texte du rendu dérivent de la
  hauteur de la dalle : la rendre petite produirait un écran différent de
  celui du couloir, alors que la réduire conserve les proportions.

Les sources vivantes sont récupérées comme le ferait l'agent, si bien que les
cours affichés dans l'aperçu sont ceux du jour.

## Le mode urgence

Le message est posé dans le manifeste de chaque écran visé, **avec une
version incrémentée** : sans ça l'agent l'ignorerait, puisqu'il refuse toute
version qui n'augmente pas. Le retrait incrémente à son tour.

| Décision | Pourquoi |
|---|---|
| Ne disparaît que sur action explicite | un écran qui se remettrait aux actualités pendant une évacuation serait pire que tout |
| `validUntil` est un garde-fou, pas une durée | un écran rallumé trois jours plus tard ne doit pas ressortir une alerte périmée |
| Les écrans sans contenu publié sont **signalés** | savoir quels couloirs sont restés muets fait partie de l'information d'urgence |
| Modèles pré-rédigés | on ne compose pas une phrase quand quelqu'un entre en courant |

**Limite assumée** : le message arrive à la prochaine synchronisation, donc
dans la minute. Le cahier des charges demande moins de dix secondes, ce qui
suppose le canal temps réel — MQTT ou une interrogation longue. C'est un
chantier à part, et le mode urgence fonctionne sans lui.

## Le canal de commandes

**Interrogation longue sur HTTP, pas MQTT.** Le cahier des charges prévoyait
un broker ; le contexte l'a fait changer d'avis.

L'écran demande ses commandes à `/v1/devices/me/commands`, le serveur retient
la réponse jusqu'à en avoir une ou jusqu'au délai — vingt-cinq secondes, sous
la minute des mandataires qui coupent les connexions inactives. Puis l'agent
reboucle.

| Ce que ça évite | Pourquoi ça compte dans une école |
|---|---|
| Un second port à ouvrir | les réseaux d'établissement sont fermés, et chaque ouverture est une demande |
| Une seconde authentification | la signature Ed25519 existante couvre la route sans un mot de plus |
| Un broker à exploiter | une infrastructure de moins à surveiller, sauvegarder et mettre à jour |
| Les protocoles exotiques | ça traverse les mandataires HTTP sans configuration |

Le coût : une connexion ouverte par écran. Node en tient des milliers ; à
l'échelle d'un établissement c'est sans objet.

### Ce que ça débloque

Quatre fonctions qui existaient sans pouvoir être déclenchées : identifier un
écran, le capturer, piloter sa dalle, le redémarrer. Et un `sync-now` poussé
à la publication ramène l'arrivée d'un **message d'urgence de la minute à
quelques dizaines de millisecondes** — mesuré à 43 ms, là où le cahier des
charges demandait moins de dix secondes.

### Trois pièges rencontrés

**`preClose`, pas `onClose`.** Fastify attend d'abord la fin des requêtes en
cours, et une interrogation longue en est une. Libérer les attentes après
coup produit un interblocage : l'arrêt attend la requête, qui n'attend que
l'arrêt.

**`forceCloseConnections`.** Même en libérant les attentes, l'agent en rouvre
une aussitôt : le serveur ne se vide jamais tout seul.

**Un socket mort coûte cher.** Après un redémarrage du serveur, la grappe de
connexions de l'agent garde des sockets fermés ; la requête suivante échoue
avant de partir. Sans un second essai immédiat, chaque écran paierait un
échec puis son espacement — quinze secondes, puis une minute, puis cinq. Un
parc entier mettrait de longues minutes à revenir après un déploiement.

### Une capacité absente n'est pas une panne

`unsupported` est un résultat à part entière. Un boîtier sans serveur
graphique répond « capture d'écran non disponible » plutôt que d'échouer :
« échec » enverrait l'opérateur chercher un problème qui n'existe pas.

## L'ergonomie de la console

Trois décisions structurent le parcours quotidien, et elles se tiennent
ensemble.

### Rouvrir plutôt que refaire

L'éditeur s'ouvrait vide devant un écran qui affichait déjà quelque chose.
On ne pouvait donc que remplacer à l'aveugle : pour changer un bandeau, il
fallait recomposer la diffusion entière de mémoire.

Le manifeste ne permet pas de remonter au choix d'origine — il en est le
résultat, en identifiants de médias et en durées. On conserve donc la
composition telle qu'elle a été saisie, dans une colonne `spec` ajoutée aux
manifestes (migration 003). `GET /v1/console/screens/:id/composition` la
rend, et l'éditeur s'ouvre dessus.

On enregistre la composition **saisie**, pas la composition résolue :
rouvrir doit rendre « toutes les classes » et non la liste figée des classes
qui existaient ce jour-là.

La colonne est nullable, et les publications antérieures à la migration
n'en ont pas. La console le dit alors franchement — « cet écran diffuse la
version 7, publiée avant que les compositions ne soient conservées » —
plutôt que de présenter un éditeur vide qui laisserait croire à un écran
sans contenu.

### L'annulation à la place de la confirmation

Revenir à une version passée ne réécrit rien : on republie l'ancien contenu
sous un nouveau numéro. L'historique reste une suite de faits — « on est
revenu à ce contenu tel jour » — plutôt qu'un état qu'on remonterait en
effaçant ce qui s'est passé. Conséquence utile : une annulation s'annule
elle-même.

Publier étant devenu réversible, publier ne demande pas confirmation. Le
message de succès porte un lien « Revenir à la version N », offert au moment
où l'on s'aperçoit de l'erreur. Une boîte de dialogue posée partout se clique
sans être lue au bout de trois jours ; un lien lisible au bon moment se lit.

On confirme donc uniquement ce qui est irréversible **et** invisible depuis
la console : éteindre une dalle, relancer l'application, redémarrer un
boîtier. Ces trois-là laissent un couloir noir sans personne pour le
constater.

Un retour arrière remonte l'éditeur, qui relit ce qui est réellement
diffusé. Sans ça la console continuerait d'afficher l'ancienne composition
en annonçant l'ancienne version : elle mentirait sur l'état de l'écran, ce
qui est pire que de ne rien afficher.

### Nommer l'état plutôt que le numéroter

« v0 » ne veut rien dire pour personne : la liste affiche « rien de publié ».
Un bouton grisé dit pourquoi il l'est. Un badge « brouillon » signale que ce
qu'on voit à l'écran n'est pas ce qu'on vient de modifier. Le chemin du
premier jour montre l'étape suivante — une seule à la fois — et disparaît de
lui-même dès que l'installation tient debout.

### L'extinction programmée, et un piège de calendrier

Une dalle allumée la nuit s'use et consomme pour personne. Les plages se
règlent par écran et voyagent dans le manifeste ; la coque native coupe
réellement l'alimentation quand elle sait le faire.

Les jours cochés désignent le jour où la plage **commence**, pas celui où
l'on se trouve. La distinction n'est pas théorique : avec l'ancienne
sémantique, « du lundi au vendredi, 19:00 → 07:30 » rallumait l'écran le
samedi à minuit, parce que le samedi n'était pas coché. Personne ne lit la
phrase ainsi. La console affiche maintenant le récapitulatif en toutes
lettres — « éteint les lundi, mardi, mercredi, jeudi et vendredi à partir de
19:00, jusqu'à 07:30 le lendemain matin » — et `packages/renderer/src/schedule.test.ts`
tient cette phrase, y compris le cas du samedi matin.

L'urgence passe avant l'extinction : elle rallume l'écran. La console le
promet sous le réglage, et deux tests du réalisateur le garantissent.

### Le téléphone

La console se consulte debout dans un couloir, un boîtier dans une main :
appairer un écran et l'identifier doivent tenir sur un écran de poche. En
dessous de 640 px la barre supérieure se replie, les onglets passent en
pleine largeur, et les cibles tactiles montent à 44 px. La grille d'emploi
du temps défile dans son propre conteneur — la page, elle, ne défile jamais
latéralement.

## Les comptes

Jusqu'ici la console était protégée par un jeton unique, partagé. Trois
conséquences : personne ne pouvait être retiré sans changer le secret de tout
le monde, personne ne pouvait être limité à ce qui le concerne, et rien ne
disait qui avait publié quoi.

### Trois rôles, pas davantage

`administrateur` publie et gère les comptes. `editeur` publie, tient l'emploi
du temps, déclenche une urgence. `lecteur` consulte.

Un système de permissions fines se paie en réglages que personne ne comprend
et que tout le monde finit par mettre au maximum. Dans une école la question
n'est jamais « peut-il modifier le champ durée » mais « est-ce qu'on lui
confie les écrans ».

Le pouvoir exigé se **déduit** du chemin et de la méthode, il n'est pas
déclaré route par route : une règle unique ne peut pas être oubliée en
ajoutant une route, alors qu'une annotation à recopier finit toujours par
manquer quelque part.

### La clé de secours ne publie rien

`COULOIR_CONSOLE_TOKEN` reste, mais son rôle a changé. Elle crée le premier
administrateur d'une installation neuve, et rouvre la porte le jour où le
dernier a perdu son mot de passe. Elle ne voit aucun écran et ne publie rien.

Quelqu'un qui la connaîtrait ne peut donc pas s'en servir pour afficher quoi
que ce soit dans un couloir — il ne peut que se donner un compte, ce qui
laisse une trace au journal. C'est un compromis assumé : une installation
scolaire sans service informatique a besoin d'un chemin de retour, et un
chemin de retour qui n'affiche rien vaut mieux qu'un chemin de retour absent.

### Ce qui protège vraiment

**Les mots de passe** passent par scrypt — dans Node, lent à dessein, et
coûteux en mémoire, ce qui rend l'attaque par carte graphique peu rentable.
Les paramètres sont écrits dans l'empreinte : on pourra durcir le coût dans
cinq ans et rehacher au vol, à la connexion suivante, sans invalider un seul
compte.

**Les sessions** sont opaques et stockées **hachées**. Un jeton en clair en
base se lit dans une sauvegarde ou un vidage ; haché, il ne sert plus à rien
une fois volé.

**Le cookie** est `httpOnly` — le JavaScript de la page ne peut pas le lire,
donc une injection dans la console n'emporte pas la session — et
`SameSite=Strict`, ce qui règle la falsification de requête sans jeton
anti-CSRF. Il n'est `Secure` qu'en HTTPS : sur HTTP un cookie `Secure` n'est
pas posé du tout, et la console de développement deviendrait inutilisable.

**Une adresse inconnue ne se distingue pas d'un mot de passe faux** — ni par
le message, ni par le temps de réponse : on hache même quand le compte
n'existe pas, sans quoi la liste des comptes se devine au chronomètre.

**Changer un mot de passe ferme toutes les sessions** de la personne, et
désactiver un compte ferme les siennes immédiatement.

**On ne se retire pas soi-même** : sans ce garde, le dernier administrateur se
rétrograde et plus personne ne peut créer de compte.

### Le journal

On n'y écrit que ce qui change quelque chose pour quelqu'un : publier, revenir
en arrière, déclencher une urgence, redémarrer un boîtier, toucher aux
comptes. Consulter n'y figure pas — un journal noyé n'est lu par personne.

Les comptes se désactivent au lieu de se supprimer, et le journal garde une
copie du nom : « qui » est justement ce qu'il doit retenir, y compris une fois
la personne partie.

### Une base de test par fichier

Détail d'outillage, mais il a coûté une heure. Vitest exécute les fichiers en
parallèle et chacun vide les tables entre deux cas : sur une base commune, un
fichier efface les données d'un autre en pleine exécution. L'échec tombe alors
ailleurs que la cause, et ne se reproduit pas quand on relance le fichier
seul. `ensureTestDatabase(suffixe)` donne à chacun la sienne.

## Les actualités du site

La promesse d'origine : ce que la personne chargée de la communication publie
sur le site apparaît dans les couloirs, sans qu'elle ait à toucher aux écrans.

### C'est le serveur qui va chercher, pas les écrans

Trois raisons, et chacune suffirait. Les écrans sont souvent sur un réseau
restreint qui ne sort pas. Vingt écrans interrogeant le site toutes les dix
minutes finiraient par le faire tomber. Et normaliser une seule fois évite
d'écrire la connaissance de WordPress dans le noyau de rendu, qui doit rester
ignorant de l'endroit d'où vient une donnée.

Deux protocoles, essayés dans cet ordre : l'API REST de WordPress — la plus
riche, avec images, catégories et extraits déjà rédigés — puis le flux RSS ou
Atom, plus pauvre mais à peu près universel, y compris sur les sites dont
l'API REST est désactivée.

### Les images passent aussi par le serveur

Le premier jet rendait aux écrans les adresses d'images du site, sur son
propre réseau de diffusion. C'était rouvrir par la petite porte ce qu'on
venait de fermer par la grande : les couloirs auraient affiché du texte sans
images, sans que personne comprenne pourquoi.

Le serveur relaie donc les illustrations. La table qui les porte n'est pas un
cache mais **une liste blanche** : on ne relaie que les adresses vues dans la
charge courante, et la route n'accepte qu'une clé, jamais une adresse. Une
route qui prendrait une adresse arbitraire serait un relais ouvert, utilisable
pour atteindre depuis le serveur ce qu'on ne peut pas atteindre du dehors.

### Une diapositive par article

Le premier jet n'affichait que le premier article. Une école qui en publie
trois s'attend à voir les trois.

N diapositives partagent donc UNE source, chacune désignant son rang — le même
schéma que l'emploi du temps, où une source sert toutes les classes. L'écran
ne fait qu'un appel réseau, et chaque article garde sa propre preuve de
diffusion. Le rang boucle côté rendu : une source qui rend moins d'articles
que prévu ne laisse aucune dalle vide.

Elles rejoignent la rotation principale, avec les affiches et les vidéos. Un
écran qui ne diffuserait que les actualités est légitime — c'est la
configuration d'un hall d'accueil.

### Ce qu'on garde quand le site tombe

Le site de l'école tombera : maintenance, hébergeur, certificat expiré. Le
serveur conserve donc la dernière charge connue et continue de la servir,
aussi vieille soit-elle. La date part avec, et le rendu décide.

`stalePolicy` vaut `keep-with-date` pour les actualités, là où l'emploi du
temps utilise `hide`. Ce n'est pas une inattention : un cours faux envoie
quelqu'un dans la mauvaise salle, une vieille actualité ne fait de mal à
personne. Mieux vaut une annonce datée qu'un trou dans la rotation.

Une asymétrie subsiste, et il faut la connaître : les médias importés sont
téléchargés et vérifiés par l'agent, donc ils survivent à une coupure ; les
images d'actualités sont chargées par le navigateur de la dalle au moment de
l'affichage. Pendant une panne réseau, le texte des articles reste — l'agent
en a une copie — mais les illustrations disparaissent.

### Deux pièges rencontrés en le branchant

**Un test du composeur ne prouve pas qu'une publication passe.** Le schéma de
validation du corps imposait au moins un contenu, ce qui rendait impossible un
écran d'actualités seules. Le test du composeur passait, parce qu'il contourne
la couche HTTP. Le défaut n'est apparu qu'en publiant pour de vrai. Le
minimum vit désormais dans le composeur, le seul endroit qui sache ce qui
alimente la rotation.

**`COULOIR_PUBLIC_URL` compte plus qu'il n'y paraît.** Sans elle, l'adresse se
déduit de l'en-tête `Host` de qui publie — donc « localhost », qui pour un
écran désigne l'écran lui-même. Les médias s'en tiraient parce que l'agent les
télécharge depuis Node ; les images d'actualités, chargées par le navigateur
de la dalle, échouaient sans un mot.

## La programmation d'une affiche

« Cette affiche du 1er au 15 septembre », « celle-là le matin seulement ».
L'affiche rejoint la rotation le temps voulu puis en sort d'elle-même :
personne n'a à penser à la retirer trois semaines après les portes ouvertes.

### Attachée à la diapositive, pas à la playlist

Le manifeste portait déjà un mécanisme de programmation : un `Schedule` fait
occuper une zone par une playlist entière pendant une période. Il ne convenait
pas. Une affiche datée doit **rejoindre** la rotation, pas s'y substituer —
avec l'ancien mécanisme, tout le reste aurait disparu pendant la quinzaine des
portes ouvertes.

La période vit donc sur la diapositive. Et le réalisateur n'a rien eu à
apprendre de neuf : il savait déjà sauter une diapositive dont le média n'est
pas encore en cache. On lui a donné une raison de plus.

### C'est l'écran qui tranche

Pas le serveur au moment de publier. Un boîtier coupé du réseau pendant une
semaine voit ainsi ses affiches arriver et repartir tout seul, avec le
manifeste qu'il a déjà. Filtrer à la publication aurait figé la rotation à
l'instant du clic.

### Une dalle ne devient jamais noire

Le défaut que la programmation fait apparaître : on date tout pour septembre,
et le 20 août le couloir est éteint sans que rien ne l'explique. Une dalle
noire ressemble à une panne — on monte à l'échelle pour découvrir qu'il n'y
avait simplement rien à montrer.

Quand plus aucune diapositive n'est dans sa période, l'écran joue donc le
repli : sa carte d'identité, qui dit au moins que le boîtier va bien. Ce n'est
pas le mode `fallback`, qui signale une perte de contact ; ici tout
fonctionne, il n'y a rien de programmé pour maintenant.

### Voir l'écran à une autre date

Sans ça, on ne saurait ce qu'affichera l'écran le 12 septembre qu'en attendant
le 12 septembre — et une affiche programmée à tort ne se découvrirait qu'en
montant voir un couloir vide.

Le réalisateur prenait déjà l'instant en paramètre : il suffisait de cesser de
lui passer l'heure courante. L'aperçu accepte donc une date, et montre
exactement ce que la dalle affichera ce jour-là. La commande n'apparaît que si
au moins un contenu est programmé.

### Le piège des fuseaux

Un établissement qui écrit « jusqu'au 15 septembre » veut dire jusqu'à la fin
du 15 **chez lui**. Poser la borne à `2026-09-15T00:00:00Z` décale tout de
deux heures en été, et l'affiche disparaît la veille au soir.

La console convertit donc une date saisie en instant local : début de journée
pour le début, minuit du lendemain pour la fin. Le manifeste ne transporte que
des instants absolus, et le rendu les compare dans le fuseau de l'école. Le
piège s'est présenté en écrivant les tests, avec deux heures d'écart
inexpliquées.

Même règle que pour l'extinction de la dalle : **les jours cochés désignent le
jour où la plage commence**. « Le vendredi de 18:00 à 08:00 » couvre bien le
vendredi soir jusqu'au samedi matin. Deux règles différentes pour la même
phrase seraient un piège.

## L'emploi du temps depuis NetYPareo

NetYPareo — le logiciel de gestion des CFA et campus consulaires — expose une
fonction « afficheur planning » faite exactement pour ça : des écrans de
couloir. Chaque afficheur est configuré dans NetYPareo, l'établissement entier
ou un bâtiment, et rend les séances du jour en JSON, sans authentification.

### Pourquoi pas l'export iCalendar

Il est pourtant documenté, et c'est la première piste qu'on trouve. Mais
l'iCal de NetYPareo est **personnel** : il porte le planning d'un individu, et
son lien vaut mot de passe. L'afficheur, lui, est déjà pensé pour être public
et collectif.

Utiliser la porte prévue plutôt que d'en forcer une autre évite d'avoir à
protéger un secret qu'on n'aurait pas dû détenir.

### La correspondance se fait par bâtiment

NetYPareo configure un afficheur par bâtiment ; nos écrans portent déjà un
bâtiment dans leur code d'étiquette. Un écran du bâtiment B lit donc
l'afficheur du bâtiment B, sans réglage supplémentaire. Un écran dont le
bâtiment n'est pas apparié prend l'afficheur sans bâtiment — mieux vaut
l'établissement entier que pas d'emploi du temps.

### Choisir, ou laisser faire

Sans réglage, l'écran prend l'afficheur de son bâtiment. C'est le cas courant
et il ne demande rien.

Un choix explicite l'emporte : un écran du hall peut vouloir l'établissement
entier, un écran du bâtiment B peut vouloir montrer aussi celui du C. Un seul
afficheur retenu, l'écran s'y tient ; plusieurs, il les fait défiler — les
mêmes règles que pour les classes, parce que deux mécanismes voisins aux
règles différentes se retiennent mal.

Une source **par** afficheur, là où les classes partagent une source et se
départagent par un sélecteur : chaque afficheur a sa propre adresse, il n'y a
rien à partager.

### Une chaîne de certificats incomplète, et ce qu'on en fait

Le serveur NetYPareo du campus n'envoie que son propre certificat, sans
l'intermédiaire qui le relie à une autorité connue. Les navigateurs et `curl`
ne s'en aperçoivent pas : ils vont chercher l'intermédiaire manquant à
l'adresse que le certificat indique lui-même. Node refuse, avec un message
— « unable to verify the first certificate » — qui ne dit rien à un
administrateur d'établissement.

On fait donc la même chose que les navigateurs, **sans baisser la garde** : le
certificat téléchargé ne sert qu'à compléter la chaîne, qui reste vérifiée
jusqu'à une racine du système. Un intermédiaire falsifié ne remonterait à
aucune racine connue et la connexion échouerait quand même — c'est pourquoi le
télécharger en clair ne coûte rien.

La console signale quand c'est arrivé. La correction propre est du côté du
serveur ; en attendant, personne ne devrait avoir à s'en occuper pour afficher
un emploi du temps dans un couloir.

### Deux traductions qui méritaient des tests

**Les heures.** NetYPareo écrit « 08h30 ». Une heure mal lue s'affiche quand
même, et personne ne s'en aperçoit avant qu'un élève ne se présente au mauvais
moment. Le connecteur retombe sur les minutes depuis minuit, que NetYPareo
fournit aussi — deux représentations de la même chose, et l'une rattrape
l'autre.

**Salle et enseignant.** NetYPareo rend deux lignes libres. On reconnaît
l'enseignant à sa civilité plutôt qu'à sa position : se fier à l'ordre ferait
passer une salle pour un nom le jour où l'enseignant n'est pas renseigné. Et
« A distance » figure là où on attendrait une salle.

### Six informations, six affichées

NetYPareo donne, pour chaque séance : heure de début, heure de fin, groupe,
module, salle, enseignant. Le premier jet n'en dessinait que quatre —
l'enseignant et l'heure de fin arrivaient jusqu'au boîtier et n'apparaissaient
nulle part. Laisser deux informations au fond de la charge utile, c'est faire
monter quelqu'un à l'échelle pour savoir avec qui a lieu le cours.

Elles se rangent par ordre de question posée. L'heure de fin sous l'heure de
début : dans un couloir on se demande d'abord « ça commence quand », et
seulement ensuite « est-ce que c'est encore en cours ». L'enseignant sous la
salle : « où » puis « avec qui ». Le module sous le groupe : « pour qui »
puis « quoi ».

Les mettre en colonnes séparées aurait réduit l'intitulé, qui est justement
ce qu'on lit de loin.

### Chaque écran décide de ce qu'il montre

Les six informations ne se valent pas partout. Un couloir de bâtiment veut la
salle — c'est la question qu'on s'y pose. Un écran d'accueil s'en passe et
préfère des intitulés lisibles de plus loin. Certains établissements ne
souhaitent pas afficher de noms d'enseignants.

Quatre colonnes se cochent donc écran par écran, à la publication : heure de
fin, module, salle, enseignant. L'heure de début et le nom du groupe ne sont
pas décochables — sans eux la colonne ne dit plus rien.

Le réglage voyage dans le sélecteur de la diapositive, là où voyage déjà le
choix de la classe. Absent, tout est montré : une publication faite avant ce
réglage ne doit pas se retrouver amputée. Une liste vide, en revanche, veut
dire « seulement l'heure et l'intitulé » — c'est un choix délibéré, et le
distinguer de l'absence évite de le confondre avec un oubli.

Retirer une colonne ne laisse pas de trou : la mise en page la fait
disparaître et l'intitulé prend la place.

### Ce qui ne tient pas sur un mur

Le premier jet versait le commentaire de séance dans la pastille réservée aux
mentions « salle changée ». Un commentaire de deux lignes s'y déployait et
poussait le reste de la journée hors de l'écran.

Le commentaire ne rejoint donc la précision que s'il tient sur une ligne.
L'information complète est dans NetYPareo, pas sur un mur de couloir.

### L'écran refuse un emploi du temps qui n'est pas celui du jour

La fraîcheur mesurée ne suffit pas, et c'est un piège que le cache crée
lui-même. Quand NetYPareo tombe, le serveur ressert la dernière journée
connue — **avec un 200**. L'agent la reçoit donc comme une donnée fraîche, et
la politique de péremption ne se déclenche jamais. Une panne pendant la nuit
afficherait le lendemain matin la journée de la veille, présentée comme celle
du jour.

La journée porte sa date. Le réalisateur la compare à la date du jour dans le
fuseau de l'école — pas celui du boîtier, qu'un mauvais réglage rendrait faux
— et retire la colonne si elle ne correspond pas. C'est le seul cas où
l'écran doit préférer ne rien montrer : un cours faux envoie quelqu'un dans
la mauvaise salle, à la mauvaise heure.

Le reste de l'écran ne tombe pas pour autant : la colonne se retire, la zone
principale s'étire.

### Les rendez-vous individuels

L'afficheur mêle aux groupes des séances dont l'intitulé est un **nom de
personne** — des rendez-vous individuels. Les afficher en clair dans un
couloir est une décision qui appartient à l'établissement, pas au logiciel.
La console les repère et les signale avant qu'on branche la source ; c'est
dans NetYPareo qu'on les exclut de l'afficheur.

## La console, refaite pour des gens dont ce n'est pas le métier

### Le mur d'écrans est la page d'accueil

On arrive sur ce que chaque écran affiche **en ce moment**, à l'échelle. C'est
le seul repère qui vaille : on reconnaît son couloir à ce qu'il montre, pas à
un numéro de version. Cliquer sur une vignette ouvre l'écran.

Ce ne sont pas des captures. C'est le vrai moteur de rendu, alimenté par le
manifeste réellement publié et par les mêmes sources vivantes. Ce qu'on voit
là est ce qui est là-bas.

Le rendu est dessiné à sa taille réelle — 1280 × 720 — puis réduit par une
transformation. Le composer petit donnerait des tailles de texte fausses : le
noyau calcule ses échelles typographiques sur la hauteur de la dalle, et une
miniature de 320 px afficherait des titres qu'aucun écran de couloir ne
produira jamais.

**Un piège qu'il a fallu corriger** : les manifestes portent l'adresse par
laquelle les ÉCRANS joignent le serveur, souvent une IP. La console qui les
rejouait telles quelles se heurtait au blocage d'origine croisée, et ses
aperçus montraient des colonnes vides là où les dalles en montrent de
pleines — l'aperçu mentait précisément là où l'on compte sur lui. Le serveur
qui sert la console étant celui qui sert les connecteurs, on garde le chemin
et on jette l'origine.

### Une chose à la fois

Le mur, ou un écran — jamais les deux. La liste, l'éditeur, l'historique et
les actions affichés ensemble donnaient une page dont on ne savait par où
l'attaquer.

### La charte du campus, sur clair

La console reprend le bleu de la CCI. Clair, à l'inverse des dalles : ce ne
sont pas les mêmes usages. Une dalle se regarde de loin dans un couloir
parfois sombre ; une console se pilote de près sur un bureau éclairé, par des
gens habitués aux logiciels de bureau et non aux consoles techniques.

Le bleu du campus, `#11A6C4`, ne fait que **2,89:1 sur blanc** — trop peu pour
du texte, qui demande 4,5. Il reste donc la couleur des aplats, et le texte
prend `#0A7B92`, la même teinte assombrie, à 4,93:1. L'identité tient à la
teinte, pas à la luminosité, et personne ne doit plisser les yeux pour lire un
libellé. Même raisonnement pour les boutons pleins : du blanc sur le bleu vif
donnerait aussi 2,89.

### Ce qui a changé dans les mots

Les titres de panneaux étaient en petites capitales espacées : ça se déchiffre,
ça ne se lit pas. Les étiquettes de champ aussi. Les deux sont revenues à la
taille du texte, dans l'encre normale — ce sont des questions posées à
quelqu'un, pas des en-têtes de tableau.

Les onglets suivent ce qu'on fait, du plus fréquent au plus rare : « Mes
écrans », « Changements du jour », « Emploi du temps », puis les réglages.

### Le rouge au survol, pas au repos

Trois boutons rouges en permanence faisaient croire à un panneau dangereux et
poussaient à ne plus rien toucher. Les actions qui laissent un couloir noir se
signalent maintenant au survol ; la vraie garde est la confirmation qui suit,
et celle-là, on la lit.

## Trois mises en page, et une image qu'on ne coupe pas

`plein-ecran` — les contenus occupent la dalle.
`principal-et-cours` — les contenus sur deux tiers, l'emploi du temps à droite.
`emploi-du-temps` — l'emploi du temps seul, en grand.

La troisième est celle d'un hall où l'on cherche une salle. Y glisser des
affiches réduirait le texte que les gens sont précisément venus lire. Elle n'a
donc **aucune zone principale** — pas une zone vide que le rendu replierait,
mais pas de zone du tout, sans quoi la colonne des cours resterait à un tiers
de la dalle.

Le composeur a d'ailleurs refusé le premier jet : il revalide sa propre sortie,
et une programmation visait encore la zone principale supprimée. C'est le
genre d'erreur qui, sans cette revalidation, se serait découverte sur un écran
posé à quatre mètres de haut.

### L'image tient en entier par défaut

Une affiche est faite pour une dalle entière. Posée dans une colonne de deux
tiers, `object-fit: cover` lui coupe les côtés — et c'est le titre qui part en
premier : « SAMEDI 12 SEPTEMBRE » devient « EDI 12 SEPTEMBRE ». Personne ne
s'en aperçoit avant de passer devant l'écran.

Le défaut est donc `contain` : l'image tient en entier, quitte à laisser des
bandes. Perdre du texte est pire qu'une bande de fond. Chaque contenu porte un
bouton « Entière / Remplit » pour ceux qui veulent le bord à bord — une photo
d'ambiance, un fond.

### Une liste se lit du haut

Centrée verticalement, une journée entière laissait deux grandes bandes vides
sur une dalle et l'oeil cherchait où commencer.

## Ce qui n'est pas encore fait

Le socle tourne, mais il reste volontairement incomplet :

- **La réinitialisation par courriel** — un mot de passe perdu se fait
  remplacer par un administrateur, de vive voix. Le serveur n'envoie aucun
  message.
- **Les campagnes partenaires** — la part de contenu sponsorisé dans une
  rotation est prévue au manifeste, rien ne la pilote ni ne la mesure.
- **Le plan interactif** — la console liste les écrans, elle ne les situe pas
  encore sur un plan d'étage.
- **TLS** — les échanges ne sont pas chiffrés en développement. La signature
  authentifie l'appareil, elle ne protège pas la confidentialité.
- **URL signées** — les médias sont servis sans signature ni expiration.
- **Les autres coques** — Android et Electron restent à écrire. La coque
  Linux existe et sert de référence : elles n'ont qu'à implémenter `ports.ts`.
- **Les gabarits** — le rendu n'en connaît que la forme générale (bandeau,
  titre, texte). La bibliothèque annoncée au cahier des charges reste à faire.
- **Les images d'actualités hors connexion** — le texte des articles survit à
  une coupure, les illustrations non : elles sont chargées à l'affichage
  plutôt que mises en cache par l'agent.
- **Les groupes d'écrans** — on publie écran par écran. Publier sur « tout le
  bâtiment B » d'un geste reste à faire.
- **Les preuves de diffusion** — la télémétrie les remonte et les conserve,
  aucun rapport ne les exploite encore.
- **Les vues par salle ou par enseignant** — l'emploi du temps s'affiche par
  bâtiment ou par classe, pas encore « où est M. Untel ».


---

## Le noyau de rendu

Même découpage que l'agent, et pour la même raison : **la décision est pure,
l'application est bête.**

`direct()` reçoit un manifeste, une heure, l'état des sources de données et
ce qui est réellement en cache. Il renvoie un `ScreenState` — la description
complète de ce qui doit être à l'écran — plus les transitions de diapositives,
qui alimenteront les preuves de diffusion.

La couche `dom/` applique cette description. Elle ne décide de rien et ne
remplace un nœud que si la diapositive a réellement changé : un Raspberry Pi
qui refait tout son DOM chaque seconde chauffe pour rien.

### Ordre de priorité des modes

```
urgence  >  repérage  >  extinction programmée  >  repli  >  rotation normale
```

L'urgence passe avant l'extinction : elle rallume l'écran. Une urgence dont
la fenêtre de validité est dépassée est ignorée — un écran rallumé trois jours
plus tard ne doit pas afficher une alerte incendie périmée.

### Ce que le rendu impose sans qu'on le lui demande

| Règle | Pourquoi |
|---|---|
| Durée minimale calculée sur le volume de texte (130 mots/minute + 2,5 s) | on compose assis à 50 cm, on lit debout à 4 m en marchant |
| Taille de texte dérivée de la hauteur de la dalle | la même mise en page tient en 1080p et en 4K sans être refaite |
| Zones vides retirées, voisines étirées | quand l'emploi du temps se périme, on ne laisse pas un tiers de dalle vide |
| Diapositive non diffusable sautée | un média pas encore en cache ne bloque pas la rotation |
| Donnée périmée affichée avec sa date, ou retirée | un écran ne doit jamais laisser croire qu'une info est fraîche |

### Sans framework, délibérément

Du DOM et du CSS, rien d'autre. Ce code doit tourner dans le WebView d'un
boîtier Android à 60 €, dans une application Tizen et dans Chromium sur un
Raspberry Pi. Un framework y ajouterait du poids, une surface de compatibilité
et une dépendance à maintenir pendant toute la vie du parc.
