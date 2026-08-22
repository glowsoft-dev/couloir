import postgres, { type Sql } from "postgres";

/**
 * Connexion à PostgreSQL.
 *
 * `DATABASE_URL` est la seule configuration : la même image tourne en
 * développement, en préproduction et en production, sans fichier à éditer.
 */

export interface DatabaseOptions {
  url?: string;
  /** Une petite grappe suffit : le serveur est bien plus attentiste que calculatoire. */
  max?: number;
  onNotice?: (notice: unknown) => void;
}

export const DEFAULT_DATABASE_URL = "postgres://couloir:couloir@localhost:5442/couloir";

/**
 * Base dédiée aux tests.
 *
 * Séparée du développement, et ce n'est pas un détail : les tests vident les
 * tables entre chaque cas. Partager la base reviendrait à effacer l'état
 * local à chaque `pnpm test` — et à chercher longtemps pourquoi les écrans
 * ont disparu.
 */
export const TEST_DATABASE_URL =
  process.env["DATABASE_URL_TEST"] ?? "postgres://couloir:couloir@localhost:5442/couloir_test";

/**
 * Crée la base de test si elle n'existe pas encore.
 *
 * `suffixe` donne à chaque fichier de tests sa propre base. Ce n'est pas du
 * luxe : Vitest exécute les fichiers en parallèle, et chacun vide les tables
 * entre deux cas. Sur une base commune, un fichier efface les données d'un
 * autre en pleine exécution — l'échec tombe alors ailleurs que la cause, et
 * il ne se reproduit pas quand on relance le fichier seul.
 */
export async function ensureTestDatabase(suffixe?: string): Promise<Sql> {
  const base = new URL(TEST_DATABASE_URL);
  const name = base.pathname.slice(1) + (suffixe ? `_${suffixe}` : "");
  const url = new URL(`/${name}`, TEST_DATABASE_URL).toString();

  const admin = postgres(new URL("/postgres", TEST_DATABASE_URL).toString(), { max: 1 });
  try {
    const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    // `CREATE DATABASE` ne supporte pas IF NOT EXISTS avant PostgreSQL 17.
    if (existing.length === 0) await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  return postgres(url, { max: 4, onnotice: () => {} });
}

export function connect(options: DatabaseOptions = {}): Sql {
  return postgres(options.url ?? process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL, {
    max: options.max ?? 10,
    // Les dates reviennent en `Date`, les JSONB en objets : le reste du code
    // n'a jamais à connaître les types de PostgreSQL.
    transform: { undefined: null },
    onnotice: options.onNotice ?? (() => {}),
  });
}

/**
 * Attend que la base réponde.
 *
 * Au démarrage d'une pile conteneurisée, l'API est prête avant PostgreSQL.
 * Sans cette attente, le serveur mourrait au premier lancement et compterait
 * sur son redémarrage automatique — ce qui marche, mais brouille les
 * journaux et fait douter à chaque déploiement.
 */
export async function waitForDatabase(sql: Sql, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await sql`SELECT 1`;
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`base de données injoignable après ${timeoutMs} ms : ${String(lastError)}`);
}
