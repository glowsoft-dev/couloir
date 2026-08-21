import { buildApp } from "./app.js";
import { connect, waitForDatabase } from "./db/connect.js";
import { migrate } from "./db/migrate.js";
import { PostgresStore } from "./db/postgres-store.js";
import { MediaStore } from "./media.js";
import { seedDemoScreen } from "./seed.js";
import { MemoryStore, type Store } from "./store.js";

/**
 * Point d'entrée du serveur.
 *
 * Par défaut il persiste dans PostgreSQL. `COULOIR_STORE=memory` permet de
 * le lancer sans base — pratique pour une démonstration, mais tout est perdu
 * à l'arrêt, y compris les écrans enrôlés.
 */
const PORT = Number(process.env["PORT"] ?? 3000);
const useMemory = process.env["COULOIR_STORE"] === "memory";

const media = new MediaStore(process.env["COULOIR_MEDIA"] ?? "./data/media");
await media.load();

let store: Store;
let closeDatabase = async () => {};

if (useMemory) {
  console.warn("[couloir] entrepôt en mémoire : rien ne sera conservé à l'arrêt");
  store = new MemoryStore();
} else {
  const sql = connect();
  await waitForDatabase(sql);
  const applied = await migrate(sql, (message) => console.log(`[couloir] ${message}`));
  if (applied.length === 0) console.log("[couloir] schéma déjà à jour");
  store = new PostgresStore(sql);
  closeDatabase = () => store.close();
}

const app = buildApp({ store, media, logger: true, devRoutes: process.env["COULOIR_DEV"] === "1" });

// Un écran de démonstration, uniquement quand il n'y a encore rien.
if (process.env["COULOIR_DEV"] === "1" && (await store.listScreens()).length === 0) {
  const { screenId } = await seedDemoScreen(store, media);
  app.log.info(`écran de démonstration créé : ${screenId}`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app
      .close()
      .then(closeDatabase)
      .then(() => process.exit(0));
  });
}

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`serveur Couloir prêt sur http://localhost:${PORT}`))
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
