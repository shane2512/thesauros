// 5.5 / 5.7 — confirmer, circuit breaker, and the crash-window reconciliation.
//
// The chain is a stub here (a receipt and its logs are just data); what is real is Postgres, the
// status transitions, the ledger rows, the breaker counter and the audit trail.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getAddress, pad, toHex, type PublicClient, type TransactionReceipt } from 'viem';
import { schema, type Db, claimExecutionSlot, getExecutionById } from '@thesauros/db';
import { freshTestDb } from '../../db/test/helpers';
import {
  BREAKER_FAILURE_THRESHOLD,
  compareDeltas,
  confirmExecution,
  observedDeltas,
  reconcileExecution,
} from '../src';

const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
const TREASURY = getAddress('0xE72B889052382487604b7A92E8F7fB1a5937F242');
const AGENT = getAddress('0xE967db385aF313Cc6CA006a745fc929A201F58A2');
const ALEX = getAddress('0x1111111111111111111111111111111111111111');
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TX = `0x${'bb'.repeat(32)}` as const;

const usdc = (n: number) => BigInt(n) * 1_000_000n;
const NOW = new Date('2026-09-21T12:00:00.000Z');

let db: Db;
let pool: { end(): Promise<void> };
let walletId: string;
let decisionId: string;
let seedCounter = 0;

function transferLog(from: `0x${string}`, to: `0x${string}`, value: bigint) {
  return {
    address: USDC,
    topics: [TRANSFER_TOPIC, pad(from, { size: 32 }), pad(to, { size: 32 })],
    data: pad(toHex(value), { size: 32 }),
  };
}

function receipt(
  logs: ReturnType<typeof transferLog>[],
  status: 'success' | 'reverted' = 'success',
): TransactionReceipt {
  return {
    status,
    logs,
    blockNumber: 1_000n,
    gasUsed: 21_000n,
    transactionHash: TX,
  } as unknown as TransactionReceipt;
}

function client(over: Partial<Record<string, unknown>>): PublicClient {
  return {
    getTransactionReceipt: () => Promise.reject(new Error('not mined')),
    readContract: () => Promise.resolve(usdc(1)),
    getBlockNumber: () => Promise.resolve(2_000n),
    getLogs: () => Promise.resolve([]),
    ...over,
  } as unknown as PublicClient;
}

async function seed() {
  const ownerAddress = getAddress(`0x${(++seedCounter).toString(16).padStart(40, '0')}`);
  const [user] = await db.insert(schema.users).values({ ownerAddress }).returning();
  const [wallet] = await db
    .insert(schema.wallets)
    .values({
      userId: user!.id,
      chainId: 84532,
      treasuryAddress: TREASURY,
      agentWalletAddress: getAddress(`0x${`a${seedCounter}`.padStart(40, '0')}`),
    })
    .returning();
  walletId = wallet!.id;
  const [decision] = await db
    .insert(schema.agentDecisions)
    .values({
      walletId,
      trigger: 'schedule',
      contextSnapshot: {},
      contextHash: `0x${'22'.repeat(32)}`,
      proposalSource: 'deterministic',
      status: 'allowed',
    })
    .returning();
  decisionId = decision!.id;
}

let nonce = 0;
async function submittedExecution(kind = 'pay_recipient', txHash: string | null = TX) {
  const claim = await claimExecutionSlot(db, {
    nonce: `00000000-0000-4000-9000-${String(++nonce).padStart(12, '0')}`,
    issuedAt: NOW,
    usedAt: NOW,
    walletId,
    decisionId,
    proposalHash: `0x${String(nonce).padStart(64, '0')}`,
    kind,
    callsHash: `0x${'8'.repeat(64)}`,
  });
  if (!claim.ok) throw new Error(claim.error.message);
  await db
    .update(schema.executions)
    .set({ status: 'submitted', ...(txHash ? { txHash } : {}) })
    .where(eq(schema.executions.id, claim.value.execution.id));
  return claim.value.execution.id;
}

/**
 * An advancing clock. The confirmer's deadline is wall-clock based, so a frozen clock would poll
 * forever — which is also the honest reading of the production behaviour: it stops because time
 * passes, not because of an attempt counter.
 */
const ticking = (stepMs = 1_000) => {
  let t = NOW.getTime();
  return () => {
    t += stepMs;
    return new Date(t);
  };
};

const deps = (over: Partial<Record<string, unknown>> = {}, publicClient?: PublicClient) => ({
  db,
  publicClient: publicClient ?? client({}),
  now: ticking(),
  sleep: async () => {},
  timeoutMs: 5_000,
  pollIntervalMs: 1,
  ...over,
});

const payInput = (executionId: string, amount = usdc(3_000)) => ({
  executionId,
  token: USDC,
  holders: { agent: AGENT, treasury: TREASURY, recipient: ALEX },
  expectedDeltas: [
    { token: USDC, holder: 'agent' as const, delta: -amount },
    { token: USDC, holder: 'recipient' as const, delta: amount },
  ],
});

beforeAll(async () => {
  const fresh = await freshTestDb();
  db = fresh.db;
  pool = fresh.pool;
}, 60_000);
afterAll(async () => {
  await pool.end();
});
beforeEach(seed);

describe('confirmer — happy path', () => {
  it('confirms only when the receipt succeeds AND the measured effect matches', async () => {
    const id = await submittedExecution();
    const pc = client({
      getTransactionReceipt: () =>
        Promise.resolve(receipt([transferLog(AGENT, ALEX, usdc(3_000))])),
    });

    const result = await confirmExecution(deps({}, pc), payInput(id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('confirmed');

    const row = await getExecutionById(db, id);
    expect(row?.status).toBe('confirmed');
    expect(row?.gasUsed).toBe('21000');
    expect(row?.confirmedAt?.getTime()).toBeGreaterThanOrEqual(NOW.getTime());

    const ledger = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.walletId, walletId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.direction).toBe('out');
    expect(ledger[0]?.amount).toBe(-usdc(3_000));
    expect(ledger[0]?.usdMicro).toBe(usdc(3_000));

    const events = (
      await db.select().from(schema.auditLog).where(eq(schema.auditLog.walletId, walletId))
    ).map((r) => r.event);
    expect(events).toContain('EXECUTION_CONFIRMED');
  });

  it('resets the consecutive-failure counter on success', async () => {
    await db
      .update(schema.wallets)
      .set({ breakerFailures: 2 })
      .where(eq(schema.wallets.id, walletId));
    const id = await submittedExecution();
    const pc = client({
      getTransactionReceipt: () =>
        Promise.resolve(receipt([transferLog(AGENT, ALEX, usdc(3_000))])),
    });
    await confirmExecution(deps({}, pc), payInput(id));
    const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.id, walletId));
    expect(wallet?.breakerFailures).toBe(0);
  });

  it('is a no-op for an execution that already reached a terminal state', async () => {
    const id = await submittedExecution();
    await db
      .update(schema.executions)
      .set({ status: 'confirmed' })
      .where(eq(schema.executions.id, id));
    const result = await confirmExecution(deps(), payInput(id));
    expect(result.ok && result.value.status).toBe('settled');
  });
});

describe('confirmer — a receipt is not success (Phase 2 lesson)', () => {
  it('fails when the transaction reverted even though a receipt exists', async () => {
    const id = await submittedExecution();
    const pc = client({
      getTransactionReceipt: () => Promise.resolve(receipt([], 'reverted')),
    });
    const result = await confirmExecution(deps({}, pc), payInput(id));
    expect(result.ok && result.value.status).toBe('failed');
    expect((await getExecutionById(db, id))?.status).toBe('failed');
  });

  it('fails when the receipt succeeded but the effect does not match the proposal', async () => {
    const id = await submittedExecution();
    // The receipt is a success, but only half the money moved.
    const pc = client({
      getTransactionReceipt: () =>
        Promise.resolve(receipt([transferLog(AGENT, ALEX, usdc(1_500))])),
    });
    const result = await confirmExecution(deps({}, pc), payInput(id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('failed');
    expect(result.value.status === 'failed' && result.value.reason).toContain('does not match');
  });

  it('does not confirm when the node cannot serve the receipt block (stale read)', async () => {
    const id = await submittedExecution();
    const pc = client({
      getTransactionReceipt: () =>
        Promise.resolve(receipt([transferLog(AGENT, ALEX, usdc(3_000))])),
      readContract: () => Promise.reject(new Error('missing trie node')),
    });
    const result = await confirmExecution(deps({}, pc), payInput(id));
    expect(result.ok && result.value.status).toBe('timeout');
  });
});

describe('confirmer — timeout never resends', () => {
  it('marks the execution as needing reconciliation and leaves it alone', async () => {
    const id = await submittedExecution();
    const result = await confirmExecution(deps(), payInput(id)); // receipt never arrives
    expect(result.ok && result.value.status).toBe('timeout');

    const row = await getExecutionById(db, id);
    expect(row?.status).toBe('timeout');
    expect(row?.error).toContain('timeout');

    // A timeout is NOT a failure: the breaker counter must not move (AGENTKIT §4 step 7).
    const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.id, walletId));
    expect(wallet?.breakerFailures).toBe(0);
    expect(wallet?.frozen).toBe(false);

    const events = (
      await db.select().from(schema.auditLog).where(eq(schema.auditLog.walletId, walletId))
    ).map((r) => r.event);
    expect(events).toContain('EXECUTION_TIMEOUT');
  });
});

describe('circuit breaker (5.7)', () => {
  it(`opens and freezes after ${BREAKER_FAILURE_THRESHOLD} consecutive failures`, async () => {
    const pc = client({ getTransactionReceipt: () => Promise.resolve(receipt([], 'reverted')) });
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD; i++) {
      const id = await submittedExecution();
      await confirmExecution(deps({}, pc), payInput(id));
      const [wallet] = await db
        .select()
        .from(schema.wallets)
        .where(eq(schema.wallets.id, walletId));
      expect(wallet?.breakerFailures).toBe(i + 1);
      expect(wallet?.breakerOpen).toBe(i + 1 >= BREAKER_FAILURE_THRESHOLD);
    }
    const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.id, walletId));
    expect(wallet?.frozen).toBe(true);
    expect(wallet?.frozenReason).toContain('consecutive failed executions');

    const events = (
      await db.select().from(schema.auditLog).where(eq(schema.auditLog.walletId, walletId))
    ).map((r) => r.event);
    expect(events).toContain('BREAKER_OPEN');
    const notes = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.walletId, walletId));
    expect(notes.some((n) => n.type === 'freeze')).toBe(true);
  });
});

describe('observedDeltas / compareDeltas', () => {
  it('nets transfers per holder and ignores other tokens', async () => {
    const r = receipt([
      transferLog(AGENT, ALEX, usdc(3_000)),
      transferLog(TREASURY, AGENT, usdc(1_000)),
    ]);
    expect(observedDeltas(r, USDC, { agent: AGENT, treasury: TREASURY, recipient: ALEX })).toEqual([
      { token: USDC, holder: 'agent', delta: -usdc(2_000) },
      { token: USDC, holder: 'treasury', delta: -usdc(1_000) },
      { token: USDC, holder: 'recipient', delta: usdc(3_000) },
    ]);
  });

  it('is exact for transfers and tolerant within 50 bps for vault maths', () => {
    const expected = [{ token: USDC, holder: 'agent' as const, delta: -usdc(1_000) }];
    const off = [{ token: USDC, holder: 'agent' as const, delta: -999_000_000n }];
    expect(compareDeltas(expected, off, 0n)).not.toBeNull();
    expect(compareDeltas(expected, off, 50n)).toBeNull(); // 10 bps out, inside the tolerance
    const wayOff = [{ token: USDC, holder: 'agent' as const, delta: -usdc(900) }];
    expect(compareDeltas(expected, wayOff, 50n)).not.toBeNull();
  });
});

describe('crash-window reconciliation', () => {
  it('hands a row with a hash back to the confirmer', async () => {
    const id = await submittedExecution();
    const row = await getExecutionById(db, id);
    const result = await reconcileExecution(
      { db, publicClient: client({}), now: () => NOW, token: USDC },
      row!,
      AGENT,
    );
    expect(result.ok && result.value.status).toBe('has-hash');
  });

  it('marks a hashless row FAILED when the chain shows no agent activity — safe to re-propose', async () => {
    const id = await submittedExecution('pay_recipient', null);
    const row = await getExecutionById(db, id);
    const result = await reconcileExecution(
      {
        db,
        publicClient: client({ getLogs: () => Promise.resolve([]) }),
        now: () => NOW,
        token: USDC,
      },
      row!,
      AGENT,
    );
    expect(result.ok && result.value.status).toBe('never-sent');
    expect((await getExecutionById(db, id))?.status).toBe('failed');
  });

  it('marks a hashless row UNCERTAIN when the agent wallet did move funds — never resent', async () => {
    const id = await submittedExecution('pay_recipient', null);
    const row = await getExecutionById(db, id);
    const result = await reconcileExecution(
      {
        db,
        publicClient: client({
          getLogs: () => Promise.resolve([{ transactionHash: TX }]),
        }),
        now: () => NOW,
        token: USDC,
      },
      row!,
      AGENT,
    );
    expect(result.ok && result.value.status).toBe('uncertain');
    const after = await getExecutionById(db, id);
    expect(after?.status).toBe('timeout');
    expect(after?.error).toContain('needs manual reconciliation');
  });
});
