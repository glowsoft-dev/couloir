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

## Poser un boîtier, depuis la console

Entre « j'ai un Raspberry Pi dans un carton » et « il affiche quelque chose »,
il n'y avait rien qu'une personne n'ayant pas lu le dépôt sache franchir. Un
assistant en quatre étapes comble le trou : matériel, carte, installation,
emplacement.

### Le serveur sert son propre installateur

`GET /installer.sh` rend le script avec **l'adresse du serveur déjà inscrite**,
et `/telechargements/…` sert le lecteur déployable. Poser un écran devient une
commande à recopier.

Sans ça il faudrait construire un artefact sur un poste de développement, le
copier sur une clé, et retaper une adresse à la main devant un écran — trois
occasions de se tromper, dont une silencieuse. Servir le lecteur depuis le même
endroit garantit en prime que serveur et boîtiers ne peuvent pas se
désynchroniser.

Les téléchargements sont sur liste blanche : deux noms de fichiers, rien
d'autre. Une route qui servirait un chemin quelconque exposerait le disque.

### L'assistant attend le boîtier

C'est ce qui change tout pour qui n'est pas informaticien : l'étape « lancer
l'installation » surveille l'arrivée d'un nouveau venu et passe à la suite
toute seule. On n'a pas à savoir si ça a marché — l'écran le dit.

Un boîtier qui attendait **déjà** est proposé aussi. L'ignorer obligerait à
débrancher et rebrancher pour la seule raison qu'on a ouvert l'assistant trop
tard. Mais on ne saute pas d'étape pour lui : ce serait bousculer quelqu'un au
milieu de sa lecture.

### L'adresse, qui échoue en silence

Un serveur configuré sur `localhost` produit une commande qui s'exécute sans
erreur et un boîtier qui ne joindra jamais rien. L'assistant vérifie l'adresse
et le dit **avant** la pose, plutôt que de le laisser découvrir devant un écran
monté à quatre mètres. Il signale aussi l'absence de TLS : acceptable sur le
réseau interne d'un établissement, à corriger avant toute exposition.

### Deux défauts trouvés en cliquant

Le message de réussite disparaissait une seconde après le rattachement : celui-ci
retire le boîtier de la liste d'attente, le formulaire se démontait donc, et le
message partait avec lui. L'état vit maintenant dans l'assistant.

Le code d'étiquette était fixé à `01`, ce qui faisait échouer la pose du
deuxième écran d'un même palier — et l'erreur parlait d'un code que personne
n'avait choisi. Le prochain numéro libre est calculé, et **annoncé avant** de
valider. Il comble par le haut, jamais par le milieu : réutiliser un numéro
libéré ferait réapparaître un code que quelqu'un a peut-être noté sur un plan.

## L'éditeur d'écran

### La page d'un écran : trois griefs, trois réponses

**On composait à l'aveugle.** L'aperçu était au bas d'un long formulaire, donc
hors de vue pendant tout le travail : on découvrait le résultat après coup et
on remontait corriger. Il passe à gauche, et il colle — le rendu réel reste
sous les yeux pendant qu'on modifie.

**Publier demandait de dérouler la page entière.** Le bouton suit désormais
l'aperçu, avec l'état à côté : « version 4 en ligne », « modifications non
diffusées ». On voit ce qu'on va faire et on peut le faire, au même endroit.

**Tout se ressemblait.** Des cadres blancs bordés, empilés, de même poids
visuel qu'on soit en train de changer une affiche ou de consulter
l'historique. L'éditeur est devenu **une seule surface** : ses sections se
séparent par une règle fine et de l'air, pas par un cadre de plus. Historique
et actions sur le boîtier — utiles, rarement — descendent au pied de cette
surface au lieu d'occuper une colonne entière.

Deux redondances retirées au passage. Le titre « Aperçu avant publication »
sur une page qui ne montre que ça : il dit maintenant **« Le rendu réel »**,
parce que c'est bien le moteur de l'écran qui tourne là et pas une imitation.
Et la phrase d'explication en dessous, qui occupait deux lignes à chaque
visite pour une chose qu'on apprend une fois, est devenue une infobulle.

### Trois volets plutôt qu'un long formulaire

**Contenu** — la bibliothèque, ce qui tourne, le bandeau, les actualités.
**Journée** — les tranches horaires.
**Réglages de l'écran** — la mise en page, l'emploi du temps, l'extinction, le
contenu par défaut.

On ne cherche pas la même chose selon qu'on change une affiche, qu'on programme
une journée ou qu'on règle l'écran une fois pour toutes. Le formulaire unique
obligeait à parcourir les trois pour en atteindre un.

### La vue jour n'est pas un mécanisme de plus

On glisse une affiche dans un créneau, et elle ne paraît qu'à ce moment-là.
C'est **la même donnée** que la période d'affichage réglée dans l'onglet
Contenu : une autre façon de l'éditer, pas un autre modèle. Modifier l'une se
voit immédiatement dans l'autre, parce qu'il n'y a rien à synchroniser.

Le repère suit le curseur pendant le glissé et affiche l'heure : on dépose à
une heure, pas à un endroit. Les minutes s'arrondissent au quart d'heure —
personne ne programme une affiche à 10 h 07.

Les contenus sans horaire restent visibles à part, sous « toute la journée » :
ils tournent en continu. Les ignorer aurait laissé croire qu'un écran sans
bloc programmé n'affiche rien.

### Le contenu par défaut, distinct du repli

`fallbackPlaylistId` dit « je n'ai plus de contact avec le serveur » — c'est la
carte d'identité de l'écran, et elle rassure celui qui passe devant.
`defaultPlaylistId` dit « personne n'a rien prévu à cette heure-ci » :
l'établissement choisit alors ce qu'on voit, une affiche d'accueil ou les
salles du jour.

Confondre les deux ferait afficher une carte d'identité là où l'école a choisi
une affiche. Le défaut passe donc par la rotation habituelle — il peut compter
plusieurs diapositives, et il n'y a pas de raison qu'elles ne tournent pas — et
ne porte jamais de période : il ne serait pas un défaut s'il pouvait lui-même
disparaître.

Quand le défaut est l'emploi du temps, il réutilise la source que la mise en
page monte déjà. Deux sources identiques feraient deux appels réseau par écran
pour la même journée.

## Publier sur plusieurs écrans

Une affiche se pose sur cinq couloirs en un geste, au lieu de cinq passages
dans l'éditeur. On coche les écrans sur le mur, une barre apparaît, on choisit
le contenu.

### Chaque écran garde ses réglages

C'est la règle qui donne son sens au geste. La mise en page, l'afficheur
d'emploi du temps, les colonnes de la colonne des cours, l'heure d'extinction
et le contenu par défaut appartiennent à l'**écran**, pas au contenu. Une
publication groupée ne remplace que la rotation.

Les écraser reviendrait à reconfigurer cinq écrans pour publier une image — et
personne ne s'en apercevrait avant de passer devant. Vérifié : un écran réglé
en « emploi du temps seul » garde sa mise en page quand une affiche part sur
lui et deux autres.

### Un refus n'arrête pas les autres

Chaque écran est composé pour lui-même, et une composition impossible sur l'un
— une mise en page qui réclame une source absente — ne doit pas priver les
autres. On publie ce qu'on peut, et on rend le détail écran par écran :
« B·1·01 v5, C·0·01 v3, D·0·02 — cet afficheur n'existe plus ». Tout annuler
pour un seul écran en défaut serait pire.

## L'éditeur qui part du contenu

Le handoff explore deux directions et retient les deux : on entre par le parc
d'écrans, on édite comme si l'on partait du contenu.

### La bibliothèque en colonne, et où passe chaque média

Elle ne défile plus avec le reste : on y pioche en composant, et la faire
suivre obligeait à remonter à chaque ajout.

Surtout, chaque média dit **où il passe** — « sur 3 écrans », « nulle part ».
C'est l'information qui manquait : sans elle on ne sait pas si retirer une
affiche va vider un couloir, ni lesquels des trente fichiers importés depuis
septembre servent encore. Le compte se calcule sur les manifestes déjà
chargés pour le mur, sans une requête de plus.

### « Où ça part » : la conséquence, pas le nom

L'écran ouvert est coché et ne se décoche pas — on est venu le modifier. Les
autres s'ajoutent, et chacun dit ce que la publication lui fera : « muet
depuis 14 min, recevra à son retour », « garde sa mise en page », « ne
changera pas ».

Écrire la conséquence plutôt que le seul nom, c'est la différence entre
cocher une case et savoir ce qu'on fait. Le bouton suit : il devient
« Diffuser sur 2 écrans ».

Un cas à part, qui se lisait mal : un boîtier jamais vu affichait « muet
depuis jamais vu ». Il dit maintenant « ne s'est jamais annoncé, recevra à sa
première connexion ».

## La page d'entrée

Une dalle à gauche sur 790 px, le formulaire à droite. Ce n'est pas un
ornement : la console pilote des écrans qu'on ne voit pas depuis le bureau, et
montrer à quoi ils ressemblent dès l'entrée dit de quoi il est question — à
qui ouvre l'outil pour la première fois comme à qui s'y connecte tous les
matins.

Elle reprend les vraies couleurs et la vraie police du rendu, pas une
imitation approximative qui apprendrait quelque chose de faux. L'horloge
tourne : figée, elle se remarquerait tout de suite.

### Le nom de l'établissement avant la connexion

Il fallait le rendre lisible sans être authentifié. La route d'amorçage — déjà
publique, puisqu'elle dit s'il faut se connecter ou créer le premier compte —
porte donc aussi le nom et la couleur d'accent.

Il n'y a pas à hésiter : ce nom est écrit en grand sur chaque écran de chaque
couloir. Le taire à la page d'entrée ne protégerait rien et donnerait une
console qui ne sait pas chez qui elle est.

### La première installation montre autre chose

À ce moment-là il n'y a pas encore d'écran, et l'établissement n'a pas de nom.
La dalle cède la place à ce qu'on s'engage à tenir — un écran débranché garde
son contenu, une urgence prend tous les écrans, la console ne s'ouvre jamais
par défaut. Trois points, pas dix : ce sont ceux qu'on vérifiera.

## Les changements du jour

L'écran de tous les matins. Une colonne de cours à gauche, ce que les élèves
liront à droite. Les classes sont des puces qu'on frappe, avec le nombre de
changements déjà posés — c'est ce qu'on cherche du regard en arrivant. Le
formulaire s'ouvre DANS la ligne du cours : on garde sous les yeux l'heure et
les cours voisins, et on ne perd jamais de vue lequel on modifie.

### L'aperçu passe par le vrai noyau de rendu

Il était dessiné à la main en HTML de console. Une imitation dérive : le jour
où la colonne change de typographie ou de mention, l'aperçu montre encore
l'ancienne — et c'est précisément quand on relit une faute de frappe qu'il ne
faut pas mentir.

La page fabrique donc un manifeste minuscule — une zone, une source, une
diapositive d'emploi du temps — et le donne au noyau, comme le mur d'écrans.
Deux ajustements ont été nécessaires :

- **Un instant figé.** Le noyau écarte un emploi du temps dont la date n'est
  pas celle du jour, à raison : une colonne périmée envoie quelqu'un dans la
  mauvaise salle. Regarder demain suppose donc de lui donner demain comme
  instant, midi, loin des bascules de fuseau.
- **La donnée est datée de cet instant-là.** Sinon, regarder vendredi fait
  paraître la journée vieille de trois jours et l'aperçu porte un « mis à jour
  mardi » qui ne dit rien de ce vendredi.

Un instant figé n'a pas d'horloge, ce qui a fait apparaître un défaut : la
vignette ne se redessinait qu'une fois, avant l'arrivée des données. Elle
redessine maintenant à chaque source reçue, et un compteur la fait relire la
journée après chaque saisie — sans quoi on annule un cours et la dalle
continue de l'afficher pendant cinq minutes.

### Où ça s'affiche

La question paraît anodine. Elle ne l'est pas : on signale une absence et on
veut savoir où elle va paraître. La règle se lit dans les réglages saisis, pas
dans le manifeste, où les classes ont déjà été résolues en diapositives — on
ne saurait plus y distinguer « cette classe » de « toutes les classes
défilent ».

Elle dit aussi ce qui est plus important que la liste : **un écran branché sur
NetYPareo ne verra jamais ce qu'on saisit ici.** Le composeur ne mélange pas
les deux sources ; dès qu'un afficheur est choisi, les classes locales ne sont
plus montées. Taire ça laisserait croire à une absence signalée alors qu'elle
ne l'est pas.

### Un cours annulé n'a plus de salle

Le rendu affichait encore la salle d'un cours annulé. Elle est remplacée par
un tiret : continuer à l'annoncer envoie quelqu'un devant une porte fermée,
c'est-à-dire exactement le trajet que la mention « annulé » existe pour
éviter.

### La console n'était pas vérifiée

Elle n'entre pas dans `tsc --build` — elle n'émet rien — et Vite la transpile
sans regarder les types. Deux erreurs de type y vivaient donc tranquillement,
dont un champ que le client lisait sans l'avoir déclaré. Son script de
construction lance maintenant `tsc --noEmit` d'abord, et l'intégration
continue le lance en construisant la console.

## L'emploi du temps

Une année scolaire, c'est plusieurs centaines de cours à saisir. Tout est
réglé pour que ça reste supportable : on clique une case, on tape trois
champs, on valide, et la case suivante est déjà prête. Le raccourci qui change
tout — **« Aussi ces jours-là »** — pose la même matière au même créneau sur
plusieurs jours d'un coup, une matière revenant rarement une seule fois par
semaine. Les cases déjà prises sont laissées telles quelles : le raccourci
ajoute, il n'écrase jamais.

La quinzaine passe d'une liste déroulante à trois boutons. On la relit en
corrigeant, et une liste fermée oblige à l'ouvrir pour savoir ce qu'elle dit.

### La table reste une table

Le dessin aurait été le même avec une grille de `<div>`. Mais un lecteur
d'écran ne dirait plus « mardi, M3 » en arrivant sur une case, et la grille
deviendrait illisible autrement qu'à l'œil. Les en-têtes portent leur `scope`,
et chaque case porte son nom complet — jour, créneau, matière, salle.

### D'où vient ce que les couloirs affichent

Une pastille le dit : *alimenté à la main*, ou *alimenté par NetYPareo*. La
seconde est en ton d'avertissement, parce qu'elle change tout — quand un
logiciel externe alimente les écrans, cette grille ne les atteint plus, et
personne ne devrait y saisir une année pour rien.

### Le jour où l'on est

La colonne du jour porte l'accent. C'est le seul repère dans une semaine de
cases qui se ressemblent toutes, et la case ouverte porte un liseré : sans
lui, on corrige un cours en croyant en corriger un autre.

## La journée d'un écran

On glisse une affiche dans un créneau, et elle ne paraîtra qu'à ce moment-là.
C'est la même donnée que la période d'affichage réglée ailleurs — une autre
façon de l'éditer, pas un autre mécanisme.

Trois choses que la chronologie ne disait pas, et qui se voyaient à l'usage :

### Deux affiches qui se croisent se cachaient

La seconde recouvrait la première, qu'on ne pouvait plus ni lire ni attraper.
Elles se partagent maintenant la largeur. La largeur se compte **par grappe**
de plages qui se touchent, et non sur toute la journée : deux affiches le
matin et deux l'après-midi font deux colonnes partout, pas quatre.

### Où en est la journée

Un trait de « maintenant » traverse la chronologie. Sans lui, on programme une
affiche pour « tout à l'heure » sans voir qu'il est déjà passé.

### Et après ?

Une phrase sous la chronologie dit ce qui prend la main une fois le dernier
contenu terminé, et à quelle heure la dalle s'éteint. Elle est calculée à
partir des réglages réels de l'écran — contenu par défaut, contenus sans
horaire, plages d'extinction. Un trou n'est pas une erreur, mais encore
faut-il le dire : sinon on remplit la soirée d'affiches pour rien.

Elle se tait quand rien n'est programmé — une autre phrase le dit déjà, et
deux messages qui disent la même chose finissent par se contredire.

### Un créneau court cachait ses propres commandes

Une demi-heure fait vingt pixels : la vignette et les deux heures passaient
sous le bloc voisin, hors d'atteinte. En dessous d'une heure et demie, le bloc
se met sur une ligne et perd sa vignette ; et tout bloc a un plancher de
34 px. Il exagère un peu la durée — les heures exactes sont écrites dedans, et
un réglage hors d'atteinte coûte plus cher qu'un bloc légèrement trop grand.

## Les réglages d'un écran

Ce qu'on pose une fois : mise en page, colonnes de l'emploi du temps,
extinction, contenu de repli. Chacun dans sa carte, avec la phrase qui dit ce
qu'il fait. L'empilement de champs nus qui précédait obligeait à publier pour
savoir ce qu'on venait de choisir.

### La mise en page se montre au lieu de se décrire

Une liste déroulante disait « Vos contenus + l'emploi du temps à droite » et
il fallait la croire sur parole. Trois schémas au format de la dalle montrent
où va quoi, **dans les proportions du composeur** — deux tiers, un tiers — et
non dans des proportions inventées pour la vignette.

Ce ne sont pas des aperçus : aucun contenu n'y figure. C'est le découpage
qu'ils montrent, et rien d'autre. L'aperçu réel est à côté, et lui joue le
vrai rendu.

### Les sept jours en carrés

L'extinction se lit d'un coup d'œil : les jours actifs sont pleins. Une ligne
de cases à cocher demandait de relire les libellés un à un.

La phrase qui suit chaque plage reste la même, et reste nécessaire : les jours
désignent le soir où la plage COMMENCE, si bien qu'une extinction du vendredi
soir court jusqu'au samedi matin. Sans elle on cherche pourquoi un écran est
noir un samedi à 7 h.

### Les actions dangereuses sur leur propre rangée

Mêlées aux autres, on cherchait « Capturer » entre « Redémarrer » et
« Éteindre la dalle » — et on cliquait à côté. Elles ont maintenant leur
rangée, et la phrase qui la suit dit pourquoi : elles laissent un couloir
noir. Les confirmations, elles, étaient déjà là et ne portent que sur ces
trois-là — une confirmation posée partout ne se lit plus nulle part.

## Les réglages de l'établissement

Un rail plutôt qu'un empilement. Sept panneaux à la file obligeaient à
dérouler toute la page pour trouver les vacances, et à se souvenir de l'ordre.
Cinq sections nommées se choisissent d'un coup d'œil, et chacune dit en une
phrase à quoi elle sert.

### Cinq sections, pas six

Le handoff en dessine six, en séparant « Grille horaire » de « Classes ». Ils
sont réunis : on définit les créneaux, puis les groupes qui les remplissent —
c'est un seul geste, et deux destinations en auraient fait deux allers-retours.
La maquette elle-même intitule sa page « Grille horaire et classes ». Même
raison pour l'année et les vacances, qui se saisissent le même jour.

### Ce qui reste tel quel

Le titre de section et l'en-tête de la carte se répètent un peu quand la
section n'en contient qu'une — « Identité », puis « Identité de
l'établissement ». On le laisse : cet en-tête porte aussi l'état de la source
(*éteinte*, *active*), et le retirer priverait la carte de son nom pour un
lecteur d'écran. Une redondance douce coûte moins qu'un titre manquant.

## L'emploi du temps externe

NetYPareo expose des « afficheurs planning », faits pour des écrans de
couloir. On s'y branche plutôt que de ressaisir : deux saisies finissent
toujours par diverger, et c'est l'écran qui a tort.

Le branchement à gauche, ce qu'il donnerait à droite. Corriger un numéro
d'afficheur en gardant sous les yeux la journée qu'il ramène évite le
va-et-vient — et c'est là qu'on voit ce qui ne devrait pas partir.

### Le contrôle qui compte

NetYPareo mêle aux groupes des rendez-vous individuels — un entretien de
suivi, un bilan — et l'intitulé de la séance est alors **le nom de l'élève**.
Diffusé tel quel, il s'affiche en clair dans un couloir passant.

L'aperçu le signale avant qu'on branche : combien de séances, et qui. Il ne
filtre rien — la décision revient à l'établissement, et NetYPareo sait exclure
ces séances à la source.

Le repérage penche volontairement vers l'alerte de trop. Un intitulé de
formation tout en majuscules et sans chiffre serait signalé à tort ; on le
lit, on hausse les épaules, on passe. L'erreur inverse laisserait le nom d'un
élève sur un mur.

Il est éprouvé sur les intitulés que l'afficheur du campus a réellement
servis — les quatre noms qu'il portait ce jour-là, et les trois intitulés de
formation qu'il ne doit pas confondre avec eux. C'est le seul jeu d'essai qui
vaille pour une heuristique : elle n'a pas à être élégante, elle a à trier
CES intitulés-là.

## Les comptes et le journal

Qui peut quoi, et qui a fait quoi. La liste et le journal à gauche, le
formulaire d'ajout à droite : on crée un compte en regardant ceux qui
existent, ne serait-ce que pour ne pas doubler quelqu'un.

### Les trois rôles se choisissent en les comparant

Une liste déroulante ne montrait la description qu'après le choix — trop tard.
Les trois sont posés côte à côte, chacun avec ce qu'il permet. Le rôle est la
seule décision de cette page qui se prenne mal sans savoir.

### Deux corrections d'écriture

Le journal enregistre les connexions ; sa phrase d'explication ne les
mentionnait pas, et énumérait une liste fermée qui les excluait. Elle le dit
maintenant, et pourquoi : c'est la seule trace qui dise qu'un compte oublié
sert encore.

« Ne s'est jamais connecté » devient « aucune connexion à ce jour ». La
première tournure devait accorder au genre d'une personne réelle, que la
console ne connaît pas et n'a pas à deviner.

## La bibliothèque

Elle existait en colonne dans l'éditeur, où elle sert à composer. La page
entière répond à la question inverse : non pas « qu'est-ce que je mets sur cet
écran », mais « qu'est-ce qui traîne dans le serveur, et est-ce que ça passe
quelque part ».

### Où passe chaque média

C'est la seule colonne qui compte. La bibliothèque grossit d'une affiche de
portes ouvertes, de sa version corrigée et de celle de l'an dernier — sans ce
compte, plus personne n'ose rien retirer. L'infobulle nomme les écrans.

On lit les compositions saisies et non les manifestes : le manifeste a déjà
résolu le contenu par défaut en diapositive, et on ne distinguerait plus « il
tourne dans la rotation » de « il attend qu'il n'y ait rien d'autre ». Les
deux comptent — un média qui ne sert que de repli passe quand même dans le
couloir.

### Les dimensions viennent du navigateur

Elles ne sont pas stockées, et les probes côté serveur auraient demandé un
décodeur d'images. Le navigateur vient de charger la vignette : il connaît
déjà `naturalWidth`. C'est exact et ça ne coûte rien.

C'est ce qui fait voir qu'un fond d'écran de 9 000 pixels de large occupe à
lui seul l'essentiel de la bibliothèque.

### Pas de suppression

Le serveur n'expose pas de route pour retirer un média, et on n'en ajoute pas
ici : supprimer un fichier référencé par un manifeste en ligne laisserait un
écran devant une adresse morte. La page dit ce qui ne passe nulle part ; la
suite est une décision, pas un bouton.

## L'historique des publications

Revenir en arrière ne réécrit rien : on republie l'ancien contenu sous une
nouvelle version. L'historique reste une suite de faits — « on est revenu à ce
contenu tel jour » — plutôt qu'un état qu'on remonterait en effaçant ce qui
s'est passé. C'est ce qui permet d'annuler une annulation.

### De quoi choisir

Il disait « v4, hier à 16:41 ». Devant trois versions d'une même journée, ça
ne dit pas laquelle remettre en ligne. Chaque ligne porte maintenant qui l'a
posée et ce qu'elle contenait.

Le contenu se relit dans le document déjà enregistré — rien à stocker de plus.
On compte les diapositives de la rotation, en retirant les colonnes de cours
et le bandeau : sinon « 5 contenus » désignerait deux affiches et trois
classes. Et en retirant le repli, que le composeur remplit lui-même de la
carte d'identité de l'écran : la compter faisait dire « 2 contenus » à une
publication qui en portait un.

L'auteur, lui, n'était nulle part. Le journal le sait, mais il est réservé aux
administrateurs — aller l'y chercher aurait fait sortir une donnée de sa
frontière. Une colonne sur la ligne du manifeste : « ce contenu a été publié »
et « par qui » sont le même fait. Elle est nulle pour les versions
antérieures, qui ne prétendent donc pas avoir d'auteur.

### L'avertissement avant, pas après

« Remettre une version en ligne en crée une nouvelle » était écrit sous la
liste. Il lève une hésitation : il doit être lu au moment où on hésite.

### Un retour en arrière refermait l'historique

Republier remonte l'éditeur tout entier, et l'historique s'y refermait avec
lui : on cliquait « Remettre en ligne » et le panneau disparaissait sans rien
confirmer. Il se rouvre sur la version qui vient d'être créée — c'est
exactement ce qu'on voulait vérifier. Le compteur qui le déclenche est remis à
zéro en changeant d'écran : un retour fait sur le hall ne déplie pas
l'historique du CDI.

## Une urgence en cours

Le bandeau passe en haut du rail, et non en bas près du bouton qui la
déclenche. Une urgence n'est pas une action : c'est l'état dans lequel se
trouve l'établissement, et il doit être la première chose lue, quelle que soit
la page ouverte.

Il dit **qui** l'a déclenchée, **quand**, et **sur combien d'écrans**. Le
« qui » n'est pas décoratif — on cherche à qui demander avant de lever une
évacuation. Le compte non plus : un écran posé après le déclenchement, ou qui
n'a jamais rien reçu, ne la porte pas, et le taire laisserait croire que tout
le parc l'affiche.

### Publier effaçait l'urgence

Le composeur ne connaît pas les urgences : il compose ce qu'on lui donne.
Publier pendant une évacuation produisait donc un manifeste sans message, et
**un couloir cessait de l'annoncer** — sans que personne l'ait demandé ni le
voie.

Le serveur reporte maintenant le message sur la nouvelle version, sauf s'il a
expiré : un écran republié trois jours plus tard ne doit pas ressusciter une
alerte périmée. Et la console grise « Publier » pendant ce temps, avec la
raison écrite — l'alerte couvre tout, publier ne changerait rien à ce que
montrent les couloirs.

### Une urgence faisait perdre la composition

Poser puis lever une urgence crée deux versions de plus, écrites sans
composition saisie. L'écran continuait d'afficher le bon contenu, mais
l'éditeur s'ouvrait vide devant lui et proposait d'« ajouter au moins un
contenu » alors qu'il en diffusait trois. La composition est reportée avec le
manifeste.

## Le premier jour

Aucun écran posé. La page montrait l'en-tête habituel, ses compteurs à zéro et
un mur vide : on ne savait pas par où commencer. Elle tient maintenant sa
propre page — une dalle dessinée, une phrase, un bouton.

La dalle montre ce que le boîtier affichera : un code, et **l'adresse à
laquelle il s'est annoncé**, lue du serveur et non inventée. C'est la seule
chose qu'on aura à recopier, et la voir d'avance évite de croire à une panne
devant un écran qui ne montre « que » ça.

La durée annoncée — une vingtaine de minutes, dont quinze d'attente — évite
d'interrompre l'installation au bout de cinq en croyant que ça a échoué.

Les boîtiers déjà annoncés passent avant : il y a alors quelque chose à faire
sur le mur lui-même.

## La lecture seule

Ce que voit la direction : tout, sans un seul bouton qui refuse.

Le rail se réduit à ce qu'on consulte, et la page d'un écran cesse d'être un
éditeur. On y montrait pourtant l'éditeur complet, dont chaque bouton se
serait fait refuser par le serveur — un bouton qui refuse est pire qu'un
bouton absent.

Ce qui reste est ce qui répond à la question posée : le rendu réel, l'état du
boîtier, l'emplacement, et la dernière publication avec son auteur. Une
mention en tête de mur dit une fois pourquoi le reste manque : le chercher
sans le trouver coûte plus cher que de le lire.

### Deux corrections au passage

« Ne répond plus depuis jamais vu » devient « ne s'est pas encore annoncé ».
Un boîtier fraîchement rattaché n'est pas en panne, et la première tournure
faisait chercher une panne qui n'existe pas.

Poser ou lever une urgence crée une version que personne ne signait. C'est
pourtant l'action de quelqu'un : elle lui est maintenant attribuée, comme une
publication.

## La rotation en vignettes

La rotation est une suite d'images. En rangées, on relisait douze noms de
fichiers pour retrouver l'affiche à retirer — et « affiche-po-2026 » ne dit
pas de quoi elle a l'air. Chaque contenu est maintenant une vignette qui
montre ce qui passera, avec son rang lu par-dessus : c'est l'ordre de passage
qu'on vérifie du regard, et une colonne à part le repoussait hors du champ.

Un texte se prévisualise comme il paraîtra — sur le fond des dalles, dans leur
police. Il n'avait qu'un champ de saisie, et rien ne disait à quoi il
ressemblerait en grand dans un couloir.

### Deux par rangée dans l'éditeur, davantage ailleurs

La grille suit la place disponible. Dans l'éditeur, la bibliothèque et
l'aperçu occupent deux colonnes : il en reste pour deux vignettes de 190 px.
Les rétrécir en donnerait trois, trop petites pour reconnaître une affiche et
trop étroites pour la durée, l'ajustement et la période. C'est la largeur qui
décide, et elle décide bien.

### La bibliothèque était affichée deux fois

Une fois dans la colonne de gauche, une fois dans le volet « Contenu » : deux
grilles des mêmes fichiers, deux boutons « Importer », et la rotation réduite
pour loger la copie. Elle reste où elle sert — à côté, en permanence, quel que
soit le volet ouvert.

## Le mois d'un écran

La vue jour répond à « à quelle heure ». Celle-ci répond à « quels jours » —
la question qu'on se pose en programmant à l'avance : les portes ouvertes du
14, le menu de la semaine, l'affiche mise « jusqu'au 15 ».

Et surtout **les jours où plus rien n'est prévu**, qui prennent le ton
d'avertissement. Ce n'est pas une erreur : le contenu par défaut y prend la
main. Mais c'est une décision, et on ne la prend pas sans la voir.

### Les heures sont délibérément ignorées

Une affiche programmée de 19:00 à 07:30 paraît bel et bien ce jour-là. La
faire disparaître du calendrier parce qu'on regarde à midi serait un
mensonge — c'est pourquoi la vue n'appelle pas `isVisible` du noyau de rendu :
il répond à « maintenant, précisément », ce qui n'est pas la question ici.

### Six semaines, toujours

Et non cinq ou six selon le mois. Une grille qui change de hauteur en
changeant de mois fait sauter tout ce qui est en dessous, et on perd le fil en
feuilletant.

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
