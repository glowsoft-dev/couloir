# Image du serveur Couloir.
#
# Elle contient tout ce qu'un écran et un navigateur ont besoin de demander :
# l'API, la console compilée, et le service des médias. Rien d'autre — pas de
# base de données, pas de terminaison TLS. Ces deux-là sont des services
# voisins, remplaçables sans reconstruire l'application.

# --- construction ----------------------------------------------------
#
# Compilée sur l'architecture de la MACHINE qui construit, jamais sur celle
# de la cible.
#
# Le serveur tourne sur un Raspberry, en arm64, et les machines d'intégration
# sont en amd64. Émuler arm64 pour compiler du TypeScript coûtait quarante
# minutes là où la compilation native en prend deux — pour produire
# exactement les mêmes octets, puisque le résultat est du JavaScript, qui n'a
# pas d'architecture.
#
# Ça ne vaut que tant qu'aucune dépendance de production n'embarque de binaire
# natif. Le contrôle plus bas s'en assure : le jour où l'une en apporte un, la
# construction s'arrête ici plutôt que de livrer une image qui refuse de
# démarrer sur le Pi avec un « invalid ELF header ».
FROM --platform=$BUILDPLATFORM node:22-alpine AS construction
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /source

# Les manifestes d'abord : tant qu'ils ne changent pas, Docker réutilise
# les dépendances déjà installées, et une correction d'une ligne ne
# retélécharge pas la moitié de npm.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY packages/protocol/package.json  packages/protocol/
COPY packages/agent/package.json     packages/agent/
COPY packages/renderer/package.json  packages/renderer/
COPY apps/server/package.json        apps/server/
COPY apps/console/package.json       apps/console/
COPY apps/player-linux/package.json  apps/player-linux/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .

# Le serveur compilé, puis la console. Les deux sont nécessaires : le serveur
# sert la console lui-même, ce qui laisse une seule adresse à retenir et un
# seul certificat à gérer.
RUN pnpm build && pnpm build:console

# Et le lecteur, que le serveur sert aux boîtiers.
#
# Sans lui, l'image démarre, répond, affiche la console — et aucun Raspberry
# ne peut être posé : `installer.sh` rend 404, et la mise à jour automatique
# des écrans n'a rien à aller chercher. Le défaut ne se voit qu'en démarrant
# l'image, jamais en la construisant.
RUN pnpm build:browser && pnpm --filter @couloir/player-linux build:bundle

# `deploy` reconstitue une arborescence autonome : les paquets de l'espace de
# travail y sont copiés au lieu d'être liés. Un dossier de liens symboliques
# ne survivrait pas à la copie dans l'image finale.
RUN pnpm deploy --filter=@couloir/server --prod --legacy /application

# La console se dépose à côté du serveur, là où il la cherche.
RUN cp -r apps/console/dist /application/dist/console

# Le lecteur et son installateur, aux chemins que le serveur interroge en
# premier — voir `lireArtefact` et `lireInstallateur`. Hors de l'image, il
# retombe sur l'arborescence de développement, qui n'existe pas ici.
RUN mkdir -p /application/dist/telechargements \
 && cp apps/player-linux/dist-bundle/couloir-player.mjs \
       apps/player-linux/dist-bundle/couloir.js \
       /application/dist/telechargements/ \
 && cp apps/player-linux/scripts/install.sh /application/dist/install.sh

# Le garde-fou de la compilation croisée.
#
# Un binaire natif compilé pour amd64 et embarqué dans une image arm64 ne se
# voit qu'au démarrage sur le Pi, par un « invalid ELF header » qui ne dit pas
# d'où il vient. Mieux vaut échouer ici, avec la raison écrite.
RUN if find /application -name '*.node' -print -quit | grep -q .; then \
      echo "ERREUR : une dépendance de production embarque un binaire natif." >&2; \
      echo "La compilation croisée ne vaut plus. Voir l'en-tête du Dockerfile." >&2; \
      find /application -name '*.node' >&2; \
      exit 1; \
    fi

# --- exécution -------------------------------------------------------
FROM node:22-alpine AS execution
ENV NODE_ENV=production

# Les médias sont écrits par le serveur : le dossier doit lui appartenir.
RUN mkdir -p /donnees/medias && chown -R node:node /donnees

WORKDIR /application
COPY --from=construction --chown=node:node /application ./

USER node
EXPOSE 3000

ENV COULOIR_PORT=3000
ENV COULOIR_MEDIA=/donnees/medias

# Sans ça, un conteneur dont le processus tourne mais dont la base est
# injoignable passerait pour sain, et l'orchestrateur ne le remplacerait
# jamais.
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.COULOIR_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
