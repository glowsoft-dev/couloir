// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { RENDERER_CSS } from "./styles.js";

/**
 * Le contenu doit être visible SANS que la moindre animation s'exécute.
 *
 * Régression constatée sur un écran réel : la diapositive partait d'une
 * opacité nulle et ne devenait visible qu'une fois le fondu terminé. Dès que
 * le navigateur gèle ses animations — page en arrière-plan, compositeur qui
 * cale, dalle rallumée après une extinction — l'écran restait noir.
 *
 * Un écran de couloir ne doit jamais dépendre d'une animation pour afficher
 * quelque chose. Le fondu est décoratif, rien de plus.
 */

/** Extrait les déclarations d'un sélecteur dans la feuille de style. */
function rulesFor(selector: string): string {
  const pattern = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, "g");
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(RENDERER_CSS)) !== null) found.push(match[1] ?? "");
  return found.join(" ");
}

describe("visibilité sans animation", () => {
  it("une diapositive est opaque dès son insertion", () => {
    const declarations = rulesFor(".couloir-slide");
    expect(declarations).toMatch(/opacity:\s*1/);
    expect(declarations).not.toMatch(/opacity:\s*0\s*;/);
  });

  it("le fondu ne détermine pas l'état final", () => {
    // `forwards` ferait dépendre l'opacité finale de l'exécution du fondu.
    const declarations = rulesFor(".couloir-slide");
    expect(declarations).not.toMatch(/animation:[^;]*forwards/);
  });

  it("reste lisible quand les animations sont désactivées", () => {
    const reduced = RENDERER_CSS.slice(RENDERER_CSS.indexOf("prefers-reduced-motion"));
    expect(reduced).toMatch(/animation:\s*none/);
    // Aucune remise à 1 nécessaire : la valeur de base est déjà bonne.
    expect(reduced.slice(0, 200)).not.toMatch(/opacity:\s*0/);
  });

  it("le rendu appliqué à un document sans moteur d'animation reste visible", () => {
    const style = document.createElement("style");
    style.textContent = RENDERER_CSS;
    document.head.appendChild(style);

    const slide = document.createElement("div");
    slide.className = "couloir-slide";
    document.body.appendChild(slide);

    // happy-dom n'exécute aucune animation : c'est exactement le cas qu'on veut.
    expect(getComputedStyle(slide).opacity).toBe("1");
  });
});
