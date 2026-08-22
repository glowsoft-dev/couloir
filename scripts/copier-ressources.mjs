#!/usr/bin/env node
/**
 * Recopie dans `dist` les fichiers que TypeScript ignore.
 *
 * `tsc` ne connaît que le TypeScript : les migrations SQL restent dans `src`
 * et le serveur déployé démarre sans schéma, puis s'arrête sur un ENOENT.
 * Le défaut est invisible en développement, où l'on exécute les sources — il
 * n'apparaît qu'une fois l'application détachée du dépôt, c'est-à-dire en
 * production.
 *
 * Lancé par `pnpm build`, donc sur tous les chemins : local, intégration
 * continue et image.
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Chaque paire est un dossier de `src` à retrouver à l'identique dans `dist`. */
const RESSOURCES = [{ paquet: "apps/server", chemin: "db/migrations", extension: ".sql" }];

for (const { paquet, chemin, extension } of RESSOURCES) {
  const source = join(racine, paquet, "src", chemin);
  const cible = join(racine, paquet, "dist", chemin);

  const fichiers = (await readdir(source)).filter((f) => f.endsWith(extension));
  if (fichiers.length === 0) {
    throw new Error(`aucun fichier ${extension} dans ${source} — la liste est-elle encore juste ?`);
  }

  await mkdir(cible, { recursive: true });
  for (const fichier of fichiers) {
    await cp(join(source, fichier), join(cible, fichier));
  }
  console.log(`[couloir] ${fichiers.length} fichier(s) ${extension} → ${paquet}/dist/${chemin}`);
}
