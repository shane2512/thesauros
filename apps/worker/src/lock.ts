// 6.1 — the per-wallet decision lock. ARCHITECTURE §5 step 0, and PHASES 6 "Do not: run two loops
// concurrently for one wallet".
//
// A *session* advisory lock, not a transaction one: an iteration spans many statements and a
// blockchain round trip, so holding an open transaction for its whole life would pin a connection
// and a snapshot for minutes. A session lock therefore has to live on ONE connection, which is why
// this takes the pool and checks out a dedicated client for the duration.
//
// Namespace 0x4C4F4F50 ('LOOP'), deliberately distinct from `packages/db/src/audit.ts`'s
// 0x41554454 ('AUDT') — the loop holds its lock while `appendAudit` takes its own, and two locks
// that shared a namespace would deadlock the moment the key hashes collided.
import type { Pool } from 'pg';

/** 'LOOP' as big-endian ASCII. Fits int4; distinct from AUDIT_LOCK_NAMESPACE (0x41554454). */
export const LOOP_LOCK_NAMESPACE = 0x4c4f_4f50;

export type WalletLock = { release(): Promise<void> };

/**
 * Try to take the wallet's decision lock. Returns `null` when another iteration already holds it —
 * the caller must then do nothing at all, not queue behind it (a tick that arrives while a loop is
 * running has nothing new to say).
 */
export async function tryWalletLock(pool: Pool, walletId: string): Promise<WalletLock | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1, hashtext($2)) as locked',
      [LOOP_LOCK_NAMESPACE, walletId],
    );
    if (rows[0]?.locked !== true) {
      client.release();
      return null;
    }
  } catch (e) {
    client.release();
    throw e;
  }
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query('select pg_advisory_unlock($1, hashtext($2))', [
          LOOP_LOCK_NAMESPACE,
          walletId,
        ]);
      } finally {
        // Even if the unlock statement fails, dropping the connection ends the session and with it
        // the lock — so the lock can never outlive the process.
        client.release();
      }
    },
  };
}

/** Run `fn` under the wallet lock, or return `{ acquired: false }` if someone else holds it. */
export async function withWalletLock<T>(
  pool: Pool,
  walletId: string,
  fn: () => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const lock = await tryWalletLock(pool, walletId);
  if (!lock) return { acquired: false };
  try {
    return { acquired: true, value: await fn() };
  } finally {
    await lock.release();
  }
}
