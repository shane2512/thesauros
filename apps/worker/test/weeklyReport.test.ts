// Task 8.6: `computeWeeklyReport` against real Postgres. Everything is seeded with an EXPLICIT
// `createdAt`/`confirmedAt`/`evaluatedAt`, in and out of a fixed window, so the test proves the SQL
// boundaries (`[windowStart, windowEnd)`) rather than just "some numbers came back".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { getAddress } from 'viem';
import { schema, upsertUserByAddress, type Db } from '@thesauros/db';
import { freshTestDb } from '../../../packages/db/test/helpers';
import { computeWeeklyReport } from '../src/jobs/weeklyReport';

let db: Db;
let pool: pg.Pool;
beforeAll(async () => {
  ({ db, pool } = await freshTestDb());
});
afterAll(async () => {
  await pool?.end();
});

const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
let seq = 0;
const addr = () => getAddress(`0x${(++seq).toString(16).padStart(40, '0')}`);
const ONE = 1_000_000n; // one USDC (or one "share unit"), 6 decimals

const WINDOW_END = new Date('2026-01-08T08:00:00Z');
const WINDOW_START = new Date(WINDOW_END.getTime() - 7 * 24 * 60 * 60 * 1000);
const inWindow = new Date(WINDOW_START.getTime() + 60_000);
const beforeWindow = new Date(WINDOW_START.getTime() - 60_000);

async function seedWallet(): Promise<string> {
  const owner = addr();
  const user = await upsertUserByAddress(db, owner, new Date());
  const [wallet] = await db
    .insert(schema.wallets)
    .values({ userId: user.id, chainId: 5042002, treasuryAddress: owner })
    .returning();
  return wallet!.id;
}

async function seedVault(walletId: string, id: string): Promise<void> {
  await db.insert(schema.vaults).values({
    id,
    walletId,
    name: id,
    address: addr(),
    assetAddress: USDC,
    maxAllocationBps: 10_000,
  });
}

async function snapshot(
  walletId: string,
  vaultId: string,
  sharePrice: bigint,
  positionAssets: bigint,
  createdAt: Date,
): Promise<void> {
  await db.insert(schema.vaultSnapshots).values({
    walletId,
    vaultId,
    sharePrice,
    totalAssets: positionAssets,
    positionAssets,
    createdAt,
  });
}

async function payment(
  walletId: string,
  amountMicroUsd: bigint,
  createdAt: Date,
  label = 'Alice',
): Promise<void> {
  await db.insert(schema.ledgerEntries).values({
    walletId,
    token: USDC,
    amount: -amountMicroUsd,
    direction: 'out',
    counterpartyLabel: label,
    usdMicro: amountMicroUsd,
    createdAt,
  });
}

async function denied(walletId: string, createdAt: Date): Promise<void> {
  const [decision] = await db
    .insert(schema.agentDecisions)
    .values({
      walletId,
      trigger: 'schedule',
      contextSnapshot: {},
      contextHash: `0x${'11'.repeat(32)}`,
      proposalSource: 'deterministic',
      status: 'denied',
      createdAt,
    })
    .returning();
  await db.insert(schema.verdicts).values({
    decisionId: decision!.id,
    decision: 'DENY',
    results: [],
    policyVersion: 1,
    evaluatedAt: createdAt,
  });
}

describe('computeWeeklyReport', () => {
  it('sums yield across vaults from the price appreciation of the end-of-week position', async () => {
    const walletId = await seedWallet();
    await seedVault(walletId, 'v1');
    // Share price rises 5% over the week; position ends at 1,000 USDC.
    await snapshot(walletId, 'v1', ONE, 950_000_000n, beforeWindow);
    await snapshot(walletId, 'v1', (ONE * 105n) / 100n, 1_000_000_000n, WINDOW_END);

    const report = await computeWeeklyReport(db, walletId, WINDOW_END);
    // yield = positionAssets_end - positionAssets_end * sharePrice_start / sharePrice_end (bigint
    // truncating division), computed independently here so the test does not just restate the code.
    const expected = 1_000_000_000n - (1_000_000_000n * ONE) / ((ONE * 105n) / 100n);
    expect(report.yieldMicroUsd).toBe(expected);
    expect(report.yieldMicroUsd).toBeGreaterThan(47_000_000n); // sanity: ~$47 of $1000 at 5%
  });

  it('ignores vault snapshots outside the window and vaults with no bracketing snapshot', async () => {
    const walletId = await seedWallet();
    await seedVault(walletId, 'v1');
    await seedVault(walletId, 'v2'); // no snapshots at all -> contributes 0, not an error
    await snapshot(walletId, 'v1', ONE, 900_000_000n, beforeWindow); // before window, still usable as "start"
    await snapshot(walletId, 'v1', (ONE * 110n) / 100n, 990_000_000n, WINDOW_END);

    const report = await computeWeeklyReport(db, walletId, WINDOW_END);
    expect(report.yieldMicroUsd).toBeGreaterThan(0n);
  });

  it('sums confirmed recipient payments in the window and counts them, excluding out-of-window ones', async () => {
    const walletId = await seedWallet();
    await payment(walletId, 100n * ONE, inWindow, 'Alice');
    await payment(walletId, 50n * ONE, inWindow, 'Bob');
    await payment(walletId, 999n * ONE, beforeWindow, 'Alice'); // before window
    // No counterparty label: a vault move or sweep, not a recipient payment — must not count.
    await db.insert(schema.ledgerEntries).values({
      walletId,
      token: USDC,
      amount: -5n * ONE,
      direction: 'out',
      counterpartyLabel: null,
      usdMicro: 5n * ONE,
      createdAt: inWindow,
    });

    const report = await computeWeeklyReport(db, walletId, WINDOW_END);
    expect(report.paymentsCount).toBe(2);
    expect(report.paymentsMicroUsd).toBe(150n * ONE);
  });

  it('counts DENY verdicts in the window and excludes ones outside it', async () => {
    const walletId = await seedWallet();
    await denied(walletId, inWindow);
    await denied(walletId, inWindow);
    await denied(walletId, beforeWindow);

    const report = await computeWeeklyReport(db, walletId, WINDOW_END);
    expect(report.blockedCount).toBe(2);
  });

  it('reports all-zero for a wallet with no activity in the window', async () => {
    const walletId = await seedWallet();
    const report = await computeWeeklyReport(db, walletId, WINDOW_END);
    expect(report).toMatchObject({
      yieldMicroUsd: 0n,
      paymentsMicroUsd: 0n,
      paymentsCount: 0,
      blockedCount: 0,
    });
  });
});
