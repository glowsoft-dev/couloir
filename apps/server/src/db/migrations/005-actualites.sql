-- Le réglage du connecteur d'actualités.
--
-- Une seule ligne : il n'y a qu'un site d'école. La contrainte le dit plutôt
-- que de laisser croire à une liste qu'il faudrait départager un jour.
CREATE TABLE reglages_actualites (
  unique_ligne  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (unique_ligne),
  url           TEXT NOT NULL,
  -- Identifiant de catégorie WordPress, pour ne remonter qu'une rubrique —
  -- « Vie de l'école » plutôt que tout le site.
  categorie     TEXT,
  nombre        INTEGER NOT NULL DEFAULT 5 CHECK (nombre BETWEEN 1 AND 20),
  actif         BOOLEAN NOT NULL DEFAULT TRUE,
  modifie_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);
