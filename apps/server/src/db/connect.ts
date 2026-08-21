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
