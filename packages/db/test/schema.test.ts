// Requires Postgres (see helpers.ts). Covers: migrations on a fresh DB, DATA_MODEL key constraints, repo upsert.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { Db } from '../src/client';
import { getUserById, upsertUserByAddress } from '../src/repos';
import { freshTestDb } from './helpers';

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
const HASH = '0x' + 'ab'.repeat(32);

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

describe('migrations on a fresh database', () => {
  it('create every DATA_MODEL table', async () => {
    const rows = await q(
      `select table_name from information_schema.tables where table_schema='public'`,
    );
    const names = rows.map((r) => r.table_name as string);
    for (const t of [
      'users',
      'wallets',
      'mandates',
      'policies',
      'recipients',
      'vaults',
      'spend_permissions',
      'obligations',
      'agent_decisions',
      'verdicts',
      'simulations',
      'approvals',
      'receipt_nonces',
      'executions',
      'ledger_entries',
      'price_snapshots',
      'vault_snapshots',
      'notifications',
      'audit_log',
    ]) {
      expect(names, t).toContain(t);
    }
  });

  it('audit_log has the hash-chain columns', async () => {
    const cols = (
      await q(`select column_name from information_schema.columns where table_name='audit_log'`)
    ).map((r) => r.column_name as string);
    for (const c of [
      'id',
      'wallet_id',
      'actor',
      'event',
      'entity_type',
      'entity_id',
      'payload',
      'prev_hash',
      'row_hash',
      'created_at',
    ]) {
      expect(cols).toContain(c);
    }
  });
});

describe('key constraints', () => {
  it('rejects chain_id outside (84532, 8453)', async () => {
    const [u] = await q(`insert into users(owner_address) values ('0xchain') returning id`);
    await expect(
      q(`insert into wallets(user_id, chain_id, treasury_address) values ($1, 1, $2)`, [
        u.id,
        ADDR,
      ]),
    ).rejects.toThrow(/wallets_chain_id_check/);
  });

  it('allows only one active policy per wallet', async () => {
    const w = await mkWallet();
    const ins = (v: number, status: string) =>
      q(
        `insert into policies(wallet_id, version, body, body_hash, status) values ($1,$2,'{}',$3,$4)`,
        [w, v, HASH, status],
      );
    await ins(1, 'active');
    await ins(2, 'draft'); // drafts and superseded rows are unrestricted
    await expect(ins(3, 'active')).rejects.toThrow(/policies_one_active_per_wallet/);
  });

  it('receipt nonce is single-use (primary key)', async () => {
    const w = await mkWallet();
    const ins = () =>
      q(
        `insert into receipt_nonces(nonce, wallet_id, proposal_hash, issued_at) values ('n1',$1,$2, now())`,
        [w, HASH],
      );
    await ins();
    await expect(ins()).rejects.toThrow(/receipt_nonces_pkey|duplicate key/);
  });

  it('recipients unique per (wallet, address)', async () => {
    const w = await mkWallet();
    const ins = () =>
      q(`insert into recipients(wallet_id, label, address, max_per_tx) values ($1,'a',$2,1)`, [
        w,
        ADDR,
      ]);
    await ins();
    await expect(ins()).rejects.toThrow(/recipients_wallet_address_uq/);
  });

  it('executions unique per (wallet, proposal_hash) (I10)', async () => {
    const w = await mkWallet();
    const [d] = await q(
      `insert into agent_decisions(wallet_id, trigger, context_snapshot, context_hash, screen, proposal_source, serv_meta, status)
       values ($1,'schedule','{}',$2,'{}','deterministic','{}','noop') returning id`,
      [w, HASH],
    );
    const ins = () =>
      q(
        `insert into executions(wallet_id, decision_id, proposal_hash, kind, calls_hash) values ($1,$2,$3,'PAY',$3)`,
        [w, d.id, HASH],
      );
    await ins();
    await expect(ins()).rejects.toThrow(/executions_wallet_proposal_hash_uq/);
  });

  it('rejects negative obligation amounts', async () => {
    const w = await mkWallet();
    const [r] = await q(
      `insert into recipients(wallet_id, label, address, max_per_tx) values ($1,'r',$2,1) returning id`,
      [w, ADDR],
    );
    await expect(
      q(
        `insert into obligations(wallet_id, recipient_id, amount, due_date) values ($1,$2,-1,'2026-10-01')`,
        [w, r.id],
      ),
    ).rejects.toThrow(/obligations_amount_check/);
  });
});

describe('repos', () => {
  it('upsertUserByAddress creates once, then only bumps last_login_at', async () => {
    const a = await upsertUserByAddress(db, ADDR, new Date('2026-01-01T00:00:00Z'));
    const b = await upsertUserByAddress(db, ADDR, new Date('2026-02-01T00:00:00Z'));
    expect(b.id).toBe(a.id);
    expect(b.lastLoginAt?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect((await getUserById(db, a.id))?.ownerAddress).toBe(ADDR);
  });
});
