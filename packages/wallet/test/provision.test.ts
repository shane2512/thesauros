// 2.3 — provisioning is idempotent, audited, and fails closed. Requires Postgres (see db/test/helpers.ts):
// these tests fail loudly rather than skipping if Docker is not up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getAddress } from 'viem';
import { appendAudit, schema, verifyChain, type Db } from '@thesauros/db';
import { freshTestDb } from '../../db/test/helpers';
import { cdpAccountNames, provisionAgentWallet, type ProvisionDeps } from '../src/provision';
import { AGENT, TREASURY } from './fixtures';

let db: Db;
let pool: pg.Pool;
beforeAll(async () => {
  ({ db, pool } = await freshTestDb());
});
afterAll(async () => {
  await pool?.end();
});

const OWNER_ACCOUNT = getAddress('0xba916bc0884EdfE90b64BCD0AB1F3905c153e9ae');

/** `agent_wallet_address` is globally unique, so each test needs its own address. */
let addrSeq = 0;
const nextAddress = () => getAddress(`0x${(++addrSeq).toString(16).padStart(40, 'd')}`);

/** Counting fake for the two CDP calls provisioning uses (D-3). */
function fakeCdp(address = nextAddress()) {
  const calls: { owner: string[]; smart: string[] } = { owner: [], smart: [] };
  return {
    calls,
    cdp: {
      getOrCreateAccount: async ({ name }: { name: string }) => {
        calls.owner.push(name);
        return { address: OWNER_ACCOUNT, name } as never;
      },
      getOrCreateSmartAccount: async ({ name }: { name: string }) => {
        calls.smart.push(name);
        return { address, name } as never;
      },
    },
  };
}

async function mkUserAndWallet(): Promise<{ userId: string; walletId: string }> {
  const [u] = (
    await pool.query(`insert into users(owner_address) values ($1) returning id`, [
      getAddress(
        `0x${Math.floor(Math.random() * 1e15)
          .toString(16)
          .padStart(40, '0')}`,
      ),
    ])
  ).rows as { id: string }[];
  const [w] = (
    await pool.query(
      `insert into wallets(user_id, chain_id, treasury_address) values ($1, 84532, $2) returning id`,
      [u!.id, TREASURY],
    )
  ).rows as { id: string }[];
  return { userId: u!.id, walletId: w!.id };
}

const deps = (cdp: ProvisionDeps['cdp']): ProvisionDeps => ({
  db,
  cdp,
  chainId: 84532,
  allowMainnet: false,
  networkId: 'base-sepolia',
});

describe('cdpAccountNames', () => {
  it('derives valid, distinct, ≤36-char names from the userId', () => {
    const r = cdpAccountNames('0f4a0c36-2f3e-4b6a-9d21-6a1f3c9d77aa');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.owner).toBe('sto-0f4a0c362f3e4b6a9d216a1f3c9d77aa');
    expect(r.value.smartAccount).toBe('sta-0f4a0c362f3e4b6a9d216a1f3c9d77aa');
    for (const n of Object.values(r.value)) {
      expect(n.length).toBeLessThanOrEqual(36);
      expect(n).toMatch(/^[A-Za-z0-9-]{2,36}$/);
    }
    expect(r.value.owner).not.toBe(r.value.smartAccount);
  });

  it('is deterministic and case-insensitive on the uuid', () => {
    const a = cdpAccountNames('0F4A0C36-2F3E-4B6A-9D21-6A1F3C9D77AA');
    const b = cdpAccountNames('0f4a0c36-2f3e-4b6a-9d21-6a1f3c9d77aa');
    expect(a).toEqual(b);
  });

  it('rejects anything that is not a uuid', () => {
    for (const bad of ['', 'nope', '../../etc', '0f4a0c36'])
      expect(cdpAccountNames(bad).ok).toBe(false);
  });
});

describe('provisionAgentWallet', () => {
  it('creates the wallet, stores address + ref, and audits WALLET_PROVISIONED', async () => {
    const { userId, walletId } = await mkUserAndWallet();
    const { cdp, calls } = fakeCdp(AGENT);

    const r = await provisionAgentWallet(deps(cdp), userId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(true);
    expect(r.value.agentWalletAddress).toBe(AGENT);
    expect(r.value.ref).toMatchObject({
      provider: 'cdp-smart-account',
      networkId: 'base-sepolia',
      ownerAddress: OWNER_ACCOUNT,
    });
    expect(calls.owner).toEqual([`sto-${userId.replace(/-/g, '')}`]);

    const rows = (
      await pool.query(`select agent_wallet_address, agent_wallet_ref from wallets where id = $1`, [
        walletId,
      ])
    ).rows as { agent_wallet_address: string; agent_wallet_ref: unknown }[];
    expect(rows[0]!.agent_wallet_address).toBe(AGENT);
    expect(rows[0]!.agent_wallet_ref).toMatchObject({
      smartAccountName: `sta-${userId.replace(/-/g, '')}`,
    });

    const audit = (
      await pool.query(`select event, payload from audit_log where wallet_id = $1`, [walletId])
    ).rows as { event: string; payload: Record<string, unknown> }[];
    expect(audit.map((a) => a.event)).toEqual(['WALLET_PROVISIONED']);
    expect(audit[0]!.payload['agentWalletAddress']).toBe(AGENT);
    expect(JSON.stringify(audit[0]!.payload)).not.toMatch(/secret|privateKey/i);

    const chain = await verifyChain(db, walletId);
    expect(chain.ok).toBe(true);
  });

  it('is idempotent: a second call re-attaches without touching CDP or writing a second audit row', async () => {
    const { userId, walletId } = await mkUserAndWallet();
    const firstAddress = nextAddress();
    const first = fakeCdp(firstAddress);
    await provisionAgentWallet(deps(first.cdp), userId);

    const second = fakeCdp(nextAddress());
    const r = await provisionAgentWallet(deps(second.cdp), userId);
    expect(r.ok && r.value.created).toBe(false);
    expect(r.ok && r.value.agentWalletAddress).toBe(firstAddress); // not the second fake's address
    expect(second.calls.owner).toEqual([]);
    expect(second.calls.smart).toEqual([]);

    const n = (await pool.query(`select count(*) from audit_log where wallet_id = $1`, [walletId]))
      .rows as { count: string }[];
    expect(n[0]!.count).toBe('1');
  });

  it('two concurrent provisions settle on one wallet and never throw', async () => {
    const { userId, walletId } = await mkUserAndWallet();
    // Same userId ⇒ CDP getOrCreate is idempotent ⇒ both racers see the same address (D-3).
    const shared = nextAddress();
    const [a, b] = await Promise.all([
      provisionAgentWallet(deps(fakeCdp(shared).cdp), userId),
      provisionAgentWallet(deps(fakeCdp(shared).cdp), userId),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && a.value.agentWalletAddress).toBe(shared);
    expect(b.ok && b.value.agentWalletAddress).toBe(shared);
    expect([a.ok && a.value.created, b.ok && b.value.created].filter(Boolean)).toHaveLength(1);
    const rows = (
      await pool.query(`select agent_wallet_address from wallets where id = $1`, [walletId])
    ).rows as { agent_wallet_address: string }[];
    expect(rows[0]!.agent_wallet_address).toBe(shared);
  });

  it('refuses mainnet (I8) before touching CDP', async () => {
    const { userId } = await mkUserAndWallet();
    const { cdp, calls } = fakeCdp();
    const r = await provisionAgentWallet(
      { ...deps(cdp), chainId: 8453, allowMainnet: true },
      userId,
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('CHAIN_REFUSED');
    expect(calls.owner).toEqual([]);
  });

  it('returns NO_WALLET when the user has no wallet row', async () => {
    const { cdp } = fakeCdp();
    const r = await provisionAgentWallet(deps(cdp), '0f4a0c36-2f3e-4b6a-9d21-6a1f3c9d77aa');
    expect(!r.ok && r.error.code).toBe('NO_WALLET');
  });

  it('persists nothing when the CDP call fails', async () => {
    const { userId, walletId } = await mkUserAndWallet();
    const failing = {
      getOrCreateAccount: async () => {
        throw new Error('cdp 500');
      },
      getOrCreateSmartAccount: async () => {
        throw new Error('unreachable');
      },
    } as unknown as ProvisionDeps['cdp'];
    const r = await provisionAgentWallet(deps(failing), userId);
    expect(!r.ok && r.error.code).toBe('CDP_FAILED');
    const rows = (
      await pool.query(`select agent_wallet_address from wallets where id = $1`, [walletId])
    ).rows as { agent_wallet_address: string | null }[];
    expect(rows[0]!.agent_wallet_address).toBeNull();
  });

  it('aborts (and persists nothing) when the audit write is refused', async () => {
    // Sanity-check the premise: appendAudit refuses secret-looking payloads (D-16).
    const { walletId } = await mkUserAndWallet();
    const refused = await appendAudit(db, {
      walletId,
      actor: 'system',
      event: 'WALLET_PROVISIONED',
      payload: { walletSecret: 'nope' },
    });
    expect(refused.ok).toBe(false);

    const rows = (
      await pool.query(`select count(*) from audit_log where wallet_id = $1`, [walletId])
    ).rows as { count: string }[];
    expect(rows[0]!.count).toBe('0');
    expect(schema.wallets).toBeDefined();
  });
});
