import { Player } from "./player.js";

/**
 * Point d'entrée du player Linux.
 *
 * Tout se règle par variables d'environnement, sans fichier de configuration
 * à éditer sur l'appareil : l'image système est identique pour tous les
 * écrans, et l'identité s'acquiert par appairage.
 */
const player = new Player({
  serverUrl: process.env["COULOIR_SERVER"] ?? "http://localhost:3000",
  dataDirectory: process.env["COULOIR_DATA"] ?? "/var/lib/couloir",
  localPort: Number(process.env["COULOIR_PORT"] ?? 8080),
  allowReboot: process.env["COULOIR_ALLOW_REBOOT"] === "1",
  log: (level, message, context) => {
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
    console[level === "error" ? "error" : "log"](context ? `${line} ${JSON.stringify(context)}` : line);
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void player.stop().then(() => process.exit(0));
  });
}

player.start().catch((error) => {
  console.error("démarrage du player impossible :", error);
  process.exit(1);
});
