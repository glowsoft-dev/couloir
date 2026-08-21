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

## Ce qui n'est pas encore fait

Le socle tourne, mais il reste volontairement incomplet :

- **Les comptes** — la console est protégée par un jeton partagé, pas par des
  comptes nominatifs avec rôles et journal d'audit.
- **La programmation calendaire** — on publie, ça part tout de suite. Les
  plages horaires et les campagnes datées restent à faire.
- **Le plan interactif** — la console liste les écrans, elle ne les situe pas
  encore sur un plan d'étage.
- **TLS** — les échanges ne sont pas chiffrés en développement. La signature
  authentifie l'appareil, elle ne protège pas la confidentialité.
- **URL signées** — les médias sont servis sans signature ni expiration.
- **Les autres coques** — Android et Electron restent à écrire. La coque
  Linux existe et sert de référence : elles n'ont qu'à implémenter `ports.ts`.
- **MQTT** — `subscribeCommands` renvoie un abonnement inerte. Le poll fait
  tout le travail et reste le filet de sécurité de toute façon.
- **Les gabarits** — le rendu n'en connaît que la forme générale (bandeau,
  titre, texte). La bibliothèque annoncée au cahier des charges reste à faire.
- **La console** — aucune interface.
- **Les connecteurs** — `/connectors/*` sont des bouchons. Les vrais — ICS
  pour l'emploi du temps, REST pour le site — restent à écrire.
- **La publication** — `/dev/publish-demo` tient lieu de console. Réservé au
  mode développement.


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
