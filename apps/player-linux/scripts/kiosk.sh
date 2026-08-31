#!/usr/bin/env bash
#
# Lance le navigateur en kiosque sur le serveur local de l'agent.
#
# Le binaire est résolu à l'exécution, pas figé dans l'unité systemd :
# il s'appelle `chromium-browser` sur Raspberry Pi OS et `chromium` sur
# Debian, et une mise à jour de l'OS ne doit pas éteindre un écran.
set -euo pipefail

PORT="${COULOIR_PORT:-8080}"

BROWSER=""
for candidate in chromium-browser chromium chromium-bin google-chrome; do
  if command -v "$candidate" >/dev/null 2>&1; then
    BROWSER="$(command -v "$candidate")"
    break
  fi
done
if [ -z "$BROWSER" ]; then
  echo "aucun navigateur trouvé (essayé : chromium-browser, chromium, google-chrome)" >&2
  exit 1
fi

# On n'affiche rien tant que l'agent n'est pas prêt : mieux vaut un écran
# noir deux secondes qu'une page d'erreur du navigateur devant les élèves.
until curl -sf "http://127.0.0.1:${PORT}/state" >/dev/null 2>&1; do sleep 1; done

#
# Le serveur graphique, qu'on lance nous-mêmes.
#
# L'unité posait `DISPLAY=:0` en supposant qu'un serveur X tournait déjà.
# Sur une installation sans bureau — celle qu'on veut pour un écran de
# couloir, qui n'a rien à faire d'un gestionnaire de session — il n'y en a
# aucun, et Chromium sortait sur « Missing X server or $DISPLAY ». L'agent
# tournait, le contenu arrivait, et la dalle restait noire.
#
# On se relance donc sous `xinit`, qui démarre X puis nous rappelle avec un
# affichage bien à nous. Le drapeau évite la récursion.
#
if [ "${1:-}" != "--sous-x" ]; then
  if xset q >/dev/null 2>&1; then
    # Un affichage existe déjà — un bureau, par exemple. On s'y greffe.
    :
  else
    exec xinit "$0" --sous-x -- "${DISPLAY:-:0}" vt1 -nolisten tcp
  fi
fi

# Ni économiseur d'écran, ni extinction, ni curseur : une dalle de couloir
# reste allumée, et rien ne doit venir s'y superposer.
xset s off -dpms s noblank 2>/dev/null || true
command -v unclutter >/dev/null && unclutter -idle 0 -root &

#
# La géométrie, faute de gestionnaire de fenêtres.
#
# `--kiosk` ne met pas la fenêtre en plein écran tout seul : il demande au
# gestionnaire de fenêtres de le faire. Sur un boîtier d'affichage il n'y en a
# aucun — c'est voulu, il n'y a rien à gérer — et Chromium garde alors sa
# taille par défaut. La dalle montre une vignette entourée de noir, ce qui
# ressemble à un problème de contenu et se cherche longtemps.
#
# On lui donne donc les dimensions de l'écran, lues du serveur X.
#
# Trois façons de lire la taille, parce qu'aucune n'est garantie : `xdpyinfo`
# vient de x11-utils, absent d'une installation minimale ; `xrandr` accompagne
# `xset`, donc presque toujours là ; et le tampon d'image répond même sans
# aucun outil X. La première version n'essayait que la première, et repartait
# donc les mains vides sur ce boîtier-ci.
taille_de_la_dalle() {
  local t
  t="$(xdpyinfo 2>/dev/null | awk '/dimensions:/{print $2; exit}')"
  [ -n "$t" ] && { echo "$t"; return; }
  t="$(xrandr 2>/dev/null | awk '/\*/{print $1; exit}')"
  [ -n "$t" ] && { echo "$t"; return; }
  t="$(tr ',' 'x' < /sys/class/graphics/fb0/virtual_size 2>/dev/null)"
  [ -n "$t" ] && echo "$t"
}

GEOMETRIE=()
TAILLE="$(taille_de_la_dalle)"
if [ -n "$TAILLE" ]; then
  GEOMETRIE=(--window-position=0,0 "--window-size=${TAILLE%%x*},${TAILLE##*x}")
  echo "dalle detectee : $TAILLE" >&2
else
  # On le dit plutôt que de laisser une fenêtre trop petite sans explication.
  echo "taille de dalle indeterminee : la fenetre gardera sa taille par defaut" >&2
fi

DRAPEAUX=(
  --kiosk
  --app="http://127.0.0.1:${PORT}/"

  # Sans ça, Chromium réclame un mot de passe pour créer un trousseau de clés
  # au premier lancement, et attend. La dalle affiche une boîte de dialogue à
  # la place du contenu — sur chaque écran, le jour de la pose. Il n'a de toute
  # façon aucun secret à ranger : il ouvre une page locale, sans compte.
  --password-store=basic
  --use-mock-keychain

  --noerrdialogs
  --disable-infobars
  --disable-session-crashed-bubble

  # La bannière « French / English » ne se ferme PAS par ces drapeaux : les
  # versions récentes de Chromium les ignorent. On les garde pour les anciennes,
  # mais ce qui la supprime vraiment est la politique système posée par
  # l'installateur, dans /etc/chromium/policies/managed.
  --disable-features=Translate,TranslateUI
  --disable-translate

  --check-for-update-interval=31536000
  --autoplay-policy=no-user-gesture-required
  --disable-pinch
  --overscroll-history-navigation=0
)

exec "$BROWSER" "${DRAPEAUX[@]}" "${GEOMETRIE[@]}"
