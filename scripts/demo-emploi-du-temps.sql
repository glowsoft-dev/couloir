-- Un emploi du temps de démonstration.
--
-- Sans lui, « Changements du jour » s'ouvre sur une page vide : on ne peut
-- ni signaler une absence ni voir l'aperçu, c'est-à-dire ni éprouver ce que
-- la page fait. Quatre classes et une semaine type suffisent.
--
-- Posé en SQL et non par l'API : la création d'un emploi du temps demande un
-- compte, et la démonstration monte la base avant qu'aucun compte n'existe.
-- La clé de secours n'ouvre que les comptes, à dessein.
--
-- Ne s'applique que si la table des classes est vide : relancer la
-- démonstration ne doit rien écraser de ce qu'on y a saisi.

DO $$
DECLARE
  creneaux TEXT[][] := ARRAY[
    ['M1','08:00','08:55'], ['M2','09:00','09:55'], ['M3','10:10','11:05'],
    ['M4','11:10','12:05'], ['S1','13:30','14:25'], ['S2','14:30','15:25'],
    ['S3','15:40','16:35']
  ];
  cours TEXT[][] := ARRAY[
    ['SIO1','M1','Mathématiques','M. Dupont','B 104'],
    ['SIO1','M3','Anglais','Mme Roche','A 112'],
    ['SIO1','M4','Économie-droit','Mme Bréan','A 210'],
    ['SIO1','S1','Développement web','M. Vasseur','A 210'],
    ['SIO1','S3','Culture générale','Mme Lantier','B 011'],
    ['MCO2','M2','Relation client','Mme Fournet','C 004'],
    ['MCO2','M4','Gestion opérationnelle','M. Bailly','C 006'],
    ['MCO2','S2','Anglais','Mme Roche','A 112'],
    ['EVS2','M1','Vente-conseil','M. Perrin','D 002'],
    ['EVS2','S1','Atelier vitrine','Mme Nadaud','Atelier D'],
    ['MELEC','M2','Habilitation électrique','M. Guyot','Atelier E'],
    ['MELEC','S1','Schémas','M. Guyot','E 101']
  ];
  classes TEXT[][] := ARRAY[
    ['SIO1','BTS SIO 1','BTS 1re année'],
    ['MCO2','BTS MCO 2','BTS 2e année'],
    ['EVS2','CAP EVS 2','CAP 2e année'],
    ['MELEC','BAC PRO MELEC','Bac pro']
  ];
  i INTEGER;
  jour INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM classes) THEN RETURN; END IF;

  FOR i IN 1 .. array_length(creneaux, 1) LOOP
    INSERT INTO periods (id, label, starts_at, ends_at, position)
    VALUES (gen_random_uuid(), creneaux[i][1], creneaux[i][2], creneaux[i][3], i);
  END LOOP;

  FOR i IN 1 .. array_length(classes, 1) LOOP
    INSERT INTO classes (id, code, label, level, position)
    VALUES (gen_random_uuid(), classes[i][1], classes[i][2], classes[i][3], i);
  END LOOP;

  -- La même semaine du lundi au vendredi : on éprouve une journée, pas un
  -- calendrier. Le samedi reste vide, ce qui montre aussi la page sans cours.
  FOR jour IN 1 .. 5 LOOP
    FOR i IN 1 .. array_length(cours, 1) LOOP
      INSERT INTO lessons (id, class_id, subject_label, teacher_name, room_code, day_of_week, period_id)
      SELECT gen_random_uuid(), c.id, cours[i][3], cours[i][4], cours[i][5], jour, p.id
      FROM classes c, periods p
      WHERE c.code = cours[i][1] AND p.label = cours[i][2];
    END LOOP;
  END LOOP;
END $$;
