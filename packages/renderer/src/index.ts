/**
 * @couloir/renderer — le noyau de rendu, identique sur toutes les plateformes.
 *
 * Deux moitiés bien séparées :
 *   - la décision (`director`, `rotation`, `schedule`, `staleness`,
 *     `readability`) : logique pure, sans DOM, testable sans navigateur ;
 *   - l'application (`dom/`) : du DOM et du CSS, sans framework, pour tourner
 *     aussi bien dans Chromium sur un Raspberry Pi que dans le WebView d'un
 *     boîtier Android ou une application Tizen.
 *
 * Un contenu validé sur un poste de développement s'affiche à l'identique sur
 * n'importe quel écran du parc, à résolution et orientation égales.
 */
export * from "./time.js";
export * from "./staleness.js";
export * from "./schedule.js";
export * from "./readability.js";
export * from "./rotation.js";
export * from "./director.js";
export * from "./player-host.js";
export * from "./dom/mount.js";
export * from "./dom/styles.js";
