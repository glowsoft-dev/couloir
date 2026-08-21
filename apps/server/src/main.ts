import { buildApp } from "./app.js";
import { MediaStore } from "./media.js";
import { seedDemoScreen } from "./seed.js";

const PORT = Number(process.env["PORT"] ?? 3000);

const media = new MediaStore(process.env["COULOIR_MEDIA"] ?? "./data/media");
await media.load();

const app = buildApp({ media, logger: true, devRoutes: process.env["COULOIR_DEV"] === "1" });

// Un écran de démonstration, pour pouvoir dérouler le scénario sans console.
await seedDemoScreen(app.store, media);

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`serveur Couloir prêt sur http://localhost:${PORT}`))
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
