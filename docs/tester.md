# Éprouver le système

Une seule commande monte un couloir complet sur le poste : le serveur, deux
écrans simulés, la console.

```bash
pnpm demo
```

Elle démarre la base, reconstruit les paquets — un paquet de rendu périmé se
sert sans erreur et affiche l'ancienne version — puis lance le serveur et deux
lecteurs. Elle affiche ensuite trois adresses et les codes d'appairage.

| Onglet | Adresse | Ce que c'est |
|---|---|---|
| Console | `http://localhost:3000` | ce que voit la personne qui publie · jeton `demo-couloir` |
| Écran 1 | `http://127.0.0.1:8080` | un vrai lecteur, pas une maquette |
| Écran 2 | `http://127.0.0.1:8081` | le second, pour éprouver ce qui vise tout le parc |

`Ctrl-C` arrête tout. `--neuf` repart d'une base vierge. `--journaux` montre
les journaux du serveur et des écrans.

Les deux écrans sont de vrais lecteurs : ils téléchargent les médias,
vérifient les empreintes SHA-256 et gardent leur contenu quand le réseau
tombe. Ce ne sont pas des aperçus.

Mettez la console et un écran côte à côte, sur deux moitiés d'écran. La
plupart des scénarios ci-dessous se jugent à l'œil, pas dans un journal.

---

## D'abord : rattacher les écrans

Onglet **Écrans**. Les deux boîtiers apparaissent d'eux-mêmes avec leur code —
on ne le recopie pas depuis le couloir. Renseignez bâtiment, étage et zone : le
code d'étiquette (`B·1·01`) se construit tout seul.

Regardez l'écran au même moment : il passe de son code d'appairage à son
identité définitive.

---

## Les scénarios qui valent le détour

### 1. Publier, et voir le délai réel

Onglet **Écrans**, choisissez un écran. Importez une image, ajoutez un texte,
écrivez un bandeau. L'**aperçu** en dessous se recompose à chaque frappe : ce
n'est pas une imitation, c'est le moteur de rendu réel alimenté par un
manifeste composé sur le même chemin que la publication.

Cliquez sur **Publier** en regardant l'écran. Il bascule dans la seconde.

> **Ce que ça éprouve** — que l'aperçu ne ment pas, et que la publication est
> poussée vers l'écran au lieu d'être attendue par lui.

### 2. Se tromper, et revenir en arrière

Juste après avoir publié, le message porte un lien **« Revenir à la version
N »**. Cliquez.

Publiez trois fois, puis dépliez **Historique des publications** et remettez
une version ancienne en ligne. Regardez le numéro : il *augmente*. Rien n'est
effacé — on republie l'ancien contenu sous un nouveau numéro, si bien qu'une
annulation s'annule elle-même.

> **Ce que ça éprouve** — la raison pour laquelle publier ne demande aucune
> confirmation. Une boîte de dialogue posée partout se clique sans être lue au
> bout de trois jours ; un lien lisible au bon moment se lit.

### 3. Rouvrir au lieu de recomposer

Rechargez la console, revenez sur le même écran. L'éditeur s'ouvre sur ce qui
est **déjà diffusé** : les contenus, leur ordre, le bandeau. Une ligne le
confirme — *« C'est exactement ce que l'écran diffuse en ce moment. »*

Changez un mot du bandeau : un badge **brouillon** apparaît. Cliquez sur
**Annuler mes modifications** : tout revient.

> **Ce que ça éprouve** — que corriger un détail ne demande pas de recomposer
> la diffusion entière de mémoire.

### 4. Couper le réseau

Le scénario du cahier des charges. Coupez le Wi-Fi du poste, ou arrêtez le
serveur seul :

```bash
lsof -ti tcp:3000 -sTCP:LISTEN | xargs kill
```

Regardez l'écran. **Il ne doit rien se passer** — le contenu continue de
tourner. Attendez, rechargez la page de l'écran, redémarrez-le même : le
manifeste et les médias sont sur disque.

Poussez plus loin : **redémarrez un écran pendant que le serveur est coupé**,
comme une coupure de courant en pleine panne réseau. Il retrouve son manifeste
et ses médias sur disque et se remet à afficher, sans rien demander à
personne. C'est le cas le plus dur, et c'est celui qui compte un lundi matin.

Relancez le serveur. L'écran revient tout seul.

> **Ce que ça éprouve** — la promesse centrale. Une panne réseau ne change
> rien à ce qui est affiché, et le retour est automatique.
>
> **Mesuré** après un redémarrage du serveur : le canal de commandes se
> rétablit en **6,9 s**, le manifeste est repollé à **12,8 s**. Sans le
> rattrapage décrit ci-dessous, ce serait 15 s, puis 1 min, puis 5 min — un
> parc entier mettrait de longues minutes à revenir après chaque déploiement.
>
> La raison est discrète : la grappe de connexions de l'écran garde des sockets
> morts après le redémarrage du serveur, si bien que la requête suivante échoue
> avant même de partir. L'écran en refait alors une immédiatement sur connexion
> neuve, au lieu d'appliquer son espacement.
>
> Attention en lisant la console : le voyant « en ligne » se déduit du dernier
> battement de cœur reçu, avec une fenêtre de trois minutes. Un écran peut donc
> paraître en ligne alors qu'il n'a pas encore repris contact. Pour mesurer le
> vrai retour, lancez la démonstration avec `--journaux` et regardez le premier
> appel à `/v1/devices/me/…` après le redémarrage.

### 5. L'urgence

Bouton **URGENCE**, en haut à droite. Un titre, un message. Regardez les
**deux** écrans : ils basculent ensemble, en plein écran contrasté.

Mesuré sur cette démonstration : **28 ms et 42 ms**, sur les deux écrans
lancés ensemble. Le cahier des charges demandait moins de dix secondes.

Levez l'urgence : les écrans reprennent exactement où ils en étaient.

> **Ce que ça éprouve** — que l'alerte ne dépend pas du cycle de
> synchronisation, et qu'elle vise tout le parc d'un geste.

### 6. Retrouver un écran dans un couloir

Panneau **Actions**, bouton **Identifier**. L'écran affiche son code et son
adresse IP en grand pendant trente secondes. C'est ce qui permet de repérer une
dalle à quatre mètres de haut sans monter.

Essayez aussi **Capturer** : sur un Mac sans serveur graphique, la réponse est
*« non disponible sur cette plateforme »*. C'est un refus explicite, pas une
panne à diagnostiquer — la distinction est délibérée.

### 7. L'extinction programmée, et son piège

Dépliez **Extinction automatique**, ajoutez une plage. Lisez le récapitulatif
en toutes lettres sous le réglage.

Réglez une plage qui commence dans deux minutes et attendez : l'écran s'éteint.
Déclenchez une urgence pendant ce temps — **il se rallume**.

> **Le piège** — les jours cochés désignent le soir où la plage *commence*.
> « Du lundi au vendredi, 19 h → 7 h 30 » éteint donc le vendredi soir jusqu'au
> samedi matin, alors que le samedi n'est pas coché. C'est la seule lecture
> naturelle de la phrase ; elle n'allait pas de soi dans le code, et onze tests
> la tiennent désormais.

### 8. L'emploi du temps

Onglet **Réglages** : créez une classe, des créneaux, un calendrier scolaire.
Onglet **Grille** : remplissez la semaine en cliquant dans les cases.
Onglet **Aujourd'hui** : signalez une absence ou un changement de salle.

Publiez sur un écran avec la mise en page **Contenu + colonne des cours**.
Sans sélection, toutes les classes défilent ; une seule classe, et l'écran
l'affiche en permanence.

> **Ce que ça éprouve** — le remplacement du logiciel d'emploi du temps de
> l'école, et le fait qu'un changement du matin se voie dans le couloir.

### 9. Le téléphone

Ouvrez la console sur votre téléphone, à l'adresse IP du poste plutôt que
`localhost` :

```bash
ipconfig getifaddr en0
```

C'est l'usage réel : appairer un écran et l'identifier debout dans un couloir,
un boîtier dans la main. Rien ne doit déborder latéralement.

---

## Ce que la démonstration locale ne montre pas

Trois choses ne s'éprouvent pas sur un poste de travail, et il faut le savoir
avant de conclure que tout marche :

- **La coupure de courant.** Un Raspberry Pi sans module RTC perd l'heure au
  redémarrage. L'agent le détecte et refuse d'appliquer la programmation
  horaire plutôt que d'éteindre une dalle au mauvais moment. Ça se vérifie sur
  du vrai matériel — ou dans la VM Linux (`apps/player-linux/lima/`).
- **Le pilotage réel de la dalle et la capture d'écran.** Ils dépendent de
  `vcgencmd`, `xset`, `scrot`. Sur un Mac, la réponse honnête est « non
  disponible ».
- **Le réseau de l'établissement.** Mandataires, filtrage, coupures franches.
  C'est le seul endroit où ça se découvre.
