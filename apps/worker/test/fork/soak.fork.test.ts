// Task 8.9 — LOAD / SOAK. "10 wallets x 1 hour in DEMO_MODE on a fork; no duplicate executions,
// p95 iteration time recorded."
//
// WHAT IS REAL HERE: a real anvil fork of Base Sepolia (the real MockVault, the real Circle testnet
// USDC), a real Postgres, the real Policy Engine, the real risk gate (`eth_simulateV1` against the
// fork), the real executor, the real confirmer, the real per-wallet advisory lock, and ten wallets
// whose iterations run CONCURRENTLY against all of it. Only SERV is absent: every wallet runs the
// deterministic path (`degraded`), which is the path that actually produces executions and so the
// only one that can produce a DUPLICATE execution.
//
// WHAT IS COMPRESSED: wall-clock time, and nothing else. The loop's clock is injected, so a round
// advances `now` by the 30-second DEMO cadence instead of sleeping for it. 120 rounds is therefore
// one simulated hour per wallet, with the same number of iterations, the same rolling R07/R14
// windows and the same on-chain work as a real hour — the bugs this test exists to catch (a second
// send for one proposal hash, a lock that lets two iterations overlap, a rolling window computed
// off the wrong clock) are functions of iteration count and concurrency, not of waiting.
//
// Opt-in, like every other fork suite (needs anvil + an RPC + Postgres):
//   THESAUROS_FORK=1 npx vitest run apps/worker/test/fork/soak.fork.test.ts
//   THESAUROS_SOAK_ROUNDS=120   (default; 120 rounds x 30 s = 1 simulated hour)
import { spawn, type ChildProcess } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createTestClient,
  getAddress,
  http,
  publicActions,
  walletActions,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { eq } from 'drizzle-orm';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { schema, setWalletFrozen, verifyChain, type Db } from '@thesauros/db';
import { ok, type Policy } from '@thesauros/shared';
import { confirmExecution, type Call, type TxSender } from '@thesauros/wallet';
import { freshTestDb } from '../../../../packages/db/test/helpers';
import { runIteration, type DecisionLoopDeps } from '../../src/loop';
import { withWalletLock } from '../../src/lock';
import type { ConfirmRequest } from '../../src/pipeline';

const FORK = process.env['THESAUROS_FORK'] === '1';
const ROUNDS = Number(process.env['THESAUROS_SOAK_ROUNDS'] ?? 120);
const WALLETS = 10;
/** The DEMO cadence (D-59): one tick every 30 s, so ROUNDS x TICK_MS is the simulated window. */
const TICK_MS = 30_000;
/** Three triggers per wallet per round, so the advisory lock is genuinely contended. */
const TRIGGERS_PER_ROUND = 3;

const RPC = process.env['RPC_URL_BASE_SEPOLIA'] ?? 'https://sepolia.base.org';
const VAULT = getAddress(
  process.env['MOCK_VAULT_ADDRESS'] ?? '0x3741f0da6dFFfFD8Be2353e326a49E41a3396485',
);
const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
const MANAGER = getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad');
const PORT = 8549;
const ONE = 1_000_000n;
const KEY = new Uint8Array(32).fill(11);

/** Exists only in this process, for this test. Never printed, never persisted. */
const ownerAccount = privateKeyToAccount(`0x${'42'.repeat(32)}`);
const TREASURY = ownerAccount.address;

/** One distinct agent wallet per soak wallet, so their on-chain state cannot mask a duplicate. */
const agentFor = (i: number): Address =>
  getAddress(`0x${(0xa9e180000n + BigInt(i)).toString(16).padStart(40, '0')}`);

let anvil: ChildProcess;
let client: ReturnType<typeof createTestClient> &
  ReturnType<typeof publicActions> &
  ReturnType<typeof walletActions>;
let publicClient: PublicClient;
let db: Db;
let pool: Awaited<ReturnType<typeof freshTestDb>>['pool'];
/**
 * A SEPARATE pool for the advisory locks — finding F-2, which this suite is what found.
 * `tryWalletLock` holds its connection for the whole iteration, and everything that iteration does
 * needs a connection too; taken from one pool they deadlock the moment wallet concurrency reaches
 * the pool size. `apps/worker/src/index.ts` now does exactly this in production.
 */
let lockPool: pg.Pool;

type SoakWallet = { id: string; agent: Address };
let wallets: SoakWallet[] = [];

const confirmQueue: ConfirmRequest[] = [];
/** Every `TxSender.send`, in order — the ground truth for "was anything sent twice?". */
const sends: { agent: Address; calls: readonly Call[] }[] = [];

const bigintSafe = (_k: string, x: unknown) => (typeof x === 'bigint' ? x.toString() : x);
const json = (v: unknown) => JSON.parse(JSON.stringify(v, bigintSafe)) as unknown;

const policyBody = (walletId: string): Policy =>
  ({
    version: 1,
    walletId,
    chainId: 84532,
    treasuryAddress: TREASURY,
    tokens: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
    vaults: [
      {
        id: 'v1',
        name: 'Thesauros Demo USDC Vault',
        address: VAULT,
        asset: USDC,
        kind: 'erc4626',
        maxAllocationBps: 10_000,
      },
    ],
    recipients: [],
    // Deliberately loose per-tx and daily caps: what should bind in this run is the SYSTEM ceiling
    // R14 enforces (20 actions/hour), so every wallet keeps proposing for the whole simulated hour
    // and the rolling-window rules get exercised under concurrency instead of the wallet going
    // quiet after one deposit.
    limits: { perTxMicroUsd: 5_000n * ONE, dailyMicroUsd: 50_000n * ONE, maxActionsPerHour: 20 },
    runwayBufferMicroUsd: 100n * ONE,
    approvalThresholdMicroUsd: 1_000n * ONE,
    depegThresholdBps: 50,
    vaultDrawdownBps: 100,
    autonomousKinds: ['vault_deposit', 'vault_withdraw', 'risk_exit', 'noop'],
    createdAt: '2026-09-21T00:00:00.000Z',
    signedBy: TREASURY,
    signature: '0xdeadbeef',
  }) as unknown as Policy; // Base Sepolia fork fixture (Phase 2 rewrites this against Arc; chainId is intentionally out-of-union here)

/** The fork's `TxSender`. Same harness limitation as loop.fork.test.ts: no batching. */
const senderFor = (agent: Address): TxSender => ({
  getAddress: () => agent,
  async send(calls: readonly Call[]) {
    sends.push({ agent, calls });
    let last: Hex | undefined;
    for (const call of calls) {
      const hash = await client.sendTransaction({ account: agent, chain: null, ...call });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`call to ${call.to} reverted`);
      last = hash;
    }
    if (!last) throw new Error('no calls to send');
    return ok({ providerTxId: last });
  },
});

const loopDeps = (w: SoakWallet, now: () => Date): DecisionLoopDeps =>
  ({
    db,
    publicClient,
    sender: senderFor(w.agent),
    receiptKey: KEY,
    now,
    spendPermissionManagerAddress: MANAGER,
    allowMainnet: false,
    enqueueConfirm: async (job: ConfirmRequest) => {
      confirmQueue.push(job);
    },
  }) as DecisionLoopDeps;

async function drainConfirms(now: () => Date): Promise<void> {
  for (const job of confirmQueue.splice(0)) {
    await confirmExecution(
      { db, client: {} as never, publicClient, now, timeoutMs: 30_000, pollIntervalMs: 250 },
      {
        executionId: job.executionId,
        providerTxId: job.providerTxId,
        token: job.token,
        holders: job.holders,
        expectedDeltas: [...job.expectedDeltas],
        ...(job.obligationId === undefined ? {} : { obligationId: job.obligationId }),
      },
    );
  }
}

async function dealUsdc(who: Address, amount: bigint): Promise<void> {
  const raw = client as unknown as {
    request(args: { method: string; params: unknown[] }): Promise<unknown>;
  };
  await raw.request({
    method: 'anvil_dealERC20',
    params: [who, USDC, `0x${amount.toString(16)}`],
  });
}

async function seedWallet(i: number): Promise<SoakWallet> {
  const agent = agentFor(i);
  const [user] = await db
    .insert(schema.users)
    .values({
      ownerAddress: getAddress(`0x${(0xbeef0000n + BigInt(i)).toString(16).padStart(40, '0')}`),
    })
    .returning();
  const [wallet] = await db
    .insert(schema.wallets)
    .values({
      userId: user!.id,
      chainId: 84532,
      treasuryAddress: TREASURY,
      agentWalletAddress: agent,
      activePolicyVersion: 1,
    })
    .returning();
  const id = wallet!.id;
  await db.insert(schema.policies).values({
    walletId: id,
    version: 1,
    body: json(policyBody(id)),
    bodyHash: `0x${String(i).padStart(2, '0').repeat(32)}`.slice(0, 66),
    status: 'active',
  });
  await db.insert(schema.vaults).values({
    id: 'v1',
    walletId: id,
    name: 'Thesauros Demo USDC Vault',
    address: VAULT,
    assetAddress: USDC,
    kind: 'erc4626',
    maxAllocationBps: 10_000,
  });

  await client.setBalance({ address: agent, value: 10n ** 18n });
  await client.impersonateAccount({ address: agent });
  return { id, agent };
}

const percentile = (xs: number[], p: number): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
};

describe.skipIf(!FORK)(`8.9 soak: ${WALLETS} wallets x ${ROUNDS} rounds`, () => {
  beforeAll(async () => {
    anvil = spawn(
      'anvil',
      ['--fork-url', RPC, '--port', String(PORT), '--silent', '--no-rate-limit'],
      { stdio: 'ignore', shell: process.platform === 'win32' },
    );
    const probe = createPublicClient({ transport: http(`http://127.0.0.1:${PORT}`) });
    for (let i = 0; i < 60; i++) {
      try {
        await probe.getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    client = createTestClient({
      chain: baseSepolia,
      mode: 'anvil',
      transport: http(`http://127.0.0.1:${PORT}`),
    })
      .extend(publicActions)
      .extend(walletActions) as typeof client;
    publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(`http://127.0.0.1:${PORT}`),
    }) as PublicClient;

    const fresh = await freshTestDb();
    db = fresh.db;
    pool = fresh.pool;
    const { testDbUrl } = await import('../../../../packages/db/test/helpers');
    lockPool = new pg.Pool({ connectionString: testDbUrl(), max: WALLETS * TRIGGERS_PER_ROUND });
    wallets = [];
    for (let i = 0; i < WALLETS; i++) wallets.push(await seedWallet(i));
  }, 600_000);

  afterAll(async () => {
    anvil?.kill();
    await lockPool?.end();
    await pool?.end();
  }, 60_000);

  it('runs the soak: no duplicate execution, and the audit chain still verifies', async () => {
    const start = new Date('2026-09-23T00:00:00.000Z');
    const latencies: number[] = [];
    let iterations = 0;
    const statuses = new Map<string, number>();
    /** Why iterations went quiet — the honest half of a soak result. */
    const reasons = new Map<string, number>();
    const errors: string[] = [];
    /**
     * The R14 rate limit trips the circuit breaker, which FREEZES the wallet (SECURITY §8 row
     * 13). That is correct and it is real evidence — but a frozen wallet skips every later
     * iteration, so without an owner unfreezing it the "1 hour" would really be 10 minutes of
     * load. A live owner would unfreeze; the soak does the same, and counts how often.
     */
    let breakerTrips = 0;

    for (let round = 0; round < ROUNDS; round++) {
      const at = new Date(start.getTime() + round * TICK_MS);
      const now = () => at;

      // Keep every wallet with something to think about: idle cash above the 100 USDC buffer,
      // a different amount each round so R17 (same action twice in 24 h) does not park the
      // wallet after the first deposit — RR-14. DEMO funding on a fork; the policy's own caps
      // decide what actually moves.
      for (const w of wallets) await dealUsdc(w.agent, (300n + BigInt(round)) * ONE);

      const jobs = wallets.flatMap((w) =>
        Array.from({ length: TRIGGERS_PER_ROUND }, () =>
          withWalletLock(lockPool, w.id, async () => {
            const t0 = performance.now();
            const outcome = await runIteration(loopDeps(w, now), w.id, 'schedule');
            latencies.push(performance.now() - t0);
            iterations += 1;
            statuses.set(outcome.status, (statuses.get(outcome.status) ?? 0) + 1);
            if (outcome.status === 'failed') errors.push(`${outcome.code}: ${outcome.message}`);
            if (outcome.status === 'skipped' || outcome.status === 'noop') {
              // Strip ids so the reasons actually group.
              const r = outcome.reason.replace(/[0-9a-f-]{36}/g, '<id>');
              reasons.set(r, (reasons.get(r) ?? 0) + 1);
            }
            return outcome;
          }),
        ),
      );
      await Promise.all(jobs);
      await drainConfirms(now);

      for (const w of wallets) {
        const [row] = await db.select().from(schema.wallets).where(eq(schema.wallets.id, w.id));
        if (row?.frozen) {
          breakerTrips += 1;
          await setWalletFrozen(db, w.id, false, null, at);
        }
      }
    }

    // ── I10: no duplicate execution, anywhere ───────────────────────────────────────────────────
    const executions = await db.select().from(schema.executions);
    const byKey = new Map<string, number>();
    for (const e of executions) {
      const key = `${e.walletId}:${e.proposalHash}`;
      byKey.set(key, (byKey.get(key) ?? 0) + 1);
    }
    const duplicates = [...byKey.entries()].filter(([, n]) => n > 1);
    expect(duplicates).toEqual([]);

    // The stronger form: the executor never SENT twice for one execution row either.
    const submitted = executions.filter((e) => e.txHash !== null);
    expect(sends.length).toBe(submitted.length);

    // Every wallet's chain still verifies after all of that concurrency.
    for (const w of wallets) {
      const chain = await verifyChain(db, w.id);
      expect(chain.ok, chain.ok ? '' : JSON.stringify(chain, bigintSafe)).toBe(true);
    }

    // ── NFR-2: loop iteration (excluding chain confirmation) under 20 s ─────────────────────────
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const report = {
      wallets: WALLETS,
      rounds: ROUNDS,
      simulatedWindowMinutes: (ROUNDS * TICK_MS) / 60_000,
      triggersFired: ROUNDS * WALLETS * TRIGGERS_PER_ROUND,
      iterationsRun: iterations,
      lockRefusals: ROUNDS * WALLETS * TRIGGERS_PER_ROUND - iterations,
      statuses: Object.fromEntries(statuses),
      quietReasons: Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5)),
      executions: executions.length,
      submitted: submitted.length,
      sends: sends.length,
      duplicateExecutions: duplicates.length,
      p50Ms: Math.round(percentile(latencies, 50)),
      p95Ms: Math.round(p95),
      p99Ms: Math.round(p99),
      maxMs: Math.round(Math.max(...latencies)),
      breakerTrips,
      errors: errors.slice(0, 10),
    };
    // Straight to stdout rather than `console.log`: vitest intercepts console output and this
    // report IS the deliverable of 8.9, so it must survive being piped to a file.
    process.stdout.write(`
SOAK REPORT ${JSON.stringify(report, null, 2)}
`);

    expect(p95).toBeLessThan(20_000);
    expect(errors).toEqual([]);
  }, 3_600_000);

  it('I10 under real concurrency: three UNLOCKED iterations for one wallet send once', async () => {
    // The lock is what production relies on. This removes it on purpose, to prove the executor's
    // own idempotency (proposal hash + single-use receipt nonce) is what actually stops a double
    // send — not merely the fact that the loop is serialised.
    const w = wallets[0]!;
    const at = new Date('2026-09-23T02:00:00.000Z');
    await dealUsdc(w.agent, 300n * ONE);
    const before = sends.length;

    const outcomes = await Promise.all(
      Array.from({ length: 3 }, () =>
        runIteration(
          loopDeps(w, () => at),
          w.id,
          'schedule',
        ),
      ),
    );
    await drainConfirms(() => at);

    const hashes = new Set(
      (await db.select().from(schema.executions))
        .filter((e) => e.walletId === w.id)
        .map((e) => e.proposalHash),
    );
    const rows = (await db.select().from(schema.executions)).filter((e) => e.walletId === w.id);
    // One row per proposal hash, still, and at most one new send for the new hash.
    expect(rows.length).toBe(hashes.size);
    expect(sends.length - before).toBeLessThanOrEqual(1);
    expect(outcomes.filter((o) => o.status === 'failed')).toEqual([]);
  }, 600_000);
});
