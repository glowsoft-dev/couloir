import { buildApp } from "./app.js";
import { connect, waitForDatabase } from "./db/connect.js";
import { migrate } from "./db/migrate.js";
import { PostgresStore } from "./db/postgres-store.js";
import { PostgresTimetable } from "./timetable/repository.js";
import type { TimetableRepository } from "./timetable/repository.js";
import { MediaStore } from "./media.js";
import { DepotComptes } from "./comptes/depot.js";
import { ServiceActualites, ServiceIdentite } from "./connecteurs/service.js";
import { ServiceNetypareo } from "./connecteurs/service-netypareo.js";
import { seedDemoScreen } from "./seed.js";
import { MemoryStore, type Store } from "./store.js";

/**
 * Point d'entrée du serveur.
 *
 * Par défaut il persiste dans PostgreSQL. `COULOIR_STORE=memory` permet de
 * le lancer sans base — pratique pour une démonstration, mais tout est perdu
 * à l'arrêt, y compris les écrans enrôlés.
 */
/**
 * Le port d'écoute.
 *
 * `COULOIR_PORT` par cohérence avec le reste de la configuration, `PORT` en
 * repli parce que la plupart des hébergeurs l'imposent sans laisser le choix.
 */
const PORT = Number(process.env["COULOIR_PORT"] ?? process.env["PORT"] ?? 3000);
const useMemory = process.env["COULOIR_STORE"] === "memory";

const media = new MediaStore(process.env["COULOIR_MEDIA"] ?? "./data/media");
await media.load();

let store: Store;
let timetable: TimetableRepository | undefined;
let comptes: DepotComptes | undefined;
let actualites: ServiceActualites | undefined;
let identite: ServiceIdentite | undefined;
let netypareo: ServiceNetypareo | undefined;
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
  timetable = new PostgresTimetable(sql);
  comptes = new DepotComptes(sql);
  actualites = new ServiceActualites(sql);
  identite = new ServiceIdentite(sql);
  netypareo = new ServiceNetypareo(sql);
  closeDatabase = () => store.close();

  // Les sessions expirées ne servent qu'à faire grossir la table. Une fois
  // par heure suffit largement : rien ne dépend de leur disparition, la
  // validité est vérifiée à chaque requête.
  const purge = setInterval(
    () => void comptes?.purgerSessions().catch(() => {}),
    60 * 60 * 1000,
  );
  purge.unref();
}

// L'adresse par laquelle les ÉCRANS joignent le serveur — pas celle de la
// console. Les deux diffèrent dès qu'il y a plus d'une machine.
const publicUrl = process.env["COULOIR_PUBLIC_URL"] ?? `http://localhost:${PORT}`;

/**
 * La clé de secours.
 *
 * Elle ne publie rien : elle crée le premier administrateur, et rouvre la
 * porte le jour où le dernier a perdu son mot de passe.
 */
const consoleToken = process.env["COULOIR_CONSOLE_TOKEN"];
if (!consoleToken) {
  console.warn("[couloir] COULOIR_CONSOLE_TOKEN absent : la console restera fermée");
}

/**
 * Le cookie de session n'est posé qu'en HTTPS, sauf indication contraire.
 *
 * Un cookie `Secure` est purement et simplement ignoré sur HTTP : sans cette
 * bascule, la console de développement serait impossible à utiliser. On la
 * déduit de l'adresse publique plutôt que de la laisser au hasard d'une
 * variable qu'on oublierait de poser en production.
 */
const cookieSécurisé =
  process.env["COULOIR_COOKIE_NON_SECURISE"] === "1" ? false : publicUrl.startsWith("https://");

if (comptes && (await comptes.compter()) === 0) {
  console.warn(
    "[couloir] aucun compte : ouvrez la console pour créer le premier administrateur",
  );
}

const app = buildApp({
  store,
  media,
  logger: true,
  devRoutes: process.env["COULOIR_DEV"] === "1",
  cookieSécurisé,
  ...(comptes ? { comptes } : {}),
  ...(actualites ? { actualites } : {}),
  ...(identite ? { identite } : {}),
  ...(netypareo ? { netypareo } : {}),
  ...(consoleToken ? { consoleToken } : {}),
  ...(timetable ? { timetable } : {}),
  timetableUrl: process.env["COULOIR_TIMETABLE_URL"] ?? `${publicUrl}/v1/timetable/day`,
  publicUrl,
});

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
