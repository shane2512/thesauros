// Phase 6 integration against a REAL Postgres (docker compose up -d --wait). No chain and no SERV:
// everything here is a property of the loop's control flow, the lock, and the approval lifecycle.
// The on-chain half is `test/fork/loop.fork.test.ts`.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getAddress, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  appendAudit,
  cancelPendingApprovals,
  decideApproval,
  ensureNextOccurrence,
  expirePendingApprovals,
  getApproval,
  insertAgentDecision,
  insertApproval,
  listAuditForEntity,
  listObligationsDue,
  listVaultRows,
  listActiveWalletIds,
  schema,
  setVaultFlagged,
  verifyChain,
  type Db,
} from '@thesauros/db';
import { hashProposal } from '@thesauros/policy';
import { approvalMessage, APPROVAL_TTL_MS, type Policy, type Proposal } from '@thesauros/shared';
import { freshTestDb } from '../../../packages/db/test/helpers';
import { runIteration, type DecisionLoopDeps } from '../src/loop';
import { tryWalletLock, withWalletLock, LOOP_LOCK_NAMESPACE } from '../src/lock';
import { addOneMonth, zLoopTickJob } from '../src/jobs';
// `cancelApprovalsForPolicyChange` moved to @thesauros/db in 7.6 so `/api/policy/activate` can call it.
import { cancelApprovalsForPolicyChange } from '@thesauros/db';
import { executeApproval, verifyApprovalSignature } from '../src/approvals';
import { replay } from '../src/replay';

const ONE = 1_000_000n;
const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
const VAULT = getAddress('0x3741f0da6dFFfFD8Be2353e326a49E41a3396485');
const MANAGER = getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad');
const AGENT = getAddress('0x00000000000000000000000000000000000a9e18');
const ALEX = getAddress('0x1111111111111111111111111111111111111111');
const KEY = new Uint8Array(32).fill(7);

/** A real key so the approval tests sign real EIP-191 signatures (testnet-shaped, never persisted). */
const OWNER_KEY = `0x${'42'.repeat(32)}` as const;
const ownerAccount = privateKeyToAccount(OWNER_KEY);
const TREASURY = ownerAccount.address;

let db: Db;
let pool: Awaited<ReturnType<typeof freshTestDb>>['pool'];
let walletId: string;
let userId: string;

const policyBody = (over: Partial<Policy> = {}): Policy =>
  ({
    version: 1,
    walletId,
    chainId: 5042002,
    treasuryAddress: TREASURY,
    tokens: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
    vaults: [
      {
        id: 'v1',
        name: 'Demo Vault',
        address: VAULT,
        asset: USDC,
        kind: 'erc4626',
        maxAllocationBps: 10_000,
      },
    ],
    recipients: [{ id: 'alex', label: 'Alex', address: ALEX, maxPerTxMicroUsd: 10_000n * ONE }],
    limits: { perTxMicroUsd: 50_000n * ONE, dailyMicroUsd: 60_000n * ONE, maxActionsPerHour: 10 },
    runwayBufferMicroUsd: 120_000n * ONE,
    approvalThresholdMicroUsd: 15_000n * ONE,
    depegThresholdBps: 50,
    vaultDrawdownBps: 100,
    autonomousKinds: ['pull_allowance', 'vault_deposit', 'pay_recipient', 'risk_exit', 'noop'],
    createdAt: '2026-09-21T00:00:00.000Z',
    signedBy: TREASURY,
    signature: '0xdeadbeef',
    ...over,
  }) as Policy;

const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) as unknown;

async function seed(policy: Policy = policyBody()): Promise<void> {
  const [user] = await db.insert(schema.users).values({ ownerAddress: TREASURY }).returning();
  userId = user!.id;
  const [wallet] = await db
    .insert(schema.wallets)
    .values({
      userId,
      chainId: 5042002,
      treasuryAddress: TREASURY,
      agentWalletAddress: AGENT,
      activePolicyVersion: policy.version,
    })
    .returning();
  walletId = wallet!.id;
  await db.insert(schema.policies).values({
    walletId,
    version: policy.version,
    body: json({ ...policy, walletId }),
    bodyHash: `0x${'11'.repeat(32)}`,
    status: 'active',
  });
  await db.insert(schema.vaults).values({
    id: 'v1',
    walletId,
    name: 'Demo Vault',
    address: VAULT,
    assetAddress: USDC,
    kind: 'erc4626',
    maxAllocationBps: 10_000,
  });
}

/**
 * A PublicClient that fails every chain read. Used to prove the loop's early exits happen BEFORE
 * anything touches the network (I7: freezing works with the RPC down).
 */
const deadClient = {
  readContract: () => Promise.reject(new Error('rpc is down')),
  getCode: () => Promise.reject(new Error('rpc is down')),
  verifyMessage: () => Promise.reject(new Error('rpc is down')),
} as unknown as PublicClient;

const deps = (over: Partial<DecisionLoopDeps> = {}): DecisionLoopDeps =>
  ({
    db,
    publicClient: deadClient,
    sender: {
      getAddress: () => AGENT,
      send: () => {
        throw new Error('the sender must never be reached in this suite');
      },
    },
    receiptKey: KEY,
    now: () => new Date('2026-09-21T10:00:00.000Z'),
    spendPermissionManagerAddress: MANAGER,
    allowMainnet: false,
    ...over,
  }) as DecisionLoopDeps;

beforeEach(async () => {
  if (pool) await pool.end();
  const fresh = await freshTestDb();
  db = fresh.db;
  pool = fresh.pool;
  await seed();
});

afterAll(async () => {
  await pool?.end();
});

describe('6.1 — the wallet lock (PHASES 6 "Do not: run two loops concurrently")', () => {
  it('uses a namespace distinct from the audit chain lock', () => {
    // 'AUDT' = 0x41554454 in packages/db/src/audit.ts. A shared namespace would deadlock the loop
    // against its own audit writes.
    expect(LOOP_LOCK_NAMESPACE).toBe(0x4c4f_4f50);
    expect(LOOP_LOCK_NAMESPACE).not.toBe(0x4155_4454);
  });

  it('a second acquisition for the same wallet is refused while the first is held', async () => {
    const first = await tryWalletLock(pool, walletId);
    expect(first).not.toBeNull();
    expect(await tryWalletLock(pool, walletId)).toBeNull();
    await first!.release();
    const third = await tryWalletLock(pool, walletId);
    expect(third).not.toBeNull();
    await third!.release();
  });

  it('a different wallet is not blocked', async () => {
    const first = await tryWalletLock(pool, walletId);
    const other = await tryWalletLock(pool, '11111111-2222-4333-8444-555555555555');
    expect(other).not.toBeNull();
    await first!.release();
    await other!.release();
  });

  it('concurrent triggers produce exactly ONE iteration', async () => {
    let entered = 0;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        withWalletLock(pool, walletId, async () => {
          entered += 1;
          await new Promise((r) => setTimeout(r, 40));
          return 'ran';
        }),
      ),
    );
    expect(entered).toBe(1);
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
  });

  it('releases the lock even when the body throws', async () => {
    await expect(
      withWalletLock(pool, walletId, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    const after = await tryWalletLock(pool, walletId);
    expect(after).not.toBeNull();
    await after!.release();
  });
});

describe('6.1 / 6.6 — the loop refuses to act', () => {
  it('SKIPPED when frozen, without touching the chain, and nothing is sent', async () => {
    await db.update(schema.wallets).set({ frozen: true, frozenReason: 'owner' });
    const outcome = await runIteration(deps(), walletId, 'schedule');
    expect(outcome).toEqual({ status: 'skipped', reason: 'wallet is frozen' });

    const audit = await listAuditForEntity(db, 'wallet', walletId);
    expect(audit.map((a) => a.event)).toEqual(['SKIPPED']);
    expect(await db.select().from(schema.executions)).toHaveLength(0);
    expect(await db.select().from(schema.agentDecisions)).toHaveLength(0);
  });

  it('SKIPPED when the breaker is open', async () => {
    await db.update(schema.wallets).set({ breakerOpen: true });
    const outcome = await runIteration(deps(), walletId, 'schedule');
    expect(outcome).toEqual({ status: 'skipped', reason: 'circuit breaker is open' });
  });

  it('6.6 — never re-proposes while an execution is unresolved', async () => {
    const decision = await insertAgentDecision(db, {
      walletId,
      trigger: 'schedule',
      contextSnapshot: {},
      contextHash: `0x${'33'.repeat(32)}`,
      proposalSource: 'deterministic',
      status: 'allowed',
    });
    const [execution] = await db
      .insert(schema.executions)
      .values({
        walletId,
        decisionId: decision.id,
        proposalHash: `0x${'44'.repeat(32)}`,
        kind: 'vault_deposit',
        callsHash: `0x${'55'.repeat(32)}`,
        status: 'submitted',
      })
      .returning();

    const outcome = await runIteration(deps(), walletId, 'schedule');
    expect(outcome.status).toBe('skipped');
    expect(outcome.status === 'skipped' && outcome.reason).toContain(execution!.id);
    expect(outcome.status === 'skipped' && outcome.reason).toContain('submitted');
    // No second decision row: the loop did not even build a context.
    expect(await db.select().from(schema.agentDecisions)).toHaveLength(1);
  });

  it('a pending execution blocks it too, and a settled one does not', async () => {
    const decision = await insertAgentDecision(db, {
      walletId,
      trigger: 'schedule',
      contextSnapshot: {},
      contextHash: `0x${'33'.repeat(32)}`,
      proposalSource: 'deterministic',
      status: 'allowed',
    });
    const [execution] = await db
      .insert(schema.executions)
      .values({
        walletId,
        decisionId: decision.id,
        proposalHash: `0x${'44'.repeat(32)}`,
        kind: 'vault_deposit',
        callsHash: `0x${'55'.repeat(32)}`,
        status: 'pending',
      })
      .returning();
    expect((await runIteration(deps(), walletId, 'schedule')).status).toBe('skipped');

    await db
      .update(schema.executions)
      .set({ status: 'confirmed' })
      .where(eqExecution(execution!.id));
    // Now it gets past the gate and fails on the dead RPC instead — which is the point: the
    // *reason* changed from "unresolved execution" to "cannot read the chain".
    const after = await runIteration(deps(), walletId, 'schedule');
    expect(after.status).toBe('failed');
    expect(after.status === 'failed' && after.code).toBe('READ_FAILED');
  });

  it('a DB that cannot be read aborts before anything else (I5)', async () => {
    const outcome = await runIteration(deps(), '00000000-0000-4000-8000-000000000000', 'schedule');
    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.code).toBe('DB_UNAVAILABLE');
  });
});

describe('6.4 — the approval lifecycle', () => {
  const proposal: Proposal = {
    kind: 'vault_withdraw',
    params: { vaultId: 'v1', amount: 20_000n * ONE },
    expectedDeltas: [{ token: USDC, holder: 'agent', delta: 20_000n * ONE }],
    rationale: 'Keep the runway buffer covered before payroll.',
    citedFactIds: [],
    confidence: 1,
    source: 'serv',
  };

  async function pendingApproval(policyVersion = 1, expiresAt?: Date) {
    const decision = await insertAgentDecision(db, {
      walletId,
      trigger: 'schedule',
      contextSnapshot: { now: '2026-09-21T10:00:00.000Z', facts: [] },
      contextHash: `0x${'66'.repeat(32)}`,
      proposal: json(proposal),
      proposalHash: hashProposal(proposal),
      proposalSource: 'serv',
      status: 'escalated',
    });
    const expires = expiresAt ?? new Date(Date.now() + APPROVAL_TTL_MS);
    const message = approvalMessage({
      walletId,
      proposalHash: hashProposal(proposal),
      policyVersion,
      expiresAt: expires,
    });
    const approval = await insertApproval(db, {
      decisionId: decision.id,
      walletId,
      proposalHash: hashProposal(proposal),
      message,
      expiresAt: expires,
    });
    return { approval, decision, message };
  }

  it('the message is exactly the SECURITY §5 format', async () => {
    const { message } = await pendingApproval();
    const lines = message.split('\n');
    expect(lines[0]).toBe('Thesauros approval');
    expect(lines[1]).toBe(`Wallet: ${walletId}`);
    expect(lines[2]).toBe(`Proposal: ${hashProposal(proposal)}`);
    expect(lines[3]).toBe('Policy: v1');
    expect(lines[4]).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T/);
    expect(lines).toHaveLength(5);
  });

  it('a real owner signature verifies; a different signer does not', async () => {
    const { message } = await pendingApproval();
    const signature = await ownerAccount.signMessage({ message });
    const other = privateKeyToAccount(`0x${'43'.repeat(32)}`);

    // An EOA signature is recoverable offline, so a stub client that does the recovery stands in
    // for the chain here; the ERC-1271/6492 path is exercised on the fork.
    const client = {
      verifyMessage: async (a: { address: string; message: string; signature: string }) => {
        const { verifyMessage } = await import('viem');
        return verifyMessage({
          address: a.address as `0x${string}`,
          message: a.message,
          signature: a.signature as `0x${string}`,
        });
      },
    } as unknown as PublicClient;

    expect(
      (await verifyApprovalSignature(client, { owner: TREASURY, message, signature })).ok,
    ).toBe(true);
    const wrong = await other.signMessage({ message });
    const result = await verifyApprovalSignature(client, {
      owner: TREASURY,
      message,
      signature: wrong,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('BAD_SIGNATURE');
  });

  it('a signature over a DIFFERENT message does not verify', async () => {
    const { message } = await pendingApproval();
    const tampered = message.replace('Policy: v1', 'Policy: v2');
    const signature = await ownerAccount.signMessage({ message: tampered });
    const client = {
      verifyMessage: async (a: { address: string; message: string; signature: string }) => {
        const { verifyMessage } = await import('viem');
        return verifyMessage({
          address: a.address as `0x${string}`,
          message: a.message,
          signature: a.signature as `0x${string}`,
        });
      },
    } as unknown as PublicClient;
    expect(
      (await verifyApprovalSignature(client, { owner: TREASURY, message, signature })).ok,
    ).toBe(false);
  });

  it('a verification that cannot be completed is NOT an approval (I5)', async () => {
    const { message } = await pendingApproval();
    const result = await verifyApprovalSignature(deadClient, {
      owner: TREASURY,
      message,
      signature: '0xdead',
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('VERIFY_FAILED');
  });

  it('replay: the second decide() updates nothing', async () => {
    const { approval } = await pendingApproval();
    const now = new Date();
    expect(await decideApproval(db, approval.id, 'approved', now, '0xsig')).toBeTruthy();
    expect(await decideApproval(db, approval.id, 'approved', now, '0xsig')).toBeUndefined();
    expect((await getApproval(db, approval.id))?.status).toBe('approved');
  });

  it('approve and reject cannot both win', async () => {
    const { approval } = await pendingApproval();
    const now = new Date();
    const [a, b] = await Promise.all([
      decideApproval(db, approval.id, 'approved', now, '0xsig'),
      decideApproval(db, approval.id, 'rejected', now),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('an expired approval is refused by executeApproval', async () => {
    const { approval } = await pendingApproval(1, new Date(Date.now() - 1000));
    await decideApproval(db, approval.id, 'approved', new Date(), '0xsig');
    const result = await executeApproval(
      { ...deps(), now: () => new Date() } as never,
      approval.id,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('EXPIRED');
  });

  it('an approval that is not `approved` never executes', async () => {
    const { approval } = await pendingApproval();
    const result = await executeApproval(
      { ...deps(), now: () => new Date() } as never,
      approval.id,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('NOT_APPROVED');
  });

  it('a policy version bump makes the stored message stale, so nothing executes', async () => {
    const { approval } = await pendingApproval(1);
    await decideApproval(db, approval.id, 'approved', new Date(), '0xsig');
    // Activate v2.
    await db.update(schema.policies).set({ status: 'superseded' });
    await db.insert(schema.policies).values({
      walletId,
      version: 2,
      body: json({ ...policyBody({ version: 2 }), walletId }),
      bodyHash: `0x${'22'.repeat(32)}`,
      status: 'active',
    });
    const result = await executeApproval(
      { ...deps(), now: () => new Date() } as never,
      approval.id,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('POLICY_VERSION_CHANGED');
  });

  it('a policy version change cancels every pending approval and audits each one', async () => {
    const a = await pendingApproval();
    const b = await pendingApproval();
    const cancelled = await cancelApprovalsForPolicyChange(db, walletId, 2, new Date());
    expect(cancelled).toHaveLength(2);
    expect((await getApproval(db, a.approval.id))?.status).toBe('cancelled');
    expect((await getApproval(db, b.approval.id))?.status).toBe('cancelled');
    const audit = await listAuditForEntity(db, 'approval', a.approval.id);
    expect(audit.map((r) => r.event)).toContain('APPROVAL_CANCELLED');
  });

  it('approvals.expire closes the 24h window and leaves decided ones alone', async () => {
    const stale = await pendingApproval(1, new Date(Date.now() - 60_000));
    const live = await pendingApproval();
    const expired = await expirePendingApprovals(db, new Date());
    expect(expired.map((r) => r.id)).toEqual([stale.approval.id]);
    expect((await getApproval(db, live.approval.id))?.status).toBe('pending');
  });

  it('cancelPendingApprovals is what the freeze path uses, and it is idempotent', async () => {
    await pendingApproval();
    expect(await cancelPendingApprovals(db, walletId, new Date())).toHaveLength(1);
    expect(await cancelPendingApprovals(db, walletId, new Date())).toHaveLength(0);
  });
});

describe('NFR-4 — replay refuses to guess', () => {
  it('a decision with no VERDICT audit row cannot be replayed', async () => {
    const decision = await insertAgentDecision(db, {
      walletId,
      trigger: 'schedule',
      contextSnapshot: {},
      contextHash: `0x${'77'.repeat(32)}`,
      proposalSource: 'serv',
      status: 'noop',
    });
    const result = await replay(db, decision.id, walletId);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('MISSING_VERDICT');
  });

  it('a VERDICT row without the stored inputs cannot be replayed', async () => {
    const decision = await insertAgentDecision(db, {
      walletId,
      trigger: 'schedule',
      contextSnapshot: {},
      contextHash: `0x${'88'.repeat(32)}`,
      proposalSource: 'serv',
      status: 'denied',
    });
    await appendAudit(db, {
      walletId,
      actor: 'agent',
      event: 'VERDICT',
      entityType: 'decision',
      entityId: decision.id,
      payload: { decision: 'DENY', policyVersion: 1, results: [] },
    });
    const result = await replay(db, decision.id, walletId);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('MISSING_INPUT');
  });
});

describe('6.5 — obligations.scan', () => {
  it('rolls a monthly obligation forward exactly once', async () => {
    const [recipient] = await db
      .insert(schema.recipients)
      .values({ walletId, label: 'Alex', address: ALEX, maxPerTx: 10_000n * ONE })
      .returning();
    const [obligation] = await db
      .insert(schema.obligations)
      .values({
        walletId,
        recipientId: recipient!.id,
        amount: 3_000n * ONE,
        dueDate: '2026-09-01',
        recurrence: 'monthly',
      })
      .returning();

    const next = addOneMonth(obligation!.dueDate);
    expect(next).toBe('2026-10-01');
    expect(await ensureNextOccurrence(db, obligation!, next)).toBeTruthy();
    // Idempotent: a second scan in the same hour creates nothing.
    expect(await ensureNextOccurrence(db, obligation!, next)).toBeNull();
    expect(await db.select().from(schema.obligations)).toHaveLength(2);
  });

  it('clamps the day of month to 28 so a monthly schedule never skips February', () => {
    expect(addOneMonth('2026-01-31')).toBe('2026-02-28');
    expect(addOneMonth('2026-12-15')).toBe('2027-01-15');
  });

  it('lists only what is due on or before the given date', async () => {
    const [recipient] = await db
      .insert(schema.recipients)
      .values({ walletId, label: 'Alex', address: ALEX, maxPerTx: 10_000n * ONE })
      .returning();
    await db.insert(schema.obligations).values([
      { walletId, recipientId: recipient!.id, amount: ONE, dueDate: '2026-09-01' },
      { walletId, recipientId: recipient!.id, amount: ONE, dueDate: '2026-12-01' },
    ]);
    expect(await listObligationsDue(db, walletId, '2026-09-21')).toHaveLength(1);
  });
});

describe('6.5 — the DEMO half-step is ONE-SHOT', () => {
  // The first live run produced ~100 iterations in 10 minutes instead of 20: the half-step handler
  // queued another half-step, so every cron tick started a self-perpetuating chain and the chains
  // accumulated one per minute. `half: true` is the flag that stops it, so the payload schema has
  // to carry it and the cron tick has to be distinguishable from the half-step.
  it('the tick payload distinguishes a cron tick from a half-step', () => {
    const cron = zLoopTickJob.parse({});
    expect(cron.half).toBeUndefined();
    const half = zLoopTickJob.parse({ half: true });
    expect(half.half).toBe(true);
    // A wallet-scoped tick (what /api/agent/run enqueues) never spawns a half-step either.
    expect(zLoopTickJob.parse({ walletId: '11111111-2222-4333-8444-555555555555' }).walletId).toBe(
      '11111111-2222-4333-8444-555555555555',
    );
  });

  it('the guard only re-queues for a cron tick, so the cadence is exactly 2 per minute', () => {
    // The condition as the handler evaluates it.
    const spawns = (data: { walletId?: string; half?: boolean }) => {
      const p = zLoopTickJob.parse(data);
      return !p.walletId && p.half !== true;
    };
    expect(spawns({})).toBe(true); // cron tick -> one half-step
    expect(spawns({ half: true })).toBe(false); // half-step -> nothing (the fix)
    expect(spawns({ walletId: '11111111-2222-4333-8444-555555555555' })).toBe(false);
  });
});

describe('6.5 — risk.scan bookkeeping', () => {
  it('flags a vault so R04 refuses new deposits, and can clear it again', async () => {
    await setVaultFlagged(db, walletId, 'v1', true, 'share price -300 bps');
    expect((await listVaultRows(db, walletId))[0]?.flagged).toBe(true);
    await setVaultFlagged(db, walletId, 'v1', false, null);
    expect((await listVaultRows(db, walletId))[0]?.flagged).toBe(false);
  });

  it('listActiveWalletIds skips frozen wallets and wallets with no active policy', async () => {
    expect(await listActiveWalletIds(db)).toEqual([walletId]);
    await db.update(schema.wallets).set({ frozen: true });
    expect(await listActiveWalletIds(db)).toEqual([]);
    await db.update(schema.wallets).set({ frozen: false, breakerOpen: true });
    expect(await listActiveWalletIds(db)).toEqual([]);
    await db.update(schema.wallets).set({ breakerOpen: false });
    await db.update(schema.policies).set({ status: 'superseded' });
    expect(await listActiveWalletIds(db)).toEqual([]);
  });
});

describe('I6 — the chain survives everything this suite did', () => {
  it('verifyChain passes for the wallet after a run of skips and approvals', async () => {
    await db.update(schema.wallets).set({ frozen: true });
    await runIteration(deps(), walletId, 'schedule');
    await runIteration(deps(), walletId, 'owner');
    const verified = await verifyChain(db, walletId);
    expect(verified.ok, verified.ok ? '' : JSON.stringify(verified.error)).toBe(true);
    expect(verified.ok && verified.value.rows).toBeGreaterThan(0);
  });
});

const eqExecution = (id: string) => eq(schema.executions.id, id);
