#!/usr/bin/env bash
#
# Ferme l'authentification par mot de passe sur les boîtiers.
#
# À lancer APRÈS avoir posé sa clé, jamais depuis l'installateur : une machine
# neuve n'a encore aucune clé, et couper les mots de passe à ce moment-là la
# rendrait injoignable — il faudrait un clavier et un écran pour la récupérer.
#
#   ./durcir-ssh.sh utilisateur@adresse [utilisateur@adresse ...]
#
# Le contrôle préalable n'est pas une politesse : c'est lui qui distingue
# « fermer une porte » de « s'enfermer dehors ». Rien n'est modifié tant que
# la clé n'a pas répondu sur CHAQUE machine.
set -euo pipefail

[ $# -gt 0 ] || { echo "usage: $0 utilisateur@adresse [...]" >&2; exit 2; }

echo "→ contrôle : la clé fonctionne-t-elle partout ?"
for cible in "$@"; do
  if ssh -o BatchMode=yes -o ConnectTimeout=8 "$cible" true 2>/dev/null; then
    echo "   $cible : oui"
  else
    echo "   $cible : NON — on s'arrête, rien n'a été modifié" >&2
    exit 1
  fi
done

echo "→ fermeture des mots de passe"
for cible in "$@"; do
  ssh -o BatchMode=yes "$cible" "sudo tee /etc/ssh/sshd_config.d/10-couloir.conf >/dev/null <<'CONF'
# Posé par Couloir. Ces machines vivent sur un réseau où des élèves sont
# branchés : un mot de passe finit par être deviné ou réutilisé. Les clés
# sont en place, et l'accès au clavier sur place n'est pas concerné.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
CONF
sudo sshd -t && { sudo systemctl reload ssh 2>/dev/null || sudo systemctl reload sshd; }"
  echo "   $cible : fermé"
done

echo "→ vérification"
for cible in "$@"; do
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$cible" true 2>/dev/null \
    || { echo "   $cible : la clé ne passe plus — À RÉPARER TOUT DE SUITE" >&2; exit 1; }
  refus=$(ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password \
              -o ConnectTimeout=8 "$cible" true 2>&1 | tail -1)
  case "$refus" in
    *publickey*) echo "   $cible : clé oui, mot de passe refusé" ;;
    *) echo "   $cible : le mot de passe est ENCORE accepté — $refus" >&2 ;;
  esac
done
