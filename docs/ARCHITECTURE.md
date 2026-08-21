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
  server/       API Fastify + service des médias (Range, empreintes).
  player-linux/ coque Linux : les six portes, le serveur local, systemd.
  console/      interface de pilotage (à venir)
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
| Le contenu partait d'une opacité nulle et ne devenait visible qu'à la fin du fondu | navigateur qui gèle ses animations → **écran noir** | visible par défaut, le fondu est décoratif |
| Le serveur local ne renvoyait pas de `Content-Type` | image cassée dans le navigateur | le type vient du manifeste, qui fait autorité |
| Le manifeste n'existait qu'en mémoire | un rallumage pendant une coupure perdait le contenu | conservé sur disque, rechargé au démarrage |
| Un écran neuf dont le premier téléchargement échoue restait en `staging` | rien à l'écran, aucun signal | bascule sur le contenu embarqué |

## Ce qui n'est pas encore fait

Le socle tourne, mais il reste volontairement incomplet :

- **Persistance** — `MemoryStore` est temporaire. Il expose exactement les
  opérations qu'un dépôt PostgreSQL devra fournir, la bascule est mécanique.
- **Authentification des appareils** — les requêtes portent `x-couloir-device`
  mais la signature Ed25519 n'est pas encore vérifiée.
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
