# Mettre le serveur en production

Trois services : la base, l'application, la terminaison TLS. Rien n'est lié à
un hébergeur particulier — ça tourne sur un VPS, sur une machine de l'école,
ou ailleurs.

## Avant de commencer

Il faut **un nom de domaine dont vous contrôlez la zone DNS**. Le certificat
s'obtient par vérification DNS, qui prouve ce contrôle — et non par
vérification HTTP, qui exigerait que le serveur soit joignable depuis
Internet.

C'est ce qui permet d'héberger sur le réseau interne d'un établissement sans
rien y ouvrir : l'enregistrement peut parfaitement pointer vers une adresse
privée. Il doit exister et résoudre, sinon les écrans ne trouveront pas le
serveur — mais personne d'autre n'a besoin de l'atteindre.

Il faut donc aussi **des identifiants d'API chez l'hébergeur de la zone**.
Le fichier `.env.exemple` détaille les droits à accorder, qui se limitent à
l'écriture d'enregistrements dans une seule zone.

Aucun flux entrant depuis Internet n'est nécessaire.

## L'installation

```bash
cd deploiement
cp .env.exemple .env
chmod 600 .env
```

Le `chmod` n'est pas décoratif : ce fichier porte le mot de passe de la base,
la clé de secours de la console et les identifiants d'écriture sur la zone
DNS. Par défaut il serait lisible par tout compte de la machine.

**Ces secrets ne vont nulle part ailleurs.** Ni dans le dépôt — il est public
et `.env` y est ignoré, mais l'habitude compte plus que le filet. Ni dans les
secrets d'intégration continue : ceux-là servent aux machines qui construisent,
et ne parviennent jamais au serveur qui renouvelle le certificat. Ni dans
l'image, qui est publique.

Gardez-en une copie dans un gestionnaire de mots de passe : la page d'OVH
n'affiche les identifiants qu'une seule fois.

Remplissez les trois valeurs. Les deux secrets se génèrent, ils ne s'inventent
pas :

```bash
openssl rand -base64 24   # COULOIR_MOT_DE_PASSE_BASE
openssl rand -base64 32   # COULOIR_CONSOLE_TOKEN
```

Construisez l'image, puis démarrez :

```bash
docker build -t couloir-serveur:latest ..
docker compose --env-file .env up -d
```

Le schéma de la base est appliqué au démarrage : il n'y a pas d'étape de
migration à lancer à la main. Les migrations sont jouées dans l'ordre, une
seule fois, et le serveur note celles qu'il a déjà passées.

Vérifiez :

```bash
docker compose ps          # les trois services, dont deux « healthy »
curl https://votre-domaine/health
```

## Ce qui doit être juste, sous peine de chercher longtemps

**`COULOIR_PUBLIC_URL`** est l'adresse inscrite dans les manifestes. C'est
avec elle que les écrans vont chercher les médias. Si elle est fausse — une
adresse interne, un `localhost` oublié — les écrans reçoivent des URL qu'ils
ne savent pas joindre, restent sur leur contenu précédent, et rien dans la
console ne le signale. L'assemblage la déduit du domaine ; ne la surchargez
pas sans raison.

**Le port de la base n'est pas publié.** Seul le serveur la joint, par le
réseau interne de Docker. Si vous avez besoin d'y accéder pour une
sauvegarde, passez par `docker compose exec base` plutôt que d'ouvrir le port.

**Caddy attend jusqu'à 120 s** sur les requêtes vers le serveur. Ce n'est pas
un excès de prudence : le canal de commandes retient sa réponse 25 secondes,
et un délai plus court la couperait — chaque écran repartirait alors dans une
reconnexion inutile toutes les quelques secondes.

## Sauvegarder

Deux choses à conserver, et elles ne se remplacent pas l'une l'autre :

```bash
# La base : écrans, emplois du temps, historique des publications.
docker compose exec -T base pg_dump -U couloir couloir | gzip > base-$(date +%F).sql.gz

# Les médias : les fichiers eux-mêmes.
docker run --rm -v deploiement_medias:/m -v "$PWD":/sortie alpine \
  tar czf /sortie/medias-$(date +%F).tar.gz -C /m .
```

Une base sans les médias donne des manifestes qui référencent des fichiers
absents. Des médias sans la base ne disent pas quel écran affichait quoi.

## Mettre à jour

Le serveur va chercher lui-même. Personne n'entre sur le réseau du campus :
**c'est lui qui sort**, vers le registre, en HTTPS — comme il sort déjà pour
NetYPareo. Ni port à ouvrir, ni tunnel permanent à négocier.

```bash
sudo install -m 644 couloir-maj.service couloir-maj.timer /etc/systemd/system/
sudo systemctl enable --now couloir-maj.timer
```

Mettre en production devient alors : publier une image. Le serveur la prendra
la nuit suivante.

Pour l'appliquer tout de suite, ou pour voir s'il y a du nouveau :

```bash
./mise-a-jour.sh
./mise-a-jour.sh --verifier
```

Le script tire, bascule, **attend que le serveur réponde, et revient à
l'image précédente s'il ne répond pas**. Il sort en échec même quand le retour
a réussi : une mise à jour annulée doit se voir dans le journal, pas passer
pour un succès.

Le délai d'attente est de 90 secondes, réglable par `COULOIR_DELAI_SANTE`.
Les migrations de base tournent au démarrage : trop court, on annulerait une
mise à jour saine qui n'avait pas fini de s'appliquer.

### Construire soi-même, sans registre

```bash
git pull
docker build -t couloir-serveur:latest ..
docker compose --env-file .env up -d serveur
```

Utile pour une machine isolée. Sur un Raspberry, c'est long : construire une
image Node sur ARM prend un temps déraisonnable, et c'est précisément ce que
le registre évite.

Les écrans ne perdent rien pendant le redémarrage : ils continuent d'afficher
ce qu'ils ont en cache, et reprennent contact dans les secondes qui suivent.
Mesuré : le canal de commandes se rétablit en 6,9 s, le manifeste est repollé
à 12,8 s.

## Si l'établissement n'a pas de domaine

Le domaine n'a pas à être le sien. Un sous-domaine d'une zone que vous
contrôlez déjà convient — et vaut souvent mieux : l'établissement n'a alors
rien à fournir, et le renouvellement ne dépend d'aucune demande à son service
informatique.

Deux choses à savoir avant de choisir cette voie :

- **Les écrans dépendront d'un domaine qui n'appartient pas à
  l'établissement.** Si la zone expire ou si la relation s'arrête, ses
  couloirs tombent. Que ce soit un choix écrit, pas une surprise.
- **L'adresse privée devient publiquement lisible**, et le nom du
  sous-domaine apparaît dans les journaux de transparence des certificats.
  Sans gravité — une adresse privée ne mène nulle part de l'extérieur — mais
  choisissez un nom neutre si la discrétion compte.

Reste l'autorité interne de Caddy (`tls internal`), qui n'exige aucun domaine
mais demande de déposer le certificat racine sur chaque écran, faute de quoi
l'agent refuse la connexion — et il a raison de la refuser.

## Ce qui n'est pas encore là

- **La réinitialisation de mot de passe par courriel.** Un administrateur en
  donne un nouveau de vive voix ; le serveur n'envoie aucun message.
- **Les URL de médias signées.** Un média est servi à qui connaît son
  identifiant, sans expiration.
- **La sauvegarde automatique.** Les commandes ci-dessus sont à mettre dans
  une tâche planifiée ; personne ne l'a fait.
- **La pose du certificat racine sur les écrans.** Si l'établissement retient
  l'autorité interne plutôt qu'un domaine public, l'installateur doit déposer
  le certificat sur chaque boîtier. Il ne le fait pas encore, et sans lui
  l'agent refuse la connexion — à raison.
