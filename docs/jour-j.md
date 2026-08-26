# Le jour de l'installation

Le déroulé, dans l'ordre. Rien ici ne suppose de connaître le projet : c'est
fait pour être suivi sur place, sur un téléphone, entre deux couloirs.

**L'ordre compte.** Le serveur doit exister et son nom doit résoudre avant
qu'un seul écran ne s'installe : chaque boîtier va chercher son logiciel sur
le serveur, et échouera si celui-ci n'est pas debout.

---

## À emporter

- Le **Pi 5** avec son SSD, son alimentation, son boîtier, l'onduleur
- Les **Pi 4**, un par écran, avec alimentations, boîtiers, câbles HDMI
- Une **carte microSD par écran**, plus deux de rechange
- Un **portable** avec un lecteur de cartes, ce dépôt, et Raspberry Pi Imager
- Un **clavier USB et un écran** — pour le serveur seulement, et seulement si
  l'accès distant n'est pas prêt
- Les **trois valeurs OVH**, dans votre gestionnaire de mots de passe

---

## 1. Le serveur

### 1.1 Graver le système

Raspberry Pi Imager → **Raspberry Pi OS Lite (64-bit)** sur le SSD.

Dans les réglages de l'Imager (l'engrenage), avant de graver :

- nom de machine : `couloir-serveur`
- activer SSH, avec un mot de passe
- votre compte et votre mot de passe

Pas d'interface graphique : le serveur n'affiche rien.

### 1.2 Démarrer et fixer l'adresse

Branchez le SSD, le réseau, l'alimentation. Attendez deux minutes, puis
connectez-vous :

```bash
ssh couloir-serveur.local
```

Fixez l'adresse que le campus vous a réservée. Une adresse qui change au
prochain bail casserait tous les écrans d'un coup :

```bash
sudo nmtui
```

*Edit a connection* → votre interface → *IPv4 CONFIGURATION* → **Manual** →
adresse, passerelle, DNS. Puis redémarrez la connexion.

Notez l'adresse obtenue :

```bash
hostname -I
```

### 1.3 Créer l'enregistrement DNS

Sur OVH, zone `glowsoft.fr` :

| | |
|---|---|
| Type | `A` |
| Sous-domaine | `couloir-cci` |
| Cible | l'adresse notée ci-dessus |
| TTL | 60 |

Vérifiez qu'il résout, **depuis le réseau du campus** :

```bash
getent hosts couloir-cci.glowsoft.fr
```

Tant que cette commande ne rend rien, n'allez pas plus loin.

### 1.4 Installer Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Déconnectez-vous et reconnectez-vous pour que le groupe s'applique.

### 1.5 Poser l'application

```bash
sudo mkdir -p /opt/couloir && sudo chown "$USER" /opt/couloir
git clone https://github.com/glowsoft-dev/couloir.git /opt/couloir
cd /opt/couloir/deploiement
cp .env.exemple .env
chmod 600 .env
nano .env
```

Remplissez :

- `COULOIR_DOMAINE=couloir-cci.glowsoft.fr`
- les **trois valeurs OVH** de votre gestionnaire de mots de passe
- deux secrets à générer ici même :

```bash
openssl rand -base64 24   # COULOIR_MOT_DE_PASSE_BASE
openssl rand -base64 32   # COULOIR_CONSOLE_TOKEN
```

Gardez la clé de secours : elle crée le premier compte, et rouvre la porte si
le dernier administrateur perd son mot de passe.

### 1.6 Démarrer

```bash
docker compose --env-file .env up -d
docker compose --env-file .env logs -f tls
```

Attendez la ligne qui dit que le certificat est obtenu. Comptez une à deux
minutes — le temps que Let's Encrypt vérifie l'enregistrement DNS.

Si vous lisez `OVHcloud API error`, les identifiants sont en cause : reprenez
le `.env`. Si vous lisez une erreur de zone, le domaine du `.env` ne
correspond pas à celle du jeton.

### 1.7 Vérifier

```bash
curl https://couloir-cci.glowsoft.fr/health
```

Une réponse, sans avertissement de certificat : le serveur est prêt.

### 1.8 Créer le premier compte

Ouvrez `https://couloir-cci.glowsoft.fr` depuis un poste du campus.

La console demande la **clé de secours** — celle du `.env` — puis votre nom,
votre adresse et un mot de passe. Ce compte est administrateur.

### 1.9 Armer les mises à jour

```bash
sudo install -m 644 couloir-maj.service couloir-maj.timer /etc/systemd/system/
sudo systemctl enable --now couloir-maj.timer
```

Le serveur ira désormais chercher ses mises à jour chaque nuit, tout seul.

---

## 2. Les écrans

À faire **une fois par écran**, et seulement après que l'étape 1.7 a réussi.

### 2.1 Graver

Raspberry Pi Imager → **Raspberry Pi OS Lite (64-bit)** sur la microSD.

Ne réglez rien dans l'Imager : le script suivant s'en charge, et un réglage
de l'Imager écraserait le sien.

### 2.2 Préparer la carte

Carte toujours insérée dans le portable :

```bash
cd /opt/couloir   # ou l'endroit où vous avez cloné le dépôt
./scripts/preparer-carte.sh \
  --serveur https://couloir-cci.glowsoft.fr \
  --nom hall-central
```

En Wi-Fi, ajoutez `--wifi "NomDuReseau" --clef "motdepasse"`. En filaire, il
n'y a rien à préciser — et le filaire vaut mieux pour un écran qui doit tenir
des années.

Le `--nom` sert à retrouver le boîtier sur le réseau : minuscules, chiffres et
tirets. Un nom par écran, jamais deux fois le même.

### 2.3 Poser

Éjectez la carte, mettez-la dans le boîtier, branchez l'écran et
l'alimentation.

**Comptez une dizaine de minutes.** Le boîtier rejoint le réseau, télécharge
son logiciel depuis le serveur, redémarre, et affiche enfin **un code à six
caractères**.

Rien ne s'affiche au bout d'un quart d'heure ? Retirez la carte, remettez-la
dans le portable, et ouvrez `couloir-installation.log` : tout y est écrit.
C'est la seule façon de diagnostiquer sans brancher un clavier.

### 2.4 Rattacher

Dans la console, onglet **Mes écrans** : le boîtier apparaît tout seul, avec
son code.

Saisissez le code, puis dites où il se trouve — bâtiment, étage, zone. C'est
ce que vous lirez ensuite partout dans la console.

Répétez pour chaque écran.

---

## 3. Une fois tous les écrans posés

**Réglages → Identité** : le nom de l'établissement et sa couleur. Ils
apparaissent sur la carte d'identité de chaque écran.

**Réglages → Emploi du temps externe** : l'adresse de NetYPareo et les
afficheurs. Essayez-en un avant de le brancher — l'aperçu montre ce que les
élèves liront, et signale les séances qui portent un nom de personne.

**Mes écrans → un écran → Contenu** : la première publication.

---

## Ce qui reste après

- **La sauvegarde.** Elle n'est pas automatique. Tant qu'elle ne l'est pas, la
  base vit sur un seul disque.
- **Le module RTC.** Sans lui, une coupure de courant sans réseau fait
  redémarrer un boîtier à une date fantaisiste, et la programmation horaire
  part de travers. Le logiciel refuse alors d'afficher un emploi du temps
  périmé — mais le couloir perd l'information.
