#!/usr/bin/env bash
#
# Prépare une carte pour un écran de couloir.
#
# À lancer sur un portable, carte insérée, juste après l'avoir gravée avec
# Raspberry Pi OS. Le boîtier fait ensuite tout seul : il démarre, rejoint le
# réseau, installe le lecteur depuis le serveur, redémarre, et affiche son
# code d'appairage.
#
# Sur place il ne reste donc qu'à brancher, attendre, et taper le code dans la
# console. Sans clavier ni écran branché sur le Raspberry, sans terminal, sans
# commande à recopier — c'est tout l'objet de ce script.
#
#   ./preparer-carte.sh --serveur https://couloir-cci.glowsoft.fr --nom hall-central
#   ./preparer-carte.sh --serveur https://... --nom cdi --wifi "SSID" --clef "motdepasse"
#
# `--cible` écrit dans un dossier au lieu d'une carte : c'est ce qui permet de
# vérifier ce qui sera posé avant d'y jouer une vraie carte.
set -euo pipefail

SERVEUR=""
NOM=""
WIFI=""
CLEF=""
CIBLE=""
PAYS="FR"

while [ $# -gt 0 ]; do
  case "$1" in
    --serveur) SERVEUR="$2"; shift 2 ;;
    --nom)     NOM="$2";     shift 2 ;;
    --wifi)    WIFI="$2";    shift 2 ;;
    --clef)    CLEF="$2";    shift 2 ;;
    --cible)   CIBLE="$2";   shift 2 ;;
    --pays)    PAYS="$2";    shift 2 ;;
    *) echo "option inconnue : $1" >&2; exit 2 ;;
  esac
done

if [ -z "$SERVEUR" ] || [ -z "$NOM" ]; then
  cat >&2 <<'AIDE'
Il manque l'essentiel.

  --serveur   l'adresse du serveur, telle que l'écran devra la joindre
              (https://couloir-cci.glowsoft.fr)
  --nom       le nom de la machine, pour la retrouver sur le réseau
              (hall-central, cdi, accueil-c)

Facultatif :
  --wifi/--clef  le réseau sans fil, si le boîtier n'est pas en filaire
  --pays         le code pays du Wi-Fi (FR par défaut)
  --cible        écrire dans un dossier au lieu d'une carte
AIDE
  exit 2
fi

# Le nom d'hôte finit dans le DNS local et dans les journaux : on n'y laisse
# que ce qui y est admis, plutôt que de découvrir le problème sur place.
if ! printf '%s' "$NOM" | grep -qE '^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$'; then
  echo "Nom de machine invalide : minuscules, chiffres et tirets, 2 à 32 caractères." >&2
  exit 2
fi

if [ -n "$WIFI" ] && [ -z "$CLEF" ]; then
  echo "Un réseau Wi-Fi sans clef : précisez --clef." >&2
  exit 2
fi

# --- Où écrire -----------------------------------------------------------

trouver_partition_demarrage() {
  # Les noms ont changé entre les versions de Raspberry Pi OS. On cherche les
  # deux plutôt que de supposer, et on refuse s'il y en a plusieurs : écraser
  # la mauvaise carte se paie d'une réinstallation complète.
  local trouvees=()
  local chemin
  for chemin in /Volumes/bootfs /Volumes/boot /media/*/bootfs /media/*/boot; do
    [ -d "$chemin" ] && [ -f "$chemin/cmdline.txt" ] && trouvees+=("$chemin")
  done
  case ${#trouvees[@]} in
    0) echo "Aucune carte Raspberry Pi trouvée. Gravez-la d'abord, puis réinsérez-la." >&2; return 1 ;;
    1) printf '%s' "${trouvees[0]}" ;;
    *) echo "Plusieurs cartes montées : ${trouvees[*]}. Retirez-en une." >&2; return 1 ;;
  esac
}

if [ -n "$CIBLE" ]; then
  mkdir -p "$CIBLE"
  # Un cmdline.txt d'exemple, pour que l'écriture se déroule comme sur une
  # vraie carte et que ce qu'on relit soit ce qui sera posé.
  [ -f "$CIBLE/cmdline.txt" ] || \
    echo "console=serial0,115200 console=tty1 root=PARTUUID=00000000-02 rootfstype=ext4 fsck.repair=yes rootwait" \
      > "$CIBLE/cmdline.txt"
  DEMARRAGE="$CIBLE"
else
  DEMARRAGE="$(trouver_partition_demarrage)"
fi

echo "→ carte : $DEMARRAGE"

# --- Le script de premier démarrage --------------------------------------

cat > "$DEMARRAGE/firstrun.sh" <<SCRIPT
#!/bin/bash
#
# Exécuté une seule fois, au tout premier démarrage. Déposé par
# preparer-carte.sh ; ne pas modifier ici.
#
# Tout est journalisé sur la partition de démarrage : quand ça se passe mal
# dans un couloir, on retire la carte, on la met dans un portable, et on lit.
# C'est la seule façon de diagnostiquer un boîtier sans écran ni clavier.
set -x
exec > >(tee -a /boot/firmware/couloir-installation.log /boot/couloir-installation.log 2>/dev/null) 2>&1

echo "=== préparation de $NOM — \$(date -Is) ==="

hostnamectl set-hostname "$NOM" || echo "$NOM" > /etc/hostname
sed -i "s/^127.0.1.1.*/127.0.1.1\t$NOM/" /etc/hosts || true
SCRIPT

if [ -n "$WIFI" ]; then
  cat >> "$DEMARRAGE/firstrun.sh" <<SCRIPT

# Le sans-fil. En filaire il n'y a rien à faire — c'est aussi pourquoi le
# filaire vaut mieux pour un écran qui doit tenir des années.
raspi-config nonint do_wifi_country "$PAYS" || true
nmcli connection add type wifi con-name couloir ifname wlan0 ssid "$WIFI" || true
nmcli connection modify couloir wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$CLEF" || true
nmcli connection modify couloir connection.autoconnect yes || true
nmcli connection up couloir || true
SCRIPT
fi

cat >> "$DEMARRAGE/firstrun.sh" <<SCRIPT

# On attend le réseau avant d'installer : sans lui, l'installateur échoue à
# son premier téléchargement et le boîtier reste inutilisable jusqu'à ce que
# quelqu'un remonte à l'échelle.
for essai in \$(seq 1 60); do
  if curl -fsS --max-time 5 -o /dev/null "$SERVEUR/health"; then
    echo "serveur joignable au bout de \$essai tentatives"
    break
  fi
  sleep 5
done

if ! curl -fsS --max-time 5 -o /dev/null "$SERVEUR/health"; then
  echo "ÉCHEC : $SERVEUR reste injoignable après cinq minutes."
  echo "Vérifiez le réseau et l'adresse, puis redémarrez le boîtier."
  exit 1
fi

curl -fsSL "$SERVEUR/installer.sh" | bash -s -- "$SERVEUR"

echo "=== installation terminée — \$(date -Is) ==="

# On se retire de la ligne de commande du noyau : sans ça, chaque redémarrage
# rejouerait l'installation.
for fichier in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
  [ -f "\$fichier" ] && sed -i 's| systemd.run=[^ ]*||g; s| systemd.run_success_action=[^ ]*||g; s| systemd.unit=[^ ]*||g' "\$fichier"
done
rm -f /boot/firmware/firstrun.sh /boot/firstrun.sh
SCRIPT

chmod +x "$DEMARRAGE/firstrun.sh"

# --- L'accrocher au démarrage --------------------------------------------

#
# Où le système montera cette partition, une fois démarré.
#
# Bookworm la monte sur /boot/firmware, Bullseye sur /boot. Se tromper ne
# donne pas une erreur lisible : le noyau ne trouve pas le script, ne le lance
# pas, et le boîtier démarre sur un système nu — sans rien annoncer. On lit
# donc la version sur la carte plutôt que de supposer.
#
MONTAGE=/boot/firmware
if [ -f "$DEMARRAGE/issue.txt" ] && grep -qi "bullseye" "$DEMARRAGE/issue.txt"; then
  MONTAGE=/boot
fi
echo "→ partition montée sur $MONTAGE au démarrage"

# La ligne de commande du noyau tient sur UNE seule ligne : une coupure la
# rendrait illisible et le Raspberry ne démarrerait pas du tout.
CMDLINE="$DEMARRAGE/cmdline.txt"
LIGNE="$(tr -d '\n' < "$CMDLINE")"
LIGNE="$(printf '%s' "$LIGNE" | sed 's| systemd.run=[^ ]*||g; s| systemd.run_success_action=[^ ]*||g; s| systemd.unit=[^ ]*||g')"
printf '%s systemd.run=%s/firstrun.sh systemd.run_success_action=reboot systemd.unit=kernel-command-line.target\n' \
  "$LIGNE" "$MONTAGE" > "$CMDLINE"

# L'accès distant, pour le jour où un boîtier refuse de coopérer.
touch "$DEMARRAGE/ssh"

echo "→ nom       : $NOM"
echo "→ serveur   : $SERVEUR"
echo "→ réseau    : ${WIFI:-filaire}"
echo
echo "Éjectez la carte, mettez-la dans le boîtier, branchez-le."
echo "Il installera tout seul, redémarrera, et affichera son code d'appairage."
echo "Comptez une dizaine de minutes."
echo
echo "Si rien ne s'affiche : retirez la carte, remettez-la dans le portable,"
echo "et lisez couloir-installation.log — tout y est."
