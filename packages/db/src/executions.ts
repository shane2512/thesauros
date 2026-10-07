// Phase 5 repositories: the tables the executor and confirmer touch. Thin on purpose — all the
// policy lives in `packages/wallet/src/executor.ts`; what lives HERE is the atomicity that only the
// database can provide (I10): the single-use receipt nonce and the one-execution-per-proposal-hash
// unique index, claimed together in one transaction.
import { and, asc, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { getEnv, err, ok, type Result } from '@thesauros/shared';
import type { Db } from './client';
import {
  executions,
  ledgerEntries,
  notifications,
  obligations,
  policies,
  priceSnapshots,
  receiptNonces,
  simulations,
  users,
  vaultSnapshots,
  wallets,
} from './schema';
import { sendTelegramMessage } from './telegram';

export type ExecutionRow = typeof executions.$inferSelect;
export type ExecutionStatus = ExecutionRow['status'];
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
export type VaultSnapshotRow = typeof vaultSnapshots.$inferSelect;

/** Statuses that still need the confirmer to look at them (crash recovery, Phase 6.6). */
export const UNRESOLVED_STATUSES = ['pending', 'submitted'] as const;

export type ClaimError =
  { code: 'NONCE_REPLAYED'; message: string } | { code: 'WRITE_FAILED'; message: string };

export type ClaimResult = {
  execution: ExecutionRow;
  /** False when an execution for this proposal hash already existed (idempotent replay, I10). */
  created: boolean;
};

/**
 * Atomically burn the receipt nonce and claim the execution row for `(walletId, proposalHash)`.
 *
 * Three outcomes:
 *  - fresh nonce, no execution yet ⇒ a new `pending` row, `created: true`;
 *  - nonce already burned **and** an execution exists for the same proposal hash ⇒ that row,
 *    `created: false`. This is the legitimate retry/duplicate-call case (I10) — the caller must
 *    not send again;
 *  - nonce already burned and **no** matching execution ⇒ `NONCE_REPLAYED`. Somebody is reusing a
 *    receipt for something else; refuse (I5).
 *
 * The row is inserted with status `pending` BEFORE anything is broadcast, so a crash between the
 * send and the status update still leaves an intent row to reconcile against (see
 * `listUnresolvedExecutions`).
 */
export async function claimExecutionSlot(
  db: Db,
  args: {
    nonce: string;
    issuedAt: Date;
    usedAt: Date;
    walletId: string;
    decisionId: string;
    proposalHash: string;
    kind: string;
    callsHash: string;
  },
): Promise<Result<ClaimResult, ClaimError>> {
  try {
    return await db.transaction(async (tx) => {
      const nonceRows = await tx
        .insert(receiptNonces)
        .values({
          nonce: args.nonce,
          walletId: args.walletId,
          proposalHash: args.proposalHash,
          issuedAt: args.issuedAt,
          usedAt: args.usedAt,
        })
        .onConflictDoNothing({ target: receiptNonces.nonce })
        .returning();

      const existing = (
        await tx
          .select()
          .from(executions)
          .where(
            and(
              eq(executions.walletId, args.walletId),
              eq(executions.proposalHash, args.proposalHash),
            ),
          )
          .limit(1)
      )[0];

      if (nonceRows.length === 0) {
        // Nonce already used. Only a genuine duplicate of the same execution is acceptable.
        if (existing) return ok({ execution: existing, created: false });
        return err<ClaimError>({
          code: 'NONCE_REPLAYED',
          message: `receipt nonce ${args.nonce} has already been used for another proposal`,
        });
      }

      if (existing) return ok({ execution: existing, created: false });

      const [inserted] = await tx
        .insert(executions)
        .values({
          walletId: args.walletId,
          decisionId: args.decisionId,
          proposalHash: args.proposalHash,
          kind: args.kind,
          callsHash: args.callsHash,
          status: 'pending',
        })
        .onConflictDoNothing({
          target: [executions.walletId, executions.proposalHash],
        })
        .returning();

      if (inserted) return ok({ execution: inserted, created: true });

      // Lost the race to a concurrent transaction: read the winner's row.
      const winner = (
        await tx
          .select()
          .from(executions)
          .where(
            and(
              eq(executions.walletId, args.walletId),
              eq(executions.proposalHash, args.proposalHash),
            ),
          )
          .limit(1)
      )[0];
      if (!winner)
        return err<ClaimError>({
          code: 'WRITE_FAILED',
          message: 'execution row vanished after a conflict',
        });
      return ok({ execution: winner, created: false });
    });
  } catch (e) {
    return err({ code: 'WRITE_FAILED', message: String(e) });
  }
}

export async function getExecutionById(db: Db, id: string): Promise<ExecutionRow | undefined> {
  return (await db.select().from(executions).where(eq(executions.id, id)).limit(1))[0];
}

/** The wallet's most recent execution of any kind. */
export async function latestExecutionForWallet(
  db: Db,
  walletId: string,
): Promise<ExecutionRow | undefined> {
  return (
    await db
      .select()
      .from(executions)
      .where(eq(executions.walletId, walletId))
      .orderBy(desc(executions.createdAt))
      .limit(1)
  )[0];
}

/** The execution a decision produced, if it was ever sent (one per decision). */
export async function getExecutionForDecision(
  db: Db,
  decisionId: string,
): Promise<ExecutionRow | undefined> {
  return (
    await db
      .select()
      .from(executions)
      .where(eq(executions.decisionId, decisionId))
      .orderBy(desc(executions.createdAt))
      .limit(1)
  )[0];
}

/** Patch an execution row. Status transitions themselves are policed in the executor/confirmer. */
export async function updateExecution(
  db: Db,
  id: string,
  patch: Partial<
    Pick<ExecutionRow, 'status' | 'userOpHash' | 'txHash' | 'gasUsed' | 'error' | 'confirmedAt'>
  >,
): Promise<ExecutionRow | undefined> {
  const [row] = await db.update(executions).set(patch).where(eq(executions.id, id)).returning();
  return row;
}

/**
 * Executions that are still `pending` or `submitted`. On boot these are the crash window: an intent
 * row may exist for a transaction that actually landed. Phase 6.6 hands each to the confirmer.
 */
export async function listUnresolvedExecutions(db: Db, walletId?: string): Promise<ExecutionRow[]> {
  const unresolved = inArray(executions.status, [...UNRESOLVED_STATUSES]);
  return db
    .select()
    .from(executions)
    .where(walletId === undefined ? unresolved : and(eq(executions.walletId, walletId), unresolved))
    .orderBy(asc(executions.createdAt));
}

/**
 * The newest execution of one proposal kind. The freeze flow reads `sweep_home` with it, so a
 * reopened modal resumes from what the SERVER recorded rather than from component state (7.8).
 */
export async function latestExecutionOfKind(
  db: Db,
  walletId: string,
  kind: string,
): Promise<ExecutionRow | undefined> {
  return (
    await db
      .select()
      .from(executions)
      .where(and(eq(executions.walletId, walletId), eq(executions.kind, kind)))
      .orderBy(desc(executions.createdAt))
      .limit(1)
  )[0];
}

export async function getWalletById(db: Db, id: string) {
  return (await db.select().from(wallets).where(eq(wallets.id, id)).limit(1))[0];
}

/** Circuit breaker (5.7). Returns the new consecutive-failure count. */
export async function bumpBreakerFailures(db: Db, walletId: string): Promise<number> {
  const [row] = await db
    .update(wallets)
    .set({ breakerFailures: sql`${wallets.breakerFailures} + 1` })
    .where(eq(wallets.id, walletId))
    .returning({ breakerFailures: wallets.breakerFailures });
  return row?.breakerFailures ?? 0;
}

export async function resetBreakerFailures(db: Db, walletId: string): Promise<void> {
  await db.update(wallets).set({ breakerFailures: 0 }).where(eq(wallets.id, walletId));
}

/** Open the breaker and freeze (5.7). Idempotent. */
export async function openBreaker(
  db: Db,
  walletId: string,
  reason: string,
  now: Date,
): Promise<void> {
  await db
    .update(wallets)
    .set({ breakerOpen: true, frozen: true, frozenAt: now, frozenReason: reason })
    .where(eq(wallets.id, walletId));
}

export async function insertLedgerEntry(
  db: Db,
  row: {
    walletId: string;
    executionId: string;
    token: string;
    amount: bigint;
    direction: 'in' | 'out';
    counterpartyLabel?: string | null;
    usdMicro: bigint;
  },
): Promise<LedgerEntryRow | undefined> {
  const [inserted] = await db.insert(ledgerEntries).values(row).returning();
  return inserted;
}

/**
 * 8.4 — one page of the ledger for `/api/export`, oldest first, cursor by `createdAt` so a big
 * export can be resumed. Read-only.
 */
export async function listLedgerPage(
  db: Db,
  walletId: string,
  opts: { limit: number; after?: Date },
): Promise<LedgerEntryRow[]> {
  const conds = [eq(ledgerEntries.walletId, walletId)];
  if (opts.after !== undefined) conds.push(gt(ledgerEntries.createdAt, opts.after));
  return db
    .select()
    .from(ledgerEntries)
    .where(and(...conds))
    .orderBy(asc(ledgerEntries.createdAt))
    .limit(opts.limit);
}

/** Rolling-window outflows for R07. Same window the rule assumes (24h). */
export async function outflowsSince(db: Db, walletId: string, since: Date): Promise<bigint> {
  const rows = await db
    .select({ usdMicro: ledgerEntries.usdMicro })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.walletId, walletId),
        eq(ledgerEntries.direction, 'out'),
        gte(ledgerEntries.createdAt, since),
      ),
    );
  return rows.reduce((sum, r) => sum + r.usdMicro, 0n);
}

/** 8.6: confirmed `pay_recipient` money out in `[start, end)` — ledger entries with a counterparty
 * label are exactly the ones a recipient payment writes (vault moves and sweeps never set one). */
export async function paymentsSummarySince(
  db: Db,
  walletId: string,
  start: Date,
  end: Date,
): Promise<{ count: number; totalMicroUsd: bigint }> {
  const rows = await db
    .select({ usdMicro: ledgerEntries.usdMicro })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.walletId, walletId),
        eq(ledgerEntries.direction, 'out'),
        sql`${ledgerEntries.counterpartyLabel} is not null`,
        gte(ledgerEntries.createdAt, start),
        sql`${ledgerEntries.createdAt} < ${end}`,
      ),
    );
  return { count: rows.length, totalMicroUsd: rows.reduce((sum, r) => sum + r.usdMicro, 0n) };
}

/** The most recent vault snapshot at or before `at` — a window boundary for the weekly report (8.6). */
export async function vaultSnapshotAsOf(
  db: Db,
  walletId: string,
  vaultId: string,
  at: Date,
): Promise<VaultSnapshotRow | undefined> {
  return (
    await db
      .select()
      .from(vaultSnapshots)
      .where(
        and(
          eq(vaultSnapshots.walletId, walletId),
          eq(vaultSnapshots.vaultId, vaultId),
          sql`${vaultSnapshots.createdAt} <= ${at}`,
        ),
      )
      .orderBy(desc(vaultSnapshots.id))
      .limit(1)
  )[0];
}

export async function insertSimulation(
  db: Db,
  row: {
    decisionId: string;
    calls: unknown;
    callsHash: string;
    ok: boolean;
    deltas: unknown;
    error?: string | null;
    blockNumber?: bigint | null;
  },
): Promise<void> {
  await db.insert(simulations).values(row);
}

export async function insertPriceSnapshot(
  db: Db,
  row: { token: string; microUsd: bigint; publishedAt: Date; source: string },
): Promise<void> {
  await db.insert(priceSnapshots).values(row);
}

export async function insertVaultSnapshot(
  db: Db,
  row: {
    walletId: string;
    vaultId: string;
    sharePrice: bigint;
    totalAssets: bigint;
    positionAssets: bigint;
  },
): Promise<void> {
  await db.insert(vaultSnapshots).values(row);
}

/** The previous snapshot per vault, for `detectRiskTriggers`. */
export async function latestVaultSnapshot(
  db: Db,
  walletId: string,
  vaultId: string,
): Promise<VaultSnapshotRow | undefined> {
  return (
    await db
      .select()
      .from(vaultSnapshots)
      .where(and(eq(vaultSnapshots.walletId, walletId), eq(vaultSnapshots.vaultId, vaultId)))
      .orderBy(desc(vaultSnapshots.id))
      .limit(1)
  )[0];
}

export async function insertNotification(
  db: Db,
  row: {
    userId: string;
    walletId?: string | null;
    type: 'execution' | 'escalation' | 'blocked' | 'risk' | 'freeze' | 'report';
    title: string;
    body: string;
    payload?: unknown;
  },
): Promise<void> {
  await db.insert(notifications).values(row);

  // Telegram (8.5, FR-22 should-have): best-effort, never blocks or fails the caller. `getEnv()` is
  // the same cached, process-wide parse every other module uses (D-106) — no deps threading needed
  // just to reach an optional env var. Off unless BOTH the bot token and a linked chat id exist.
  // A process whose env is not fully valid (e.g. a `packages/db` unit test that never calls
  // `getEnv()` itself) is treated the same as "not configured" — Telegram is the one thing here
  // allowed to no-op on a bad env, since the write above already succeeded.
  let env;
  try {
    env = getEnv();
  } catch {
    return;
  }
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const [u] = await db
    .select({ telegramChatId: users.telegramChatId })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  if (!u?.telegramChatId) return;
  // Awaited (not void): sendTelegramMessage never throws (own try/catch), so this adds latency but
  // never risk — and awaiting keeps the send deterministic for tests and for callers that log after.
  await sendTelegramMessage(env, u.telegramChatId, `${row.title}\n${row.body}`);
}

export async function setObligationStatus(
  db: Db,
  id: string,
  status: 'scheduled' | 'paid' | 'failed' | 'cancelled',
  paidExecutionId?: string | null,
): Promise<void> {
  await db
    .update(obligations)
    .set({ status, ...(paidExecutionId === undefined ? {} : { paidExecutionId }) })
    .where(eq(obligations.id, id));
}

/** The owner of a wallet, for notification rows. */
export async function getUserIdForWallet(db: Db, walletId: string): Promise<string | undefined> {
  return (
    await db
      .select({ userId: wallets.userId })
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .limit(1)
  )[0]?.userId;
}

/** R14's input: executions attempted by this wallet in the rolling window. */
export async function countExecutionsSince(db: Db, walletId: string, since: Date): Promise<number> {
  const rows = await db
    .select({ id: executions.id })
    .from(executions)
    .where(and(eq(executions.walletId, walletId), gte(executions.createdAt, since)));
  return rows.length;
}

/** R17's input: proposal hashes this wallet already executed in the rolling window. */
export async function recentProposalHashes(
  db: Db,
  walletId: string,
  since: Date,
): Promise<string[]> {
  const rows = await db
    .select({ proposalHash: executions.proposalHash })
    .from(executions)
    .where(and(eq(executions.walletId, walletId), gte(executions.createdAt, since)));
  return rows.map((r) => r.proposalHash);
}

/** The wallet's active policy body (one per wallet, partial unique index). */
export async function getActivePolicy(
  db: Db,
  walletId: string,
): Promise<{ version: number; body: unknown } | undefined> {
  return (
    await db
      .select({ version: policies.version, body: policies.body })
      .from(policies)
      .where(and(eq(policies.walletId, walletId), eq(policies.status, 'active')))
      .limit(1)
  )[0];
}
