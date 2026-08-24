-- L'identité de l'établissement.
--
-- Une seule ligne : il n'y a qu'une école par serveur. La contrainte le dit
-- plutôt que de laisser croire à une liste qu'il faudrait départager un jour.
--
-- Configurée et non codée en dur : ce logiciel n'appartient pas à un
-- établissement en particulier, et une couleur inscrite dans le noyau de
-- rendu se paierait en fourche le jour où un deuxième l'installe.
CREATE TABLE identite (
  unique_ligne  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (unique_ligne),
  nom           TEXT NOT NULL DEFAULT 'Établissement',
  accent        TEXT CHECK (accent ~ '^#[0-9a-fA-F]{6}$'),
  modifie_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);
