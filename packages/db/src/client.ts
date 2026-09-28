import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>['db'];

/** Create a pool + typed drizzle client. Caller owns pool.end(). */
export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}
