import { createDb, type Db } from '@thesauros/db';
import { getEnv } from '@thesauros/shared';

// One pool per process (Next.js dev reloads this module, so cache on `globalThis`).
const g = globalThis as unknown as { __thesaurosDb?: Db };

export function db(): Db {
  if (!g.__thesaurosDb) {
    g.__thesaurosDb = createDb(getEnv().DATABASE_URL).db;
  }
  return g.__thesaurosDb;
}
