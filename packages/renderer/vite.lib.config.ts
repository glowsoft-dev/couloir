import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Bundle navigateur du noyau de rendu.
 *
 * Servi par le serveur local du player à Chromium. Un seul fichier, sans
 * dépendance externe : la page doit se charger sans réseau, y compris au
 * tout premier démarrage d'un écran jamais connecté.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@couloir/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
    },
  },
  build: {
    outDir: "dist-browser",
    emptyOutDir: true,
    target: "es2022",
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "couloir.js",
    },
  },
});
