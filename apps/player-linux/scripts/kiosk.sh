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

exec "$BROWSER" \
  --kiosk \
  --app="http://127.0.0.1:${PORT}/" \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --disable-pinch \
  --overscroll-history-navigation=0
