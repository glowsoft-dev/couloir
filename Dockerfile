# Image du serveur Couloir.
#
# Elle contient tout ce qu'un écran et un navigateur ont besoin de demander :
# l'API, la console compilée, et le service des médias. Rien d'autre — pas de
# base de données, pas de terminaison TLS. Ces deux-là sont des services
# voisins, remplaçables sans reconstruire l'application.

# --- construction ----------------------------------------------------
FROM node:22-alpine AS construction
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

# `deploy` reconstitue une arborescence autonome : les paquets de l'espace de
# travail y sont copiés au lieu d'être liés. Un dossier de liens symboliques
# ne survivrait pas à la copie dans l'image finale.
RUN pnpm deploy --filter=@couloir/server --prod --legacy /application

# La console se dépose à côté du serveur, là où il la cherche.
RUN cp -r apps/console/dist /application/dist/console

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
