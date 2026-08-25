#!/usr/bin/env bash
#
# Prépare un boîtier Linux. Exécuté en atelier, avant la pose : un écran doit
# arriver dans le couloir prêt à être appairé.
#
# Testé sur Debian 12 (la base de Raspberry Pi OS) en arm64. Deux pièges
# rencontrés, et corrigés ici plutôt que sur une échelle :
#
#   - le navigateur s'appelle `chromium-browser` sur Raspberry Pi OS et
#     `chromium` sur Debian. On détecte, on ne suppose pas ;
#   - le paquet `nodejs` de Debian 12 est en version 18, trop ancienne. On
#     installe une version épinglée depuis nodejs.org.
set -euo pipefail

SERVER="${1:-}"
if [ -z "$SERVER" ]; then
  echo "usage: install.sh https://couloir.exemple.fr" >&2
  exit 2
fi

NODE_VERSION="${COULOIR_NODE_VERSION:-v22.14.0}"
PREFIX=/opt/couloir/player
DATA=/var/lib/couloir

case "$(uname -m)" in
  aarch64|arm64) NODE_ARCH=linux-arm64 ;;
  x86_64)        NODE_ARCH=linux-x64 ;;
  armv7l)        NODE_ARCH=linux-armv7l ;;
  *) echo "architecture non gérée : $(uname -m)" >&2; exit 1 ;;
esac

echo "→ compte de service et dossiers"
id -u couloir >/dev/null 2>&1 || useradd --system --create-home --home-dir "$DATA" couloir
install -d -o couloir -g couloir "$DATA" "$PREFIX"

echo "→ paquets système"
apt-get update -qq

# Le nom du navigateur diffère selon la distribution.
#
# La sortie est capturée AVANT d'être filtrée, jamais mise en tuyau vers
# `grep -q` : celui-ci ferme le tuyau dès qu'il trouve, la commande amont
# reçoit un SIGPIPE et sort en 141, et `set -o pipefail` en fait un échec.
# La détection échouait donc systématiquement, en silence.
BROWSER_PKG=""
for candidate in chromium chromium-browser; do
  policy="$(apt-cache policy "$candidate" 2>/dev/null || true)"
  case "$policy" in
    *"Candidate: (none)"*) continue ;;
    *"Candidate: "*) BROWSER_PKG="$candidate"; break ;;
  esac
done
if [ -z "$BROWSER_PKG" ]; then
  echo "aucun paquet Chromium trouvé (essayé : chromium, chromium-browser)" >&2
  exit 1
fi
echo "  navigateur : $BROWSER_PKG"

apt-get install -y --no-install-recommends \
  "$BROWSER_PKG" xserver-xorg xinit unclutter curl ca-certificates xz-utils

echo "→ Node ${NODE_VERSION}"
# Pas celui d'apt : Debian 12 livre encore la version 18.
if [ "$(/usr/local/bin/node --version 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  mkdir -p /opt/node
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_ARCH}.tar.xz" \
    | tar -xJ --strip-components=1 -C /opt/node
  ln -sf /opt/node/bin/node /usr/local/bin/node
fi
node --version

echo "→ application"
# Deux fichiers autonomes, produits par `pnpm --filter @couloir/player-linux
# build:bundle`. Surtout PAS `node_modules` : dans un monorepo pnpm c'est un
# maillage de liens symboliques, incopiable sur un boîtier.
# L'artefact vient du serveur quand il n'est pas déjà là.
#
# C'est ce qui permet de poser un boîtier sans rien copier à la main : le
# serveur qui pilote les écrans sert aussi le logiciel qu'ils exécutent, et
# les deux ne peuvent donc pas se désynchroniser.
if [ ! -f dist-bundle/couloir-player.mjs ]; then
  echo "→ téléchargement du lecteur depuis ${SERVER}"
  TEMPO="$(mktemp -d)"
  trap 'rm -rf "$TEMPO"' EXIT
  if curl -fsSL "${SERVER}/telechargements/couloir-player.mjs" -o "$TEMPO/couloir-player.mjs" \
     && curl -fsSL "${SERVER}/telechargements/couloir.js" -o "$TEMPO/couloir.js"; then
    mkdir -p dist-bundle
    mv "$TEMPO/couloir-player.mjs" "$TEMPO/couloir.js" dist-bundle/
  fi
fi

if [ ! -f dist-bundle/couloir-player.mjs ]; then
  echo "artefact introuvable, et le serveur ${SERVER} ne le sert pas." >&2
  echo "Construisez-le : pnpm --filter @couloir/player-linux build:bundle" >&2
  exit 1
fi
# Le lecteur va dans « courant », que le boîtier saura basculer tout seul.
#
# Un chemin figé aurait obligé à se brancher sur chaque Raspberry pour poser
# une version. Ici, le boîtier va chercher, vérifie l'empreinte, garde la
# version d'avant dans « precedent », et y retombe si la nouvelle ne tient
# pas debout.
LECTEUR=/var/lib/couloir/lecteur/courant
install -d -o couloir -g couloir /var/lib/couloir/lecteur "$LECTEUR"
install -m 644 -o couloir -g couloir dist-bundle/couloir-player.mjs "$LECTEUR"/couloir-player.mjs
install -m 644 -o couloir -g couloir dist-bundle/couloir.js "$LECTEUR"/couloir.js
# La version posée, pour que le boîtier sache s'il est à jour. Elle est
# demandée au serveur : la déduire ici, c'est risquer qu'elle diverge de ce
# que le serveur annonce, et le boîtier retéléchargerait à chaque démarrage.
if curl -fsSL "${SERVER}/telechargements/version.json" -o /tmp/couloir-version.json 2>/dev/null; then
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' /tmp/couloir-version.json \
    | head -1 > "$LECTEUR"/version
  chown couloir:couloir "$LECTEUR"/version
  rm -f /tmp/couloir-version.json
fi
install -m 755 scripts/kiosk.sh "$PREFIX"/kiosk.sh
chown -R couloir:couloir /opt/couloir

echo "→ services"
install -m 644 systemd/couloir-player.service /etc/systemd/system/
install -m 644 systemd/couloir-kiosk.service /etc/systemd/system/
sed -i "s|^Environment=COULOIR_SERVER=.*|Environment=COULOIR_SERVER=${SERVER}|" \
  /etc/systemd/system/couloir-player.service
# Le chemin de Node dépend de l'installation : on ne le fige pas dans l'unité.
NODE_BIN="$(command -v node)"
sed -i "s|^ExecStart=.* /var/lib/couloir/lecteur/courant/couloir-player.mjs|ExecStart=${NODE_BIN} /var/lib/couloir/lecteur/courant/couloir-player.mjs|" \
  /etc/systemd/system/couloir-player.service
systemctl daemon-reload
systemctl enable --now couloir-player
# Le kiosque n'est activé que s'il y a de quoi afficher : un boîtier sans
# serveur graphique reste utile pour tester l'agent seul.
if systemctl list-unit-files graphical.target >/dev/null 2>&1; then
  systemctl enable couloir-kiosk || true
fi

cat <<'MSG'

Boîtier prêt. Au premier démarrage, l'écran affiche un code d'appairage à
six caractères : saisissez-le dans la console pour le rattacher à un
emplacement.

Sur Raspberry Pi, pensez au module RTC (DS3231) : sans lui, une coupure de
courant sans réseau fait redémarrer l'appareil à une date fantaisiste et
toute la programmation horaire part de travers.
MSG
