import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";

/**
 * Migrations, en SQL brut.
 *
 * Pas d'ORM ni de générateur de code : le schéma est petit et stable, et une
 * migration qu'on peut lire telle quelle est une migration qu'on peut relire
 * dans deux ans, quand il faudra comprendre pourquoi un index existe.
 *
 * Chaque fichier s'applique une fois, dans l'ordre de son nom, à l'intérieur
 * d'une transaction : une migration qui échoue à mi-chemin ne laisse jamais
 * la base dans un état bâtard.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export async function migrate(sql: Sql, log: (message: string) => void = () => {}): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((row) => row.name),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql")).sort();
  const ran: string[] = [];

  for (const name of files) {
    if (applied.has(name)) continue;
    const statements = await readFile(join(MIGRATIONS_DIR, name), "utf8");

    await sql.begin(async (tx) => {
      await tx.unsafe(statements);
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });

    log(`migration appliquée : ${name}`);
    ran.push(name);
  }

  return ran;
}

/**
 * Vide toutes les tables du schéma applicatif.
 * Réservé aux tests : `TRUNCATE ... CASCADE` est bien plus rapide que de
 * recréer la base entre deux cas.
 */
export async function truncateAll(sql: Sql): Promise<void> {
  await sql`TRUNCATE screens, devices, manifests, heartbeats, play_events, agent_logs CASCADE`;
}
