-- Le branchement sur NetYPareo.
--
-- Une ligne par afficheur : NetYPareo en configure un par bâtiment, et nos
-- écrans portent déjà un bâtiment. La correspondance se fait donc toute
-- seule — un écran du bâtiment A lit l'afficheur du bâtiment A.
--
-- `batiment` vide = l'afficheur par défaut, celui que prennent les écrans
-- dont le bâtiment n'est pas apparié.
CREATE TABLE netypareo_afficheurs (
  afficheur   TEXT PRIMARY KEY,
  batiment    TEXT,
  libelle     TEXT NOT NULL DEFAULT '',
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- L'adresse de l'instance, une seule par établissement.
CREATE TABLE netypareo (
  unique_ligne  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (unique_ligne),
  base_url      TEXT NOT NULL,
  actif         BOOLEAN NOT NULL DEFAULT TRUE,
  modifie_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);
