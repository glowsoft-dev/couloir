/**
 * Surface publique du serveur.
 *
 * Exportée pour que les tests d'intégration du player puissent monter un
 * vrai serveur en mémoire, plutôt que de simuler ses réponses. Un bouchon
 * qui ment ne prouve rien sur la plomberie réelle.
 */
export { buildApp, type AppOptions } from "./app.js";
export {
  MemoryStore,
  isPairingExpired,
  type Store,
  type ScreenRecord,
  type DeviceRecord,
  type NewScreen,
  type ClaimResult,
} from "./store.js";
export { PostgresStore } from "./db/postgres-store.js";
export { migrate, truncateAll } from "./db/migrate.js";
export { connect, type DatabaseOptions } from "./db/connect.js";
export { MediaStore, parseRange, type StoredMedia, type RangeRequest } from "./media.js";
export { seedDemoScreen } from "./seed.js";
