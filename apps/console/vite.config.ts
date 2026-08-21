import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * La console est servie séparément du serveur en développement, d'où le
 * mandataire : le navigateur ne voit qu'une seule origine et il n'y a pas
 * de CORS à gérer.
 */
export default defineConfig({
  // Résolu depuis ce fichier : la console démarre pareil qu'on la lance
  // depuis son paquet ou depuis la racine du dépôt.
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    port: 5174,
    host: "127.0.0.1",
    proxy: { "/v1": { target: "http://localhost:3000", changeOrigin: true } },
  },
});
