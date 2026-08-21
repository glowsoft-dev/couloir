import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Harnais de développement : sert `dev/index.html` pour voir un écran en vrai.
 *
 * L'alias pointe le protocole vers ses SOURCES et non vers `dist` : sans lui,
 * une modification du manifeste de référence n'apparaît qu'après un `build`,
 * et on croit à tort que le rendu est en cause.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./dev", import.meta.url)),
  resolve: {
    alias: {
      "@couloir/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
    },
  },
  server: { port: 5173, host: "127.0.0.1" },
});
