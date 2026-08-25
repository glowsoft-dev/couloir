/**
 * @couloir/agent — la logique commune à toutes les plateformes.
 *
 * L'agent ne sait ni lire un fichier, ni ouvrir une connexion : il passe par
 * les portes définies dans `ports.ts`, que chaque coque implémente. C'est ce
 * découpage qui rend le multiplateforme abordable — et qui permet de tester
 * toute la résilience en mémoire, sans matériel.
 */
export * from "./ports.js";
export * from "./backoff.js";
export * from "./state.js";
export * from "./runtime.js";
export * from "./sources.js";
export * from "./mise-a-jour.js";
