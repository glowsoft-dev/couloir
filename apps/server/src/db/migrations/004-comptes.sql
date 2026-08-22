-- Comptes nominatifs, sessions et journal des actions.
--
-- Jusqu'ici la console était protégée par un jeton unique, partagé par tous
-- ceux qui publient. Trois conséquences : personne ne peut être retiré sans
-- changer le secret de tout le monde, personne ne peut être limité à ce qui
-- le concerne, et rien ne dit qui a publié quoi.

CREATE TABLE utilisateurs (
  id            UUID PRIMARY KEY,
  -- L'adresse sert d'identifiant de connexion. Normalisée en minuscules à
  -- l'écriture : une école écrira « Valerie@… » un jour et « valerie@… » le
  -- lendemain, et ce serait deux comptes.
  courriel      TEXT NOT NULL UNIQUE,
  nom           TEXT NOT NULL,
  -- scrypt, avec son sel et ses paramètres inscrits dans la valeur. Les
  -- paramètres vieillissent : les stocker permet de rehacher au vol le jour
  -- où on les durcit, sans invalider les mots de passe existants.
  empreinte     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('administrateur', 'editeur', 'lecteur')),
  -- Désactivé plutôt que supprimé : le journal continue de nommer qui a
  -- publié, même une fois la personne partie.
  actif         BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  derniere_connexion TIMESTAMPTZ
);

-- Les sessions sont opaques et stockées hachées.
--
-- Un jeton en clair en base se lit dans une sauvegarde ou un vidage ; haché,
-- il ne sert plus à rien une fois volé. Le principe est le même que pour un
-- mot de passe, et le coût est nul : SHA-256 suffit ici, puisque la valeur
-- d'origine est déjà aléatoire et longue.
CREATE TABLE sessions (
  empreinte     TEXT PRIMARY KEY,
  utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expire_le     TIMESTAMPTZ NOT NULL,
  -- Pour qu'on puisse dire « déconnectez la session ouverte au CDI ».
  agent         TEXT
);

CREATE INDEX sessions_utilisateur ON sessions (utilisateur_id);
CREATE INDEX sessions_expiration ON sessions (expire_le);

-- Le journal des actions.
--
-- On n'y met que ce qui change quelque chose pour quelqu'un : publier,
-- déclencher une urgence, redémarrer un boîtier, toucher aux comptes.
-- Consulter n'y figure pas — un journal que personne ne lit parce qu'il est
-- noyé ne sert à rien.
CREATE TABLE journal (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  au            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Conservé même si le compte est supprimé : « qui » est justement ce que
  -- le journal doit retenir. D'où le ON DELETE SET NULL et la copie du nom.
  utilisateur_id UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  auteur        TEXT NOT NULL,
  action        TEXT NOT NULL,
  cible         TEXT,
  details       JSONB
);

CREATE INDEX journal_au ON journal (au DESC);
