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

# Les deux services qui portent notre code. La base n'en est pas : elle suit
# son propre rythme, et une montée de version majeure de PostgreSQL ne se fait
# pas par une tâche de nuit.
SERVICES=(serveur tls)

# Le temps qu'on laisse aux services pour répondre après une bascule. Les
# migrations de base tournent au démarrage : trop court, on annulerait une
# mise à jour saine qui n'avait pas fini de s'appliquer.
DELAI_SANTE=${COULOIR_DELAI_SANTE:-90}

journal() { printf '%s  %s\n' "$(date -Is)" "$*"; }

# L'identifiant de l'image RÉELLEMENT utilisée par chaque conteneur en cours.
# On ne lit pas le nom de l'image dans le fichier de composition : il change
# quand on renomme un dépôt, et une comparaison de noms se tromperait le jour
# où deux étiquettes désignent le même contenu.
empreintes_courantes() {
  local service
  for service in "${SERVICES[@]}"; do
    printf '%s=%s\n' "$service" "$("${COMPOSE[@]}" images --quiet "$service" 2>/dev/null | head -1)"
  done
}

#
# La santé, en deux temps.
#
# L'application d'abord, interrogée DEPUIS L'INTÉRIEUR du réseau Docker : on
# vérifie le serveur, pas le DNS ni le certificat, qui ont leurs propres
# pannes et les signaleraient à tort comme un défaut de la nouvelle image.
#
# La terminaison TLS ensuite, sur le port public. Sans elle, une image de
# Caddy cassée passerait inaperçue — le serveur répondrait parfaitement, et
# la console resterait injoignable pour tout le monde.
#
en_bonne_sante() {
  local reste=$DELAI_SANTE
  while [ "$reste" -gt 0 ]; do
    if "${COMPOSE[@]}" exec -T serveur node -e \
        'fetch("http://127.0.0.1:3000/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
        >/dev/null 2>&1 \
       && curl -fsS -k -o /dev/null --max-time 5 https://127.0.0.1/health 2>/dev/null; then
      return 0
    fi
    sleep 3
    reste=$((reste - 3))
  done
  return 1
}

AVANT="$(empreintes_courantes)"

journal "recherche de nouvelles images"
"${COMPOSE[@]}" pull --quiet "${SERVICES[@]}"

# `pull` ne dit pas s'il a ramené quelque chose, et `up -d` ne recrée un
# conteneur que si son image a changé. On applique donc, puis on compare :
# quand rien n'a bougé, l'opération n'aura été qu'une formalité.
if [ "${1:-}" = "--verifier" ]; then
  journal "images tirées ; rien n'a été appliqué"
  exit 0
fi

journal "application"
"${COMPOSE[@]}" up -d "${SERVICES[@]}"

APRES="$(empreintes_courantes)"
if [ "$AVANT" = "$APRES" ]; then
  journal "déjà à jour"
  exit 0
fi

if en_bonne_sante; then
  journal "mise à jour appliquée"
  exit 0
fi

#
# Ça ne répond pas. On revient.
#
# Un serveur mort, c'est la console injoignable et les publications
# impossibles — les écrans, eux, continuent d'afficher ce qu'ils ont. Mais
# personne ne s'en aperçoit avant d'en avoir besoin, et c'est précisément le
# moment où l'on n'a pas le temps de diagnostiquer.
#
journal "aucune réponse après ${DELAI_SANTE}s"

RETOUR=()
while IFS='=' read -r service empreinte; do
  [ -n "$empreinte" ] || continue
  RETOUR+=("$service" "$empreinte")
done <<< "$AVANT"

if [ ${#RETOUR[@]} -eq 0 ]; then
  journal "aucune image précédente : rien vers quoi revenir, on laisse en l'état"
  exit 1
fi

journal "retour aux images précédentes"
# Les variables d'environnement que le fichier de composition consulte pour
# choisir ses images. On les force sur les empreintes d'avant : une empreinte
# désigne un contenu exact, là où une étiquette a déjà changé de sens.
for ((i = 0; i < ${#RETOUR[@]}; i += 2)); do
  case "${RETOUR[i]}" in
    serveur) export COULOIR_IMAGE="${RETOUR[i + 1]}" ;;
    tls) export COULOIR_IMAGE_TLS="${RETOUR[i + 1]}" ;;
  esac
done
"${COMPOSE[@]}" up -d "${SERVICES[@]}"

if en_bonne_sante; then
  journal "revenu aux images précédentes, tout répond"
  # Sortie en échec malgré le rétablissement : une mise à jour annulée doit
  # se voir dans le journal de la tâche planifiée, pas passer pour un succès.
  exit 1
fi

journal "rien ne répond, même sur les images précédentes"
exit 2
