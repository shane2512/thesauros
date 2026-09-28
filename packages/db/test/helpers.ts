// DB tests REQUIRE Postgres (`docker compose up -d --wait`, host port 5433). They fail loudly if it is unreachable;
// they are never skipped. Each call drops and recreates the `thesauros_test` database, then applies migrations.
import pg from 'pg';
import { createDb } from '../src/client';
import { migrate } from '../src/migrate';

const admin =
  process.env['TEST_ADMIN_DATABASE_URL'] ??
  'postgres://thesauros:thesauros@localhost:5433/postgres';
export const TEST_DB_NAME = 'thesauros_test';

export function testDbUrl(): string {
  const u = new URL(admin);
  u.pathname = `/${TEST_DB_NAME}`;
  return u.toString();
}

export async function freshTestDb() {
  const a = new pg.Client({ connectionString: admin });
  try {
    await a.connect();
  } catch (e) {
    throw new Error(
      `Postgres unreachable at ${admin} (${String(e)}). DB tests need Docker: run "docker compose up -d --wait".`,
      { cause: e },
    );
  }
  await a.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await a.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await a.end();
  const { db, pool } = createDb(testDbUrl());
  await migrate(db);
  return { db, pool };
}
