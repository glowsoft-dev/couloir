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
