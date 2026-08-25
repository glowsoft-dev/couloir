#!/usr/bin/env bash
#
# La mise à jour du serveur, tirée et non poussée.
#
# Personne n'entre sur le réseau du campus : c'est le serveur qui sort, vers
# un registre, en HTTPS — comme il sort déjà pour NetYPareo. Il n'y a donc ni
# port à ouvrir, ni tunnel permanent à négocier avec l'informatique de
# l'école.
#
# Posé en tâche planifiée, il suffit de publier une image pour mettre en
# production. Lancé à la main, il fait la même chose tout de suite.
#
#   ./mise-a-jour.sh            # tire, applique, vérifie, revient si besoin
#   ./mise-a-jour.sh --verifier # dit seulement s'il y a du nouveau
set -euo pipefail

cd "$(dirname "$0")"
COMPOSE=(docker compose --env-file .env)
SERVICE=serveur
# Le temps qu'on laisse au serveur pour répondre après une bascule. Les
# migrations de base tournent au démarrage : trop court, on annulerait une
# mise à jour saine qui n'avait pas fini de s'appliquer.
DELAI_SANTE=${COULOIR_DELAI_SANTE:-90}

journal() { printf '%s  %s\n' "$(date -Is)" "$*"; }

image_courante() {
  "${COMPOSE[@]}" images --quiet "$SERVICE" 2>/dev/null | head -1
}

en_bonne_sante() {
  local reste=$DELAI_SANTE
  while [ "$reste" -gt 0 ]; do
    # Interrogé de l'intérieur du réseau Docker : on vérifie le serveur, pas
    # la terminaison TLS ni le DNS, qui ont leurs propres pannes.
    if "${COMPOSE[@]}" exec -T "$SERVICE" node -e \
        'fetch("http://127.0.0.1:3000/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
        >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
    reste=$((reste - 3))
  done
  return 1
}

AVANT="$(image_courante || true)"

journal "recherche d'une nouvelle image"
"${COMPOSE[@]}" pull --quiet "$SERVICE"
APRES="$("${COMPOSE[@]}" config --images 2>/dev/null | grep -v postgres | grep -v caddy | head -1)"

# `pull` ne dit pas s'il a ramené quelque chose : on compare les identifiants.
NOUVELLE="$(docker image inspect --format '{{.Id}}' "$APRES" 2>/dev/null || true)"
if [ -n "$AVANT" ] && [ "$AVANT" = "$NOUVELLE" ]; then
  journal "déjà à jour"
  exit 0
fi

if [ "${1:-}" = "--verifier" ]; then
  journal "une nouvelle image est disponible"
  exit 0
fi

journal "bascule sur la nouvelle image"
"${COMPOSE[@]}" up -d "$SERVICE"

if en_bonne_sante; then
  journal "mise à jour appliquée"
  exit 0
fi

#
# Le serveur ne répond pas. On revient.
#
# Un serveur mort, c'est la console injoignable et les publications
# impossibles — les écrans, eux, continuent d'afficher ce qu'ils ont. Mais
# personne ne s'en aperçoit avant d'en avoir besoin, et c'est précisément le
# moment où l'on n'a pas le temps de diagnostiquer.
#
journal "le serveur ne répond pas après ${DELAI_SANTE}s"
if [ -z "$AVANT" ]; then
  journal "aucune image précédente : rien vers quoi revenir, on laisse en l'état"
  exit 1
fi

journal "retour à l'image précédente"
COULOIR_IMAGE="$AVANT" "${COMPOSE[@]}" up -d "$SERVICE"
if en_bonne_sante; then
  journal "revenu à l'image précédente, le serveur répond"
  # Sortie en échec malgré le rétablissement : une mise à jour annulée doit
  # se voir dans le journal de la tâche planifiée, pas passer pour un succès.
  exit 1
fi

journal "le serveur ne répond pas non plus sur l'image précédente"
exit 2
