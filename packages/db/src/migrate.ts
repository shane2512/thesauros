// `pnpm db:migrate` — applies ./drizzle migrations to DATABASE_URL.
import { migrate as run } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDb, type Db } from './client';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function migrate(db: Db) {
  await run(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)));
  } catch {
    /* env may come from the shell */
  }
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  const { db, pool } = createDb(url);
  await migrate(db);
  await pool.end();
  console.log('migrations applied');
}
