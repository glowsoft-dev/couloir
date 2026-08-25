import { useEffect, useState } from "react";
import { api } from "./api.js";

/**
 * Le premier jour.
 *
 * Une seule chose à faire, et elle est écrite. Ce n'était pas le cas : la
 * page montrait le même en-tête et les mêmes compteurs que d'habitude, avec
 * un « 0 en ligne » et un bloc de texte au milieu. On ne savait pas par où
 * commencer.
 *
 * La dalle dessinée montre ce que le boîtier affichera : un code, et
 * l'adresse à laquelle il s'est annoncé. C'est la seule chose qu'on aura à
 * recopier, et la voir d'avance évite de croire à une panne devant un écran
 * qui ne montre « que » ça.
 */

export function AucunEcran({ onPoser }: { onPoser?: () => void }) {
  const [hote, setHote] = useState<string | null>(null);

  useEffect(() => {
    void api
      .installation()
      .then((r) => {
        try {
          setHote(new URL(r.adresse).host);
        } catch {
          setHote(r.adresse);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="premier-jour">
      <div className="premier-jour-bloc">
        <div className="premier-jour-dalle">
          <span className="premier-jour-mention">En attente de rattachement</span>
          <span className="premier-jour-code">••• •••</span>
          <span className="premier-jour-hote">{hote ?? " "}</span>
        </div>

        <h1>Aucun écran pour l'instant</h1>
        <p className="premier-jour-phrase">
          Branchez un boîtier sur un écran. Il affichera un code, et apparaîtra ici tout seul —
          vous n'aurez qu'à dire où il se trouve.
        </p>

        {onPoser && (
          <button type="button" className="primary premier-jour-action" onClick={onPoser}>
            Poser mon premier écran
          </button>
        )}

        {/* Une durée annoncée évite d'interrompre l'installation au bout de
            cinq minutes en croyant que ça a échoué. */}
        <p className="premier-jour-duree">Comptez une vingtaine de minutes, dont quinze d'attente.</p>
      </div>
    </div>
  );
}
