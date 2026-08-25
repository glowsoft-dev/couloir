# Ce qu'il faut au service informatique

Document à transmettre au service informatique du campus. Il décrit ce que
l'affichage des couloirs demande au réseau, ce qu'il ne demande pas, et les
trois décisions qui appartiennent à l'établissement.

---

## En une phrase

Un petit serveur sur le réseau interne, que les écrans interrogent. **Rien
n'entre depuis Internet.** Le serveur sort en HTTPS pour trois choses, et
c'est tout.

## Les machines

| | Quoi | Où |
|---|---|---|
| **Le serveur** | un Raspberry Pi 5, disque SSD, sur onduleur | en baie, ou dans un local technique fermé |
| **Les écrans** | un Raspberry Pi 4 derrière chaque dalle | dans les couloirs |

Les écrans sont dans des lieux publics et physiquement accessibles. **Ils ne
détiennent rien de sensible** : ni base, ni mot de passe, ni console. Ils
reçoivent des images et un emploi du temps, rien d'autre.

Le serveur, lui, détient la base et les comptes. C'est pourquoi il n'est pas
dans un couloir.

## Les flux à autoriser

### Sur le réseau interne

| De | Vers | Port | Pourquoi |
|---|---|---|---|
| Écrans | Serveur | 443/tcp | contenu, emploi du temps, télémétrie |
| Postes du personnel | Serveur | 443/tcp | la console d'administration |

Si les écrans et le serveur ne sont pas sur le même VLAN, c'est ce flux-là
qu'il faut ouvrir — **dans ce sens uniquement**.

### Vers Internet, depuis le serveur seul

| Destination | Port | Pourquoi |
|---|---|---|
| `netypareo.campusmetiersmarzy.com` | 443/tcp | les emplois du temps |
| `campus.byccinievre.fr` | 443/tcp | les actualités du site |
| `ghcr.io` et `pkg-containers.githubusercontent.com` | 443/tcp | les mises à jour du logiciel |
| serveur de temps (NTP) | 123/udp | voir plus bas |

L'heure n'est pas un détail : un écran dont l'horloge a dérivé afficherait
l'emploi du temps de la veille en le présentant comme celui du jour. Le
logiciel refuse de le faire — il retire la colonne plutôt que de mentir — mais
le couloir perd alors une information utile.

## Ce qui n'est PAS demandé

**Aucun flux entrant depuis Internet.** Ni port ouvert, ni redirection, ni
adresse publique.

**Aucun port ouvert sur les écrans.** Ils n'écoutent que sur leur propre
interface locale ; rien ne les joint depuis le réseau. Toutes leurs
communications sont sortantes, vers le serveur.

**Aucun accès permanent pour le prestataire.** Voir la troisième décision.

---

## Les trois décisions qui vous appartiennent

### 1. Le certificat

Les écrans refusent une connexion dont ils ne peuvent pas vérifier le
certificat. C'est délibéré : un boîtier qui accepterait n'importe quel
certificat accepterait n'importe quel serveur. Deux chemins :

**Un nom de domaine public pointant vers l'adresse privée du serveur.** Le
certificat est obtenu automatiquement par vérification DNS. Rien à installer
sur les écrans. Demande un accès à la zone DNS de `byccinievre.fr`.

**Une autorité interne.** Aucun domaine public nécessaire, mais le certificat
racine doit être installé sur chaque écran. C'est fait par le script
d'installation, donc sans geste manuel — à condition que ce script reste celui
qu'on utilise pour poser un nouvel écran dans deux ans.

*Recommandation : le premier, s'il est possible.*

### 2. Où se trouve le serveur

Même VLAN que les écrans, ou VLAN séparé avec le flux ci-dessus ouvert. La
seconde option est plus propre si les couloirs sont sur un réseau distinct de
celui du personnel — la console est alors jointe depuis le réseau du
personnel, et les écrans depuis le leur.

### 3. L'accès de dépannage

**Pour le fonctionnement courant, aucun accès distant n'est nécessaire.** Les
mises à jour sont *tirées* par le serveur, qui sort vers le registre : rien
n'entre. Les écrans se mettent à jour depuis le serveur, de la même façon.

L'accès distant ne sert donc qu'à **diagnostiquer** une panne. Trois options,
du plus au moins ouvert :

| Option | Ce que ça donne | Ce que ça coûte |
|---|---|---|
| Tunnel sortant permanent (WireGuard, Tailscale) | intervention immédiate | un accès permanent à un tiers |
| VPN prestataire existant | intervention sur demande | rien de nouveau, s'il existe |
| Aucun | rien à ouvrir | un déplacement à chaque diagnostic |

*Il n'y a pas de bonne réponse universelle. La deuxième, si un VPN prestataire
existe déjà, évite d'en créer un nouveau.*

---

## Ce que le service informatique doit fournir

- Une prise réseau et une adresse fixe (ou un bail DHCP réservé) pour le serveur
- Une prise réseau par écran
- La décision sur le certificat, et l'accès DNS le cas échéant
- La décision sur l'accès de dépannage

## Ce qui reste à notre charge

- L'installation et la configuration des machines
- Les mises à jour du logiciel
- La sauvegarde de la base et des médias — **à définir avec vous** : elle
  n'existe pas encore, et une base sur une seule machine reste une base sur
  une seule machine.
