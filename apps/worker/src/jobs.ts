// 6.5 / 6.6 — the scheduler and the boot-time crash recovery.
//
// Queues (API.md "Jobs"):
//   loop.tick         cron every minute; in DEMO_MODE the handler also re-queues itself at +30 s,
//                     because cron's finest granularity is one minute
//   loop.run          one wallet, one iteration (what /api/agent/run and the other jobs enqueue)
//   exec.confirm      Phase 5's confirmer (registered in jobs/confirm.ts)
//   obligations.scan  hourly; creates the next monthly occurrence, idempotently
//   risk.scan         every minute; writes vault + price snapshots and triggers the loop on a hit
//   permission.scan   every 5 minutes; detects an out-of-band spend-permission revoke (8.1)
//   approvals.expire  every 5 minutes
//   price.refresh     every minute, DEMO_MODE + Arc testnet (chain 5042002) ONLY (I11)
//
// The per-wallet advisory lock lives here, around `runIteration`, so it has exactly one owner and a
// job that cannot take it simply returns (PHASES 6 "Do not: run two loops concurrently").
import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import type { PublicClient } from 'viem';
import { getAddress } from 'viem';
import {
  appendAudit,
  ensureNextOccurrence,
  expirePendingApprovals,
  getActivePolicy,
  getAgentDecision,
  getApproval,
  getUserIdForWallet,
  getWalletById,
  insertNotification,
  insertPriceSnapshot,
  insertVaultSnapshot,
  listActiveWalletIds,
  listObligationsDue,
  listUnresolvedExecutions,
  setVaultFlagged,
  type Db,
} from '@thesauros/db';
import { priceSnapshotRow, type PriceAdapter } from '@thesauros/risk';
import { createLogger, zPolicy, zProposal, type Address, type Env } from '@thesauros/shared';
import { reconcileExecution, type DemoPriceRefresher, type TxSender } from '@thesauros/wallet';
import { EXEC_CONFIRM_QUEUE, registerConfirmJob } from './jobs/confirm';
import { registerPermissionScanJob } from './jobs/permissionScan';
import { registerScreeningJob } from './jobs/screening';
import { registerWeeklyReportJob } from './jobs/weeklyReport';
import { gather, isoDate } from './gather';
import { withWalletLock } from './lock';
import { runIteration, type DecisionLoopDeps } from './loop';
import { executeApproval } from './approvals';
import { ServBreaker } from './runtime';
import type { ConfirmRequest } from './pipeline';
import type { DecisionTrigger } from './prechecks';

const log = createLogger('jobs');

export const LOOP_TICK_QUEUE = 'loop.tick';
export const LOOP_RUN_QUEUE = 'loop.run';
export const OBLIGATIONS_SCAN_QUEUE = 'obligations.scan';
export const RISK_SCAN_QUEUE = 'risk.scan';
export const APPROVALS_EXPIRE_QUEUE = 'approvals.expire';
export const APPROVALS_EXECUTE_QUEUE = 'approvals.execute';
export const PRICE_REFRESH_QUEUE = 'price.refresh';

export const zLoopRunJob = z.object({
  walletId: z.string().uuid(),
  trigger: z
    .enum(['schedule', 'balance', 'obligation', 'risk', 'owner', 'approval'])
    .default('schedule'),
});
export const zLoopTickJob = z
  .object({
    walletId: z.string().uuid().optional(),
    /** True on the DEMO half-step, which must NOT queue another one (see the handler). */
    half: z.boolean().optional(),
  })
  .default({});
export const zApprovalJob = z.object({ approvalId: z.string().uuid() });

const DAY_MS = 86_400_000;
/** DEMO_MODE tick cadence (PHASES 6.5). Cron cannot go below a minute, so we half-step. */
const DEMO_TICK_SECONDS = 30;

export type JobDeps = {
  boss: PgBoss;
  db: Db;
  pool: Pool;
  env: Env;
  publicClient: PublicClient;
  /** One sender per treasury wallet (Circle developer-controlled wallet). */
  senderFor: (walletId: string) => Promise<TxSender>;
  receiptKey: Uint8Array;
  serv?: DecisionLoopDeps['serv'];
  priceAdapter?: PriceAdapter | undefined;
  demoPrice?: DemoPriceRefresher | undefined;
  now?: () => Date;
};

export async function registerJobs(deps: JobDeps): Promise<void> {
  const { boss, db, env } = deps;
  const now = deps.now ?? (() => new Date());
  const breaker = new ServBreaker(db, now);
  const manager = getAddress(env.SPEND_PERMISSION_MANAGER_ADDRESS);
  const usycAddress = getAddress(env.USYC_ADDRESS);
  const allowMainnet = env.THESAUROS_ALLOW_MAINNET;

  await registerConfirmJob({ boss, db, env, publicClient: deps.publicClient });
  // 8.1 — out-of-band revoke detection. Its own module so `owner-path-no-reasoning` can prove it
  // never reaches the reasoning layer (I7).
  await registerPermissionScanJob({
    boss,
    db,
    env,
    publicClient: deps.publicClient,
    ...(deps.now ? { now: deps.now } : {}),
  });
  // 8.6 — weekly treasury report (yield / payments / blocked), once a week per wallet.
  await registerWeeklyReportJob({ boss, db, ...(deps.now ? { now: deps.now } : {}) });
  // RFB 5 / I13 — continuous compliance re-screening, not a one-time onboarding gate.
  await registerScreeningJob({
    boss,
    db,
    model: env.SERV_MODEL_PROPOSER,
    ...(deps.serv ? { client: deps.serv.client } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });

  const enqueueConfirm = async (job: ConfirmRequest): Promise<void> => {
    await boss.send(EXEC_CONFIRM_QUEUE, {
      executionId: job.executionId,
      token: job.token,
      holders: job.holders,
      expectedDeltas: job.expectedDeltas.map((d) => ({ ...d, delta: d.delta.toString() })),
      ...(job.obligationId === undefined ? {} : { obligationId: job.obligationId }),
      ...(job.counterpartyLabel === undefined ? {} : { counterpartyLabel: job.counterpartyLabel }),
    });
  };

  /** Build the loop deps for one wallet (the sender is per-treasury). */
  const loopDepsFor = async (walletId: string): Promise<DecisionLoopDeps | null> => {
    const userId = await getUserIdForWallet(db, walletId);
    if (!userId) return null;
    return {
      db,
      publicClient: deps.publicClient,
      sender: await deps.senderFor(walletId),
      receiptKey: deps.receiptKey,
      now,
      spendPermissionManagerAddress: manager,
      usycAddress,
      allowMainnet,
      enqueueConfirm,
      priceAdapter: deps.priceAdapter,
      serv: deps.serv,
      degraded: breaker.degraded,
      onServFailure: (task, detail) => void breaker.recordFailure(task, detail),
      onServSuccess: () => void breaker.recordSuccess(),
    };
  };

  /** The one place the wallet lock is taken. */
  const runLocked = async (walletId: string, trigger: DecisionTrigger): Promise<void> => {
    const held = await withWalletLock(deps.pool, walletId, async () => {
      const loopDeps = await loopDepsFor(walletId);
      if (!loopDeps) {
        log.warn({ walletId }, 'no owner for wallet; skipping');
        return null;
      }
      return runIteration(loopDeps, walletId, trigger);
    });
    if (!held.acquired) {
      log.info({ walletId }, 'another iteration holds the lock; nothing to do');
      return;
    }
    const outcome = held.value;
    if (outcome) log.info({ walletId, trigger, status: outcome.status }, 'iteration finished');
  };

  // ── loop.run — one wallet, one iteration ───────────────────────────────────────────────────────
  await boss.createQueue(LOOP_RUN_QUEUE);
  await boss.work(LOOP_RUN_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const parsed = zLoopRunJob.safeParse(job.data);
      if (!parsed.success) throw new Error(`malformed ${LOOP_RUN_QUEUE} job ${job.id}`);
      await runLocked(parsed.data.walletId, parsed.data.trigger);
    }
  });

  // ── loop.tick — fan out to every active wallet ─────────────────────────────────────────────────
  await boss.createQueue(LOOP_TICK_QUEUE);
  await boss.work(LOOP_TICK_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const parsed = zLoopTickJob.safeParse(job.data ?? {});
      if (!parsed.success) throw new Error(`malformed ${LOOP_TICK_QUEUE} job ${job.id}`);
      const walletIds = parsed.data.walletId
        ? [parsed.data.walletId]
        : await listActiveWalletIds(db);
      for (const walletId of walletIds) {
        await boss.send(LOOP_RUN_QUEUE, { walletId, trigger: 'schedule' });
      }
      // DEMO_MODE wants a 30 s cadence and cron's floor is one minute, so each CRON tick queues
      // exactly one half-step at +30 s.
      //
      // `half: true` is what makes it one-shot, and it is load-bearing: without it the half-step's
      // own handler queued another half-step, so every cron tick started a self-perpetuating chain
      // and the chains accumulated one per minute. The first live run produced ~100 iterations in
      // 10 minutes instead of 20. (`singletonKey` did not save us: on a standard-policy pg-boss
      // queue it is not a uniqueness constraint.)
      if (env.DEMO_MODE && !parsed.data.walletId && parsed.data.half !== true) {
        await boss.send(
          LOOP_TICK_QUEUE,
          { half: true },
          { startAfter: DEMO_TICK_SECONDS, singletonKey: 'demo-half-step' },
        );
      }
    }
  });
  await boss.schedule(LOOP_TICK_QUEUE, '* * * * *');

  // ── obligations.scan — roll monthly obligations forward, once ──────────────────────────────────
  await boss.createQueue(OBLIGATIONS_SCAN_QUEUE);
  await boss.work(OBLIGATIONS_SCAN_QUEUE, async () => {
    const at = now();
    for (const walletId of await listActiveWalletIds(db)) {
      // Anything already due: make sure next month's occurrence exists, so a payment that runs
      // today does not leave the schedule empty.
      for (const obligation of await listObligationsDue(db, walletId, isoDate(at))) {
        if (obligation.recurrence !== 'monthly') continue;
        const next = addOneMonth(obligation.dueDate);
        const created = await ensureNextOccurrence(db, obligation, next);
        if (created)
          await appendAudit(db, {
            walletId,
            actor: 'system',
            event: 'OBLIGATION_SCHEDULED',
            entityType: 'obligation',
            entityId: created,
            payload: { from: obligation.id, dueDate: next, amount: obligation.amount.toString() },
            createdAt: at,
          });
      }
    }
  });
  await boss.schedule(OBLIGATIONS_SCAN_QUEUE, '0 * * * *');

  // ── risk.scan — snapshot vaults + prices, trigger the loop on a hit ────────────────────────────
  await boss.createQueue(RISK_SCAN_QUEUE);
  await boss.work(RISK_SCAN_QUEUE, async () => {
    const at = now();
    for (const walletId of await listActiveWalletIds(db)) {
      const gathered = await gather(
        {
          db,
          publicClient: deps.publicClient,
          spendPermissionManagerAddress: manager,
          usycAddress,
          allowMainnet,
          now,
          priceAdapter: deps.priceAdapter,
        },
        walletId,
      );
      if (!gathered.ok) {
        log.warn({ walletId, error: gathered.error }, 'risk.scan: gather failed');
        continue;
      }
      const g = gathered.value;

      // The snapshot is written AFTER the triggers were computed against the previous one, so a
      // drawdown is noticed exactly once per pair of snapshots rather than being overwritten.
      for (const v of g.vaults) {
        await insertVaultSnapshot(db, {
          walletId,
          vaultId: v.id,
          sharePrice: v.sharePrice,
          totalAssets: v.totalAssets,
          positionAssets: v.positionAssets,
        });
      }
      if (deps.priceAdapter) {
        const quote = await deps.priceAdapter.getPrice(g.usdc);
        if (quote.ok) await insertPriceSnapshot(db, priceSnapshotRow(g.usdc, quote.value));
      }

      if (g.riskTriggers.length === 0) continue;
      for (const trigger of g.riskTriggers) {
        // R04 refuses NEW deposits into a flagged vault until the owner clears the flag
        // (SERV_REASONING §6 Example D).
        await setVaultFlagged(db, walletId, trigger.vaultId, true, trigger.observed);
      }
      await appendAudit(db, {
        walletId,
        actor: 'system',
        event: 'RISK_TRIGGER',
        entityType: 'wallet',
        entityId: walletId,
        payload: { triggers: g.riskTriggers },
        createdAt: at,
      });
      await notifyOwner(db, walletId, {
        type: 'risk',
        title: 'Thesauros detected a vault risk event',
        body: g.riskTriggers.map((t) => `${t.trigger}: ${t.observed}`).join(' · '),
        payload: { triggers: g.riskTriggers },
      });
      await boss.send(LOOP_RUN_QUEUE, { walletId, trigger: 'risk' });
    }
  });
  await boss.schedule(RISK_SCAN_QUEUE, '* * * * *');

  // ── approvals.expire ───────────────────────────────────────────────────────────────────────────
  await boss.createQueue(APPROVALS_EXPIRE_QUEUE);
  await boss.work(APPROVALS_EXPIRE_QUEUE, async () => {
    const at = now();
    for (const row of await expirePendingApprovals(db, at)) {
      await appendAudit(db, {
        walletId: row.walletId,
        actor: 'system',
        event: 'APPROVAL_EXPIRED',
        entityType: 'approval',
        entityId: row.id,
        payload: { decisionId: row.decisionId, proposalHash: row.proposalHash },
        createdAt: at,
      });
    }
  });
  await boss.schedule(APPROVALS_EXPIRE_QUEUE, '*/5 * * * *');

  // ── approvals.execute — an owner-signed approval, verified again, then run ─────────────────────
  await boss.createQueue(APPROVALS_EXECUTE_QUEUE);
  await boss.work(APPROVALS_EXECUTE_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const parsed = zApprovalJob.safeParse(job.data);
      if (!parsed.success) throw new Error(`malformed ${APPROVALS_EXECUTE_QUEUE} job ${job.id}`);
      const { approvalId } = parsed.data;
      const approval = await getApproval(db, approvalId);
      if (!approval) {
        log.error({ approvalId }, 'approval vanished');
        continue;
      }
      // Same lock as the loop: an approval execution is an iteration for that wallet.
      const held = await withWalletLock(deps.pool, approval.walletId, async () => {
        const loopDeps = await loopDepsFor(approval.walletId);
        if (!loopDeps) return null;
        return executeApproval(loopDeps, approvalId);
      });
      if (!held.acquired) {
        // Try again shortly rather than dropping the owner's approval on the floor.
        await boss.send(APPROVALS_EXECUTE_QUEUE, { approvalId }, { startAfter: 15 });
        continue;
      }
      const result = held.value;
      if (result && !result.ok)
        log.error({ approvalId, error: result.error }, 'approval execution refused');
      else if (result) log.info({ approvalId, status: result.value.status }, 'approval executed');
    }
  });

  // ── price.refresh — DEMO ONLY (I11) ────────────────────────────────────────────────────────────
  if (env.DEMO_MODE && env.CHAIN_ID === 5042002 && deps.demoPrice) {
    const refresher = deps.demoPrice;
    await boss.createQueue(PRICE_REFRESH_QUEUE);
    await boss.work(PRICE_REFRESH_QUEUE, async () => {
      const sent = await refresher.setPrice(1_000_000n);
      if (!sent.ok) log.warn({ reason: sent.error }, 'demo price refresh failed');
      else log.info({ tx: sent.value }, 'demo price refreshed');
    });
    await boss.schedule(PRICE_REFRESH_QUEUE, '* * * * *');
    log.warn('DEMO_MODE: price.refresh is republishing the MockPriceFeed quote every minute (I11)');
  }
}

/**
 * 6.6 — close the crash window on boot.
 *
 * Every `pending`/`submitted` execution is reconciled: a row with a hash goes back to the confirmer,
 * a hash-less one is decided by `reconcileExecution` (which looks for the transfer on-chain and
 * NEVER resends). Until this has run, `runIteration` refuses to propose for that wallet anyway.
 */
export async function resumeCrashWindow(deps: {
  boss: PgBoss;
  db: Db;
  publicClient: PublicClient;
  now?: () => Date;
}): Promise<{ resumed: number; uncertain: number; neverSent: number }> {
  const now = deps.now ?? (() => new Date());
  const open = await listUnresolvedExecutions(deps.db);
  const counts = { resumed: 0, uncertain: 0, neverSent: 0 };
  // This runs before `registerJobs` on boot (recovery first, then scheduling), so the confirm queue
  // may not exist yet. `createQueue` is idempotent; without it the first resumed execution throws
  // "Queue exec.confirm does not exist" and the whole boot fails.
  if (open.length > 0) await deps.boss.createQueue(EXEC_CONFIRM_QUEUE);

  for (const execution of open) {
    const context = await executionContext(deps.db, execution.walletId);
    if (!context) {
      log.error(
        { executionId: execution.id },
        'cannot resume: no wallet/policy for this execution',
      );
      continue;
    }

    const outcome = await reconcileExecution(
      { db: deps.db, publicClient: deps.publicClient, now, token: context.token },
      execution,
      context.agent,
    );
    if (!outcome.ok) {
      log.error({ executionId: execution.id, error: outcome.error }, 'reconciliation failed');
      continue;
    }

    if (outcome.value.status === 'has-hash') {
      // It reached the chain: the confirmer owns it from here. The claimed deltas come from the
      // decision's stored proposal, so the confirmer still checks the MEASURED effect (5.5) rather
      // than trusting a receipt's success flag.
      const deltas = await expectedDeltasOf(deps.db, execution.decisionId);
      const recipient = await recipientOf(deps.db, execution.decisionId);
      await deps.boss.send(EXEC_CONFIRM_QUEUE, {
        executionId: execution.id,
        token: context.token,
        holders: {
          agent: context.agent,
          treasury: context.treasury,
          ...(recipient ? { recipient } : {}),
        },
        expectedDeltas: deltas,
      });
      counts.resumed += 1;
      log.warn({ executionId: execution.id }, 'crash window: handed back to the confirmer');
      continue;
    }

    if (outcome.value.status === 'uncertain') {
      counts.uncertain += 1;
      await notifyOwner(deps.db, execution.walletId, {
        type: 'execution',
        title: 'Thesauros needs you to check a transaction',
        body: `Execution ${execution.id} was interrupted and may or may not have been sent. It will NOT be retried automatically.`,
        payload: { executionId: execution.id, candidates: outcome.value.candidates },
      });
      log.error({ executionId: execution.id }, 'crash window: UNCERTAIN, never resent');
      continue;
    }
    counts.neverSent += 1;
    log.warn({ executionId: execution.id }, 'crash window: the send never happened');
  }
  return counts;
}

type ExecutionContext = { agent: Address; treasury: Address; token: Address };

async function executionContext(db: Db, walletId: string): Promise<ExecutionContext | null> {
  const wallet = await getWalletById(db, walletId);
  if (!wallet?.agentWalletAddress) return null;
  const active = await getActivePolicy(db, walletId);
  if (!active) return null;
  const parsed = zPolicy.safeParse(active.body);
  if (!parsed.success) return null;
  const usdc = parsed.data.tokens.find((t) => t.symbol === 'USDC');
  if (!usdc) return null;
  return {
    agent: getAddress(wallet.agentWalletAddress),
    treasury: getAddress(parsed.data.treasuryAddress),
    token: getAddress(usdc.address),
  };
}

async function expectedDeltasOf(
  db: Db,
  decisionId: string,
): Promise<{ token: string; holder: string; delta: string }[]> {
  const decision = await getAgentDecision(db, decisionId);
  const parsed = zProposal.safeParse(decision?.proposal);
  if (!parsed.success) return [];
  return parsed.data.expectedDeltas.map((d) => ({
    token: d.token,
    holder: d.holder,
    delta: d.delta.toString(),
  }));
}

/** I4: the recipient address comes from the active Policy by id, never from the proposal. */
async function recipientOf(db: Db, decisionId: string): Promise<Address | undefined> {
  const decision = await getAgentDecision(db, decisionId);
  if (!decision) return undefined;
  const parsed = zProposal.safeParse(decision.proposal);
  if (!parsed.success) return undefined;
  const proposal = parsed.data;
  if (proposal.kind !== 'pay_recipient') return undefined;
  const active = await getActivePolicy(db, decision.walletId);
  const policy = active ? zPolicy.safeParse(active.body) : undefined;
  if (!policy?.success) return undefined;
  const r = policy.data.recipients.find((x) => x.id === proposal.params.recipientId);
  return r ? getAddress(r.address) : undefined;
}

async function notifyOwner(
  db: Db,
  walletId: string,
  n: {
    type: 'execution' | 'escalation' | 'blocked' | 'risk' | 'freeze' | 'report';
    title: string;
    body: string;
    payload?: unknown;
  },
): Promise<void> {
  const userId = await getUserIdForWallet(db, walletId);
  if (!userId) return;
  await insertNotification(db, { userId, walletId, ...n });
}

/**
 * The same day next month, clamped to 28 so a monthly schedule never skips February
 * (POLICY_ENGINE caps `schedule.dayOfMonth` at 28 for the same reason).
 */
export function addOneMonth(dueDate: string): string {
  const [y, m, d] = dueDate.split('-').map(Number) as [number, number, number];
  const month = m === 12 ? 1 : m + 1;
  const year = m === 12 ? y + 1 : y;
  const day = Math.min(d, 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export { DAY_MS };
