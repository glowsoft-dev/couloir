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
#
# Les fichiers d'appoint : le lanceur du navigateur et les deux unités.
#
# On les prenait dans le dépôt, alors que la commande annoncée est
# `curl … | sudo bash`, qui n'en a aucun : l'installation officielle échouait
# ici, au premier boîtier posé. On les prend donc du dépôt s'il est là, du
# serveur sinon — c'est lui qui sert déjà le lecteur.
#
recuperer() {
  local nom="$1" chemin_local="$2" destination="$3" droits="$4"
  if [ -f "$chemin_local" ]; then
    install -m "$droits" "$chemin_local" "$destination"
  elif curl -fsSL "${SERVER}/telechargements/${nom}" -o "$TEMPO_APPOINT/$nom"; then
    install -m "$droits" "$TEMPO_APPOINT/$nom" "$destination"
  else
    echo "introuvable : $nom (ni dans le dépôt, ni sur ${SERVER})" >&2
    exit 1
  fi
}

TEMPO_APPOINT="$(mktemp -d)"
trap 'rm -rf "$TEMPO_APPOINT"' EXIT

recuperer kiosk.sh scripts/kiosk.sh "$PREFIX"/kiosk.sh 755
chown -R couloir:couloir /opt/couloir

#
# De quoi laisser le kiosque démarrer son propre serveur X.
#
# Sans bureau installé — ce qu'on veut pour un écran de couloir — personne ne
# lance X, et c'est donc au kiosque de le faire. Deux choses le lui
# permettent : l'appartenance aux groupes qui donnent accès à la carte
# graphique et au terminal, et l'autorisation de lancer X sans être root.
#
# Par défaut, Debian réserve ce lancement à une console déjà ouverte. Un
# service systemd n'en a aucune : sans cette ligne, Chromium sort sur
# « Missing X server » et la dalle reste noire pendant que tout le reste
# fonctionne.
#
usermod -aG video,input,tty,render couloir 2>/dev/null || usermod -aG video,input,tty couloir
install -d /etc/X11
cat > /etc/X11/Xwrapper.config <<'XWRAPPER'
# Posé par l'installateur Couloir : le kiosque démarre X depuis un service,
# sans console de rattachement.
allowed_users=anybody
needs_root_rights=yes
XWRAPPER

#
# La bannière de traduction, coupée par politique et non par drapeau.
#
# `--disable-features=Translate` ne suffit plus : Chromium l'ignore, et la
# barre « French / English » se pose en haut de la dalle, par-dessus le
# contenu. Constaté sur un écran en service, drapeaux pourtant présents.
#
# Une politique système, elle, fait autorité. Le chemin dépend du paquet —
# `chromium` sur Debian, `chromium-browser` sur d'autres — on pose les deux
# plutôt que de deviner.
#
for dossier in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed; do
  install -d "$dossier"
  cat > "$dossier"/couloir.json <<'POLITIQUE'
{
  "TranslateEnabled": false,
  "DefaultNotificationsSetting": 2,
  "PasswordManagerEnabled": false,
  "BackgroundModeEnabled": false
}
POLITIQUE
  chmod 644 "$dossier"/couloir.json
done

echo "→ services"
recuperer couloir-player.service systemd/couloir-player.service /etc/systemd/system/couloir-player.service 644
recuperer couloir-kiosk.service systemd/couloir-kiosk.service /etc/systemd/system/couloir-kiosk.service 644
sed -i "s|^Environment=COULOIR_SERVER=.*|Environment=COULOIR_SERVER=${SERVER}|" \
  /etc/systemd/system/couloir-player.service
# Le chemin de Node dépend de l'installation : on ne le fige pas dans l'unité.
NODE_BIN="$(command -v node)"
sed -i "s|^ExecStart=.* /var/lib/couloir/lecteur/courant/couloir-player.mjs|ExecStart=${NODE_BIN} /var/lib/couloir/lecteur/courant/couloir-player.mjs|" \
  /etc/systemd/system/couloir-player.service
#
# Le droit de se relancer, et rien d'autre.
#
# Le lecteur se met à jour tout seul : il télécharge la nouvelle version,
# vérifie son empreinte, la pose — puis doit redémarrer son propre service.
# Sans cette règle, systemd répond « Interactive authentication required », et
# la version posée n'entre en service qu'au prochain redémarrage de la
# machine. Sur un écran qui tourne des mois, autant dire jamais : le parc
# resterait sur une version périmée en croyant se mettre à jour.
#
# La règle est étroite à dessein. Elle nomme les deux services et le seul
# compte concerné : elle ne donne pas à `couloir` le droit d'agir sur les
# autres unités de la machine.
#
install -d /etc/polkit-1/rules.d
cat > /etc/polkit-1/rules.d/50-couloir.rules <<'POLKIT'
// Posé par l'installateur Couloir. Le lecteur redémarre ses propres services
// après s'être mis à jour, et ceux-là seulement.
polkit.addRule(function (action, subject) {
  if (
    action.id === "org.freedesktop.systemd1.manage-units" &&
    subject.user === "couloir"
  ) {
    var unite = action.lookup("unit");
    if (unite === "couloir-player.service" || unite === "couloir-kiosk.service") {
      return polkit.Result.YES;
    }
  }
});
POLKIT
chmod 644 /etc/polkit-1/rules.d/50-couloir.rules

systemctl daemon-reload
systemctl enable --now couloir-player

#
# Pas de bureau sur un écran de couloir.
#
# Deux raisons, et la seconde est une panne constatée.
#
# La première tient au bon sens : un bureau consomme mémoire et processeur
# pour une session que personne n'ouvrira jamais, sur une machine dont le seul
# travail est d'afficher une page.
#
# La seconde est que le kiosque démarre SON PROPRE serveur X. Si un
# compositeur occupe déjà la dalle, X ne peut pas s'ouvrir de socket, et le
# service tourne en boucle sur « Cannot establish any listening sockets » —
# un message qui ne dit rien de sa cause. On a cherché longtemps.
#
# Réversible d'une commande : systemctl set-default graphical.target
#
if [ "$(systemctl get-default)" != "multi-user.target" ]; then
  echo "→ désactivation du bureau au démarrage (un écran de couloir n'en a pas besoin)"
  systemctl set-default multi-user.target
fi

# Le kiosque s'accroche à multi-user.target — voir l'unité, qui explique
# pourquoi ce n'est PAS graphical.target.
systemctl enable couloir-kiosk || true

cat <<'MSG'

Boîtier prêt. Au premier démarrage, l'écran affiche un code d'appairage à
six caractères : saisissez-le dans la console pour le rattacher à un
emplacement.

Sur Raspberry Pi, pensez au module RTC (DS3231) : sans lui, une coupure de
courant sans réseau fait redémarrer l'appareil à une date fantaisiste et
toute la programmation horaire part de travers.
MSG
