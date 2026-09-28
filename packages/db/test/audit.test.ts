// I6 audit log. Requires Postgres (see helpers.ts) — fails loudly, never skips.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { appendAudit, AUDIT_GENESIS_PREV_HASH, verifyChain, type AuditRow } from '../src/audit';
import type { Db } from '../src/client';
import { freshTestDb, testDbUrl } from './helpers';

let db: Db;
let pool: pg.Pool;
beforeAll(async () => {
  ({ db, pool } = await freshTestDb());
});
afterAll(async () => {
  await pool?.end();
});

const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const ADDR = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

async function mkWallet(): Promise<string> {
  const [u] = await q(`insert into users(owner_address) values ($1) returning id`, [
    '0x' + Math.random().toString(16).slice(2).padEnd(40, '0'),
  ]);
  const [w] = await q(
    `insert into wallets(user_id, chain_id, treasury_address) values ($1, 84532, $2) returning id`,
    [u.id, ADDR],
  );
  return w.id as string;
}

function at<T>(a: readonly T[], i: number): T {
  const v = a[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
}

function unwrap<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

describe('audit_log append-only trigger', () => {
  it('rejects UPDATE, DELETE and TRUNCATE', async () => {
    const walletId = await mkWallet();
    const row = unwrap(
      await appendAudit(db, { walletId, actor: 'system', event: 'CONTEXT', payload: { a: 1 } }),
    );
    await expect(q(`update audit_log set event = 'X' where id = $1`, [row.id])).rejects.toThrow(
      /append-only: UPDATE/,
    );
    await expect(q(`delete from audit_log where id = $1`, [row.id])).rejects.toThrow(
      /append-only: DELETE/,
    );
    await expect(q(`truncate audit_log`)).rejects.toThrow(/append-only: TRUNCATE/);
    expect(await q(`select count(*)::int as n from audit_log`)).toEqual([{ n: 1 }]);
  });
});

describe('hash chain', () => {
  it('chains rows per wallet, starts at genesis and verifies', async () => {
    const walletId = await mkWallet();
    const rows: AuditRow[] = [];
    for (const i of [0, 1, 2])
      rows.push(
        unwrap(
          await appendAudit(db, {
            walletId,
            actor: 'agent',
            event: 'PROPOSAL',
            entityType: 'proposal',
            entityId: `p${i}`,
            payload: { i, amount: 1_000_000n },
          }),
        ),
      );
    expect(at(rows, 0).prevHash).toBe(AUDIT_GENESIS_PREV_HASH);
    expect(at(rows, 1).prevHash).toBe(at(rows, 0).rowHash);
    expect(at(rows, 2).prevHash).toBe(at(rows, 1).rowHash);
    const v = unwrap(await verifyChain(db, walletId));
    expect(v).toEqual({ rows: 3, head: at(rows, 2).rowHash });
  });

  it('stores the payload as canonical JSON (bigint as string, stable round-trip)', async () => {
    const walletId = await mkWallet();
    const row = unwrap(
      await appendAudit(db, {
        walletId,
        actor: 'agent',
        event: 'EXECUTION_SENT',
        payload: { b: 2, a: { z: 1n, y: new Date('2026-01-02T03:04:05.678Z') } },
      }),
    );
    expect(row.payload).toEqual({ b: 2, a: { z: '1', y: '2026-01-02T03:04:05.678Z' } });
    expect(unwrap(await verifyChain(db, walletId)).rows).toBe(1);
  });

  it('keeps a separate system chain for rows with no wallet', async () => {
    const walletId = await mkWallet();
    const sys = unwrap(await appendAudit(db, { actor: 'system', event: 'FREEZE', payload: {} }));
    expect(sys.walletId).toBeNull();
    expect(sys.prevHash).toBe(AUDIT_GENESIS_PREV_HASH);
    const sys2 = unwrap(await appendAudit(db, { actor: 'system', event: 'FREEZE', payload: {} }));
    expect(sys2.prevHash).toBe(sys.rowHash);
    // an unrelated wallet chain is unaffected
    const w = unwrap(
      await appendAudit(db, { walletId, actor: 'owner', event: 'FREEZE', payload: {} }),
    );
    expect(w.prevHash).toBe(AUDIT_GENESIS_PREV_HASH);
    expect(unwrap(await verifyChain(db, null)).rows).toBe(2);
  });
});

describe('tamper detection', () => {
  it('verifyChain names the exact row whose payload was modified behind the trigger', async () => {
    const walletId = await mkWallet();
    const rows: AuditRow[] = [];
    for (const i of [0, 1, 2, 3])
      rows.push(
        unwrap(
          await appendAudit(db, { walletId, actor: 'agent', event: 'VERDICT', payload: { i } }),
        ),
      );
    const victim = at(rows, 2);
    // Only a superuser / table owner can do this; that is the threat model for this test.
    await q(`alter table audit_log disable trigger audit_log_no_mutation`);
    await q(`update audit_log set payload = '{"i": 99}'::jsonb where id = $1`, [victim.id]);
    await q(`alter table audit_log enable trigger audit_log_no_mutation`);

    const v = await verifyChain(db, walletId);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.error.rowId).toBe(victim.id);
    expect(v.error.reason).toBe('row_hash_mismatch');
  });

  it('detects a deleted middle row as a prev_hash break at the following row', async () => {
    const walletId = await mkWallet();
    const rows: AuditRow[] = [];
    for (const i of [0, 1, 2])
      rows.push(
        unwrap(
          await appendAudit(db, { walletId, actor: 'agent', event: 'CONTEXT', payload: { i } }),
        ),
      );
    await q(`alter table audit_log disable trigger audit_log_no_mutation`);
    await q(`delete from audit_log where id = $1`, [at(rows, 1).id]);
    await q(`alter table audit_log enable trigger audit_log_no_mutation`);

    const v = await verifyChain(db, walletId);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.error.rowId).toBe(at(rows, 2).id);
    expect(v.error.reason).toBe('prev_hash_mismatch');
  });
});

describe('redaction (SECURITY §6)', () => {
  it('refuses payloads with secret-looking keys, nested or in arrays', async () => {
    const walletId = await mkWallet();
    for (const payload of [
      { privateKey: '0xdead' },
      { wallet: { apiSecret: 'x' } },
      { mnemonic: 'a b c' },
      { seedPhrase: 'a b c' },
      { items: [{ signature: '0x1' }] },
      { Authorization: 'Bearer x' },
    ]) {
      const r = await appendAudit(db, { walletId, actor: 'system', event: 'CONTEXT', payload });
      expect(r.ok, JSON.stringify(payload)).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('SECRET_IN_PAYLOAD');
    }
    expect(
      await q(`select count(*)::int as n from audit_log where wallet_id = $1`, [walletId]),
    ).toEqual([{ n: 0 }]);
    // domain words that merely contain "token" are fine
    const okRow = await appendAudit(db, {
      walletId,
      actor: 'agent',
      event: 'CONTEXT',
      payload: { token: 'USDC', tokenAmount: '1000000' },
    });
    expect(okRow.ok).toBe(true);
  });
});

describe('concurrency', () => {
  it('50 parallel appends for one wallet form a gapless, valid chain with unique prev_hashes', async () => {
    const walletId = await mkWallet();
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        appendAudit(db, { walletId, actor: 'agent', event: 'CONTEXT', payload: { i } }),
      ),
    );
    for (const r of results) unwrap(r);
    const rows = (await q(`select id, prev_hash from audit_log where wallet_id = $1 order by id`, [
      walletId,
    ])) as { id: string; prev_hash: string }[];
    expect(rows).toHaveLength(50);
    expect(new Set(rows.map((r) => r.prev_hash)).size).toBe(50);
    const ids = rows.map((r) => Number(r.id));
    expect(at(ids, 49) - at(ids, 0)).toBe(49); // gapless: every append committed
    expect(unwrap(await verifyChain(db, walletId)).rows).toBe(50);
  });

  it('a held lock on one wallet does not block another wallet', async () => {
    const [a, b] = [await mkWallet(), await mkWallet()];
    const holder = new pg.Client({ connectionString: testDbUrl() });
    await holder.connect();
    try {
      await holder.query('begin');
      // same key the writer uses for wallet a
      await holder.query(`select pg_advisory_xact_lock(1096107092, hashtext($1))`, [a]); // 0x41554454, see audit.ts

      const timeout = (ms: number) => new Promise((r) => setTimeout(() => r('TIMEOUT'), ms));
      const other = appendAudit(db, { walletId: b, actor: 'agent', event: 'CONTEXT', payload: {} });
      expect(await Promise.race([other, timeout(3000)])).not.toBe('TIMEOUT');

      const blocked = appendAudit(db, {
        walletId: a,
        actor: 'agent',
        event: 'CONTEXT',
        payload: {},
      });
      expect(await Promise.race([blocked, timeout(400)])).toBe('TIMEOUT');
      await holder.query('rollback');
      unwrap(await blocked);
    } finally {
      await holder.end();
    }
  });
});
