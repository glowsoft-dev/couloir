#!/usr/bin/env bash
# Prépare un boîtier Linux. Exécuté en atelier, avant la pose : un écran
# doit arriver dans le couloir prêt à être appairé.
set -euo pipefail

SERVER="${1:?usage: install.sh https://couloir.exemple.fr}"

echo "→ compte de service et dossier de données"
id -u couloir >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/couloir couloir
install -d -o couloir -g couloir /var/lib/couloir /opt/couloir/player

echo "→ dépendances"
apt-get update -qq
apt-get install -y --no-install-recommends chromium-browser xserver-xorg xinit unclutter curl nodejs

echo "→ application"
cp -r dist node_modules /opt/couloir/player/
chown -R couloir:couloir /opt/couloir

echo "→ services"
install -m 644 systemd/couloir-player.service /etc/systemd/system/
install -m 644 systemd/couloir-kiosk.service /etc/systemd/system/
sed -i "s|COULOIR_SERVER=.*|COULOIR_SERVER=${SERVER}|" /etc/systemd/system/couloir-player.service
systemctl daemon-reload
systemctl enable --now couloir-player couloir-kiosk

cat <<'MSG'

Boîtier prêt. Au premier démarrage, l'écran affiche un code d'appairage
à six caractères : saisissez-le dans la console pour le rattacher à un
emplacement.

Sur Raspberry Pi, pensez au module RTC (DS3231) : sans lui, une coupure
de courant sans réseau fait redémarrer l'appareil à une date fantaisiste
et toute la programmation horaire part de travers.
MSG
