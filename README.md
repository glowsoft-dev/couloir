# Couloir

Affichage dynamique pour les couloirs de l'école : des écrans pilotés à
distance depuis une seule application.

- **Cahier des charges** — [`docs/cahier-des-charges.html`](docs/cahier-des-charges.html)
- **Architecture technique** — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Démarrer

```bash
pnpm install
pnpm demo          # tout, d'un coup : serveur + 2 écrans + console
pnpm test          # 277 tests
pnpm build
pnpm build:browser # le bundle de rendu servi au navigateur
pnpm build:console # la console compilée
pnpm dev:server    # tout, sur http://localhost:3000
pnpm dev:player    # un player, http://127.0.0.1:8080
pnpm dev:renderer  # maquette du rendu seul, http://127.0.0.1:5173
pnpm dev:console   # la console en rechargement à chaud, :5174
```

**Une seule adresse.** Le serveur sert la console lui-même : l'interface à la
racine, l'API sous `/v1`. Un seul domaine, un seul certificat, un seul endroit
à ouvrir. `pnpm dev:console` n'est qu'un confort de développement.

Pour la mise en production — image, TLS, sauvegardes — voir
[docs/deploiement.md](docs/deploiement.md).

Pour éprouver le système sans matériel, `pnpm demo` monte un couloir complet
sur le poste — serveur, deux écrans simulés, console — et affiche les trois
adresses à ouvrir. Les scénarios qui valent le détour sont dans
[docs/tester.md](docs/tester.md) : couper le réseau, redémarrer un écran
pendant la panne, déclencher une urgence, revenir à une version passée.

La console a besoin d'un jeton, défini au lancement du serveur :

```bash
COULOIR_CONSOLE_TOKEN=demo-couloir pnpm dev:server
```

Sans ce jeton, la console reste fermée — c'est volontaire, on ne l'ouvre
jamais par défaut.

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
| `apps/console` | l'administration : aujourd'hui, écrans, grille, réglages. Servie par le serveur. |
| `apps/server/src/timetable` | l'emploi du temps : modèle, moteur, saisie, source pour les écrans. |

Le reste — coques Android et Electron, programmation calendaire, comptes nominatifs — arrive ensuite.

## Valider la coque Linux sans matériel

Le player s'appelle `player-linux` : il doit être vérifié sur Linux, pas sur
un Mac. Une VM Debian 12 — la base de Raspberry Pi OS — en arm64, donc sans
émulation sur un Mac Apple Silicon :

```bash
brew install lima
limactl start --name=couloir-pi apps/player-linux/lima/couloir-pi.yaml
```

Elle valide systemd, les chemins `/proc` et `/sys`, la détection d'horloge,
les métriques disque, et l'installation par script. Elle ne valide NI HDMI,
NI CEC, NI `vcgencmd` : ces bouts-là ne se vérifient que sur un vrai boîtier.

## Poser un écran

L'artefact déployable est **deux fichiers**, produits par :

```bash
pnpm --filter @couloir/player-linux build:bundle
```

Surtout pas `node_modules` : dans un monorepo pnpm c'est un maillage de liens
symboliques, incopiable sur un boîtier.

`apps/player-linux/scripts/install.sh` prépare ensuite le boîtier en atelier :
compte de service, Chromium en kiosque, deux unités systemd. Il a été exécuté
en vrai sur Debian 12 arm64. L'agent et le
navigateur sont **deux services séparés** — Chromium peut planter et être
relancé sans que l'écran perde son cache ni sa file de télémétrie.
