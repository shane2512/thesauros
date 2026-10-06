// One agent wallet per owner address, forever. Requires Postgres (see helpers.ts) — fails loudly, never skips.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { findRegisteredAgentWallet, registerAgentWallet } from '../src/agent';
import type { Db } from '../src/client';
import { freshTestDb } from './helpers';

let db: Db;
let pool: pg.Pool;
beforeAll(async () => {
  ({ db, pool } = await freshTestDb());
});
afterAll(async () => {
  await pool?.end();
});

const OWNER = '0xda4626FcE97748B7A78b613c754419c5e3FDAdCA';
const first = {
  address: '0xD277832fE0b169aed51cB0DF826e0bcEa6bd23e2',
  walletSetId: 'set-1',
  circleWalletId: 'w-1',
};
const second = {
  address: '0x060a0b8b75e1564F4F56147588d407f6a2CB1337',
  walletSetId: 'set-2',
  circleWalletId: 'w-2',
};

describe('agent wallet registry', () => {
  it('has nothing for an owner who never provisioned', async () => {
    expect(await findRegisteredAgentWallet(db, OWNER, 5042002)).toBeUndefined();
  });

  it('keeps the first wallet when a second provisioning races in', async () => {
    expect(await registerAgentWallet(db, OWNER, 5042002, first)).toEqual(first);
    expect(await registerAgentWallet(db, OWNER, 5042002, second)).toEqual(first);
    expect(await findRegisteredAgentWallet(db, OWNER, 5042002)).toEqual(first);
  });

  it('survives deleting every user and wallet row', async () => {
    await pool.query('truncate users, wallets cascade');
    expect(await findRegisteredAgentWallet(db, OWNER, 5042002)).toEqual(first);
  });

  it('refuses update, delete and truncate', async () => {
    await expect(pool.query(`update agent_wallet_registry set chain_id = 5042`)).rejects.toThrow(
      /append-only/,
    );
    await expect(pool.query('delete from agent_wallet_registry')).rejects.toThrow(/append-only/);
    await expect(pool.query('truncate agent_wallet_registry')).rejects.toThrow(/append-only/);
  });

  it('is scoped per chain', async () => {
    expect(await findRegisteredAgentWallet(db, OWNER, 5042)).toBeUndefined();
  });
});
