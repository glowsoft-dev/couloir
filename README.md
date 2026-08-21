# Couloir

Affichage dynamique pour les couloirs de l'école : des écrans pilotés à
distance depuis une seule application.

- **Cahier des charges** — [`docs/cahier-des-charges.html`](docs/cahier-des-charges.html)
- **Architecture technique** — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Démarrer

```bash
pnpm install
pnpm test          # 105 tests
pnpm build
pnpm build:browser # le bundle de rendu servi au navigateur
pnpm dev:server    # l'API,    http://localhost:3000
pnpm dev:renderer  # maquette, http://127.0.0.1:5173
pnpm dev:player    # un vrai player, http://127.0.0.1:8080
```

`dev:renderer` ouvre un écran de démonstration avec des boutons pour basculer
dans chacun des états réels : rotation normale, emploi du temps périmé,
message d'urgence, repérage, repli hors ligne, extinction. C'est le moyen le
plus rapide de vérifier qu'une mise en page tient, sans matériel ni serveur.

Le serveur a besoin de PostgreSQL :

```bash
pnpm infra:up
```

Il est exposé sur le **port 5442**, pas 5432 — celui-ci est souvent déjà pris
par un autre projet. `DATABASE_URL` permet d'en changer.

Pour une démonstration rapide sans base, `COULOIR_STORE=memory` fait tourner
le serveur en mémoire — mais tout est perdu à l'arrêt, y compris les écrans
enrôlés.

Les tests qui touchent PostgreSQL se sautent proprement si la base n'est pas
joignable : `pnpm test` passe sans Docker. L'intégration continue, elle, doit
lancer `pnpm infra:up` d'abord.

## Faire tourner un écran de bout en bout

Trois terminaux. Le serveur d'abord, en mode développement :

```bash
COULOIR_DEV=1 pnpm dev:server
```

Puis un player, qui se comporte comme un boîtier posé dans un couloir :

```bash
COULOIR_SERVER=http://localhost:3000 COULOIR_DATA=/tmp/couloir COULOIR_PORT=8080 pnpm dev:player
```

Ouvrez `http://127.0.0.1:8080` : l'écran affiche un **code d'appairage**.
Rattachez-le et publiez-lui du contenu — ce que fera la console, qui n'existe
pas encore :

```bash
curl -s -X POST localhost:3000/v1/enroll/claim -H 'content-type: application/json' -d '{"pairingCode":"LE-CODE-AFFICHE","newScreen":{"code":"A·1·12","label":"Hall central","building":"A","floor":1,"area":"hall","orientation":"landscape","groupIds":[]}}'
```

```bash
curl -s -X POST localhost:3000/dev/publish-demo -H 'content-type: application/json' -d '{"screenId":"L-ID-RENVOYE"}'
```

L'écran télécharge son affiche, la vérifie, et se met à diffuser.

**Coupez le serveur** : rien ne change à l'écran. **Redémarrez le player**
serveur toujours coupé : il retrouve son contenu depuis le disque.

## Essayer le scénario d'enrôlement à la main

Serveur lancé, dans un autre terminal :

```bash
curl -s localhost:3000/health
```

L'appareil se déclare et reçoit le code qu'il affichera à l'écran :

```bash
curl -s -X POST localhost:3000/v1/enroll/start -H 'content-type: application/json' -d '{"publicKey":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","capabilities":{"platform":"linux","shellVersion":"0.1.0","rendererVersion":"0.1.0","agentVersion":"0.1.0","display":{"widthPx":1920,"heightPx":1080,"orientation":"landscape"},"codecs":["h264"],"maxVideoHeight":1080,"storageBudgetBytes":8589934592,"features":{"persistentCache":true,"autoStart":true,"kiosk":true,"remoteReboot":true,"remoteUpdate":true,"displayPower":true,"screenshot":true,"hardwareWatchdog":true,"reliableClock":false}}}'
```

Puis on le rattache à un écran, code d'appairage en main :

```bash
curl -s -X POST localhost:3000/v1/enroll/claim -H 'content-type: application/json' -d '{"pairingCode":"REMPLACER","newScreen":{"code":"B·0·03","label":"Devant le CDI","building":"B","floor":0,"area":"cdi","orientation":"landscape","groupIds":[]}}'
```

## Organisation

| Paquet | Rôle |
|---|---|
| `packages/protocol` | le contrat serveur ↔ écrans. Schémas et logique pure, sans dépendance à Node. |
| `packages/agent` | machine à états, backoff, contrat d'abstraction des plateformes. |
| `packages/renderer` | le noyau de rendu. La décision en logique pure, le DOM par-dessus, sans framework. |
| `apps/server` | l'API, le service des médias, la persistance PostgreSQL. |
| `apps/player-linux` | la coque Linux : les six portes, le serveur local, les unités systemd. |

Le reste — console, coques Android et Electron, authentification des appareils — arrive ensuite.

## Poser un écran

`apps/player-linux/scripts/install.sh` prépare un boîtier en atelier :
compte de service, Chromium en kiosque, deux unités systemd. L'agent et le
navigateur sont **deux services séparés** — Chromium peut planter et être
relancé sans que l'écran perde son cache ni sa file de télémétrie.
