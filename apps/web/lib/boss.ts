import { PgBoss } from 'pg-boss';
import { getEnv } from '@thesauros/shared';

// Send-only: the web app enqueues jobs for the worker to pick up (`.work()` runs only in
// apps/worker/src/jobs.ts), it never processes a queue itself.
const g = globalThis as unknown as { __thesaurosBoss?: Promise<PgBoss> };

export function boss(): Promise<PgBoss> {
  if (!g.__thesaurosBoss) {
    g.__thesaurosBoss = (async () => {
      const b = new PgBoss(getEnv().DATABASE_URL);
      await b.start();
      return b;
    })();
  }
  return g.__thesaurosBoss;
}

/** Mirrors apps/worker/src/jobs.ts's APPROVALS_EXECUTE_QUEUE — kept as a literal so the web app
 * never imports the worker app (apps/web may depend on packages/*, never on apps/worker). */
export const APPROVALS_EXECUTE_QUEUE = 'approvals.execute';
