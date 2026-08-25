import { useEffect, useState } from "react";

/**
 * La dalle, reproduite à côté du formulaire d'entrée.
 *
 * Ce n'est pas un ornement. La console pilote des écrans qu'on ne voit pas
 * depuis le bureau ; montrer à quoi ils ressemblent dès la page d'entrée dit
 * de quoi il est question, à quelqu'un qui ouvre l'outil pour la première
 * fois comme à celui qui s'y connecte tous les matins.
 *
 * Elle reprend les vraies couleurs et la vraie police du rendu — pas une
 * imitation approximative qui apprendrait quelque chose de faux.
 */

export function DalleDAccueil({
  nom,
  accent,
  code = "A·1·01",
}: {
  nom: string;
  accent?: string | null;
  code?: string;
}) {
  const [heure, setHeure] = useState(() => maintenant());

  useEffect(() => {
    // Une horloge figée sur une dalle se remarque tout de suite.
    const t = setInterval(() => setHeure(maintenant()), 20_000);
    return () => clearInterval(t);
  }, []);

  return (
    <aside className="dalle" style={accent ? { ["--dalle-accent" as string]: accent } : undefined}>
      <span className="dalle-mention">ce que vos écrans affichent en ce moment</span>

      <div className="dalle-contenu">
        <span className="dalle-eyebrow">Bienvenue</span>
        <span className="dalle-titre">{nom}</span>
        <span className="dalle-heure">{heure}</span>
      </div>

      <span className="dalle-code">{code}</span>
    </aside>
  );
}

function maintenant(): string {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
