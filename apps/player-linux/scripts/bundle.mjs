import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Produit l'artefact déployable du player.
 *
 * Le dépôt utilise des espaces de travail pnpm : `node_modules` y est un
 * maillage de liens symboliques vers le monorepo, impossible à copier tel
 * quel sur un boîtier. On livre donc deux fichiers autonomes :
 *
 *   couloir-player.mjs  l'agent et son serveur local, tout inclus
 *   couloir.js          le noyau de rendu servi au navigateur
 *
 * Deux fichiers à déposer, rien à installer : c'est aussi ce qui rend la
 * mise à jour d'un parc de quarante écrans supportable.
 */
const here = fileURLToPath(new URL("..", import.meta.url));
const out = `${here}dist-bundle`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const result = await build({
  entryPoints: [`${here}src/main.ts`],
  outfile: `${out}/couloir-player.mjs`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // Les modules natifs de Node restent externes ; tout le reste est inclus.
  packages: "bundle",
  logLevel: "info",
  metafile: true,
});

await cp(
  fileURLToPath(new URL("../../../packages/renderer/dist-browser/couloir.js", import.meta.url)),
  `${out}/couloir.js`,
);

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
console.log(`artefact prêt : ${out} (${Math.round(bytes / 1024)} ko)`);
