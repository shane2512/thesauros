// Phase 6 repositories: the tables the decision loop, the scheduler and the approval flow read and
// write. Thin and typed, like `executions.ts` — every decision about *whether* something may happen
// lives in the Policy Engine or the loop, never here.
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { appendAudit } from './audit';
import type { Db } from './client';
import {
  agentDecisions,
  approvals,
  auditLog,
  mandates,
  notifications,
  obligations,
  policies,
  recipients,
  simulations,
  vaults,
  verdicts,
  wallets,
} from './schema';

export type AgentDecisionRow = typeof agentDecisions.$inferSelect;
export type VerdictRow = typeof verdicts.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type ObligationRow = typeof obligations.$inferSelect;
export type RecipientRow = typeof recipients.$inferSelect;
export type VaultRow = typeof vaults.$inferSelect;
export type SimulationRow = typeof simulations.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;

// ── wallets ──────────────────────────────────────────────────────────────────────────────────────

/** Every wallet the scheduler should tick: provisioned, not frozen, with an active policy. */
export async function listActiveWalletIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: wallets.id })
    .from(wallets)
    .innerJoin(policies, and(eq(policies.walletId, wallets.id), eq(policies.status, 'active')))
    .where(and(eq(wallets.frozen, false), eq(wallets.breakerOpen, false)));
  return rows.map((r) => r.id);
}

// ── recipients / vaults / obligations ────────────────────────────────────────────────────────────

export async function listRecipients(db: Db, walletId: string): Promise<RecipientRow[]> {
  return db
    .select()
    .from(recipients)
    .where(and(eq(recipients.walletId, walletId), eq(recipients.status, 'active')))
    .orderBy(asc(recipients.createdAt));
}

export async function listVaultRows(db: Db, walletId: string): Promise<VaultRow[]> {
  return db.select().from(vaults).where(eq(vaults.walletId, walletId));
}

/** Flag / unflag a vault after a risk trigger (R04 refuses deposits into a flagged vault). */
export async function setVaultFlagged(
  db: Db,
  walletId: string,
  vaultId: string,
  flagged: boolean,
  reason: string | null,
): Promise<void> {
  await db
    .update(vaults)
    .set({ flagged, flaggedReason: reason })
    .where(and(eq(vaults.walletId, walletId), eq(vaults.id, vaultId)));
}

/** Scheduled obligations due on or before `onOrBefore` (an ISO date, `YYYY-MM-DD`). */
export async function listObligationsDue(
  db: Db,
  walletId: string,
  onOrBefore: string,
): Promise<ObligationRow[]> {
  return db
    .select()
    .from(obligations)
    .where(
      and(
        eq(obligations.walletId, walletId),
        eq(obligations.status, 'scheduled'),
        lte(obligations.dueDate, onOrBefore),
      ),
    )
    .orderBy(asc(obligations.dueDate));
}

/** Scheduled obligations inside the planning horizon — `F_OBLIGATIONS_30D` and the runway reserve. */
export async function listObligationsUntil(
  db: Db,
  walletId: string,
  until: string,
): Promise<ObligationRow[]> {
  return db
    .select()
    .from(obligations)
    .where(
      and(
        eq(obligations.walletId, walletId),
        eq(obligations.status, 'scheduled'),
        lte(obligations.dueDate, until),
      ),
    )
    .orderBy(asc(obligations.dueDate));
}

/**
 * Create the next monthly occurrence of an obligation, once (6.5).
 *
 * Idempotent by construction: it inserts only when no row already exists for the same
 * (wallet, recipient, due date). Returns the new row id, or `null` if one was already there.
 */
export async function ensureNextOccurrence(
  db: Db,
  source: Pick<ObligationRow, 'walletId' | 'recipientId' | 'amount' | 'recurrence'>,
  nextDueDate: string,
): Promise<string | null> {
  const existing = (
    await db
      .select({ id: obligations.id })
      .from(obligations)
      .where(
        and(
          eq(obligations.walletId, source.walletId),
          eq(obligations.recipientId, source.recipientId),
          eq(obligations.dueDate, nextDueDate),
        ),
      )
      .limit(1)
  )[0];
  if (existing) return null;
  const [row] = await db
    .insert(obligations)
    .values({
      walletId: source.walletId,
      recipientId: source.recipientId,
      amount: source.amount,
      dueDate: nextDueDate,
      recurrence: source.recurrence,
      status: 'scheduled',
    })
    .returning({ id: obligations.id });
  return row?.id ?? null;
}

// ── decisions / verdicts / simulations ───────────────────────────────────────────────────────────

export async function insertAgentDecision(
  db: Db,
  row: {
    walletId: string;
    trigger: string;
    contextSnapshot: unknown;
    contextHash: string;
    screen?: unknown;
    proposal?: unknown;
    proposalHash?: string | null;
    proposalSource: string;
    verifier?: unknown;
    servMeta?: unknown;
    status: string;
  },
): Promise<AgentDecisionRow> {
  const [inserted] = await db.insert(agentDecisions).values(row).returning();
  if (!inserted) throw new Error('insertAgentDecision: no row returned');
  return inserted;
}

export async function updateAgentDecision(
  db: Db,
  id: string,
  patch: Partial<
    Pick<
      AgentDecisionRow,
      'screen' | 'proposal' | 'proposalHash' | 'proposalSource' | 'verifier' | 'servMeta' | 'status'
    >
  >,
): Promise<void> {
  await db.update(agentDecisions).set(patch).where(eq(agentDecisions.id, id));
}

export async function getAgentDecision(db: Db, id: string): Promise<AgentDecisionRow | undefined> {
  return (await db.select().from(agentDecisions).where(eq(agentDecisions.id, id)).limit(1))[0];
}

/** Timeline page (GET /api/decisions). `before` is a created_at cursor. */
export async function listAgentDecisions(
  db: Db,
  walletId: string,
  opts: { limit?: number; before?: Date } = {},
): Promise<AgentDecisionRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const where =
    opts.before === undefined
      ? eq(agentDecisions.walletId, walletId)
      : and(eq(agentDecisions.walletId, walletId), lt(agentDecisions.createdAt, opts.before));
  return db
    .select()
    .from(agentDecisions)
    .where(where)
    .orderBy(desc(agentDecisions.createdAt))
    .limit(limit);
}

export async function insertVerdict(
  db: Db,
  row: {
    decisionId: string;
    decision: 'ALLOW' | 'ESCALATE' | 'DENY';
    results: unknown;
    policyVersion: number;
  },
): Promise<VerdictRow> {
  const [inserted] = await db.insert(verdicts).values(row).returning();
  if (!inserted) throw new Error('insertVerdict: no row returned');
  return inserted;
}

export async function getVerdictForDecision(
  db: Db,
  decisionId: string,
): Promise<VerdictRow | undefined> {
  return (
    await db
      .select()
      .from(verdicts)
      .where(eq(verdicts.decisionId, decisionId))
      .orderBy(desc(verdicts.evaluatedAt))
      .limit(1)
  )[0];
}

export async function getSimulationForDecision(
  db: Db,
  decisionId: string,
): Promise<SimulationRow | undefined> {
  return (
    await db
      .select()
      .from(simulations)
      .where(eq(simulations.decisionId, decisionId))
      .orderBy(desc(simulations.createdAt))
      .limit(1)
  )[0];
}

/** The policy body of a specific version — what NFR-4 replay needs, not merely the active one. */
export async function getPolicyVersion(
  db: Db,
  walletId: string,
  version: number,
): Promise<{ version: number; body: unknown } | undefined> {
  return (
    await db
      .select({ version: policies.version, body: policies.body })
      .from(policies)
      .where(and(eq(policies.walletId, walletId), eq(policies.version, version)))
      .limit(1)
  )[0];
}

// ── approvals ────────────────────────────────────────────────────────────────────────────────────

export async function insertApproval(
  db: Db,
  row: {
    decisionId: string;
    walletId: string;
    proposalHash: string;
    message: string;
    expiresAt: Date;
  },
): Promise<ApprovalRow> {
  const [inserted] = await db.insert(approvals).values(row).returning();
  if (!inserted) throw new Error('insertApproval: no row returned');
  return inserted;
}

export async function getApproval(db: Db, id: string): Promise<ApprovalRow | undefined> {
  return (await db.select().from(approvals).where(eq(approvals.id, id)).limit(1))[0];
}

export async function listApprovals(
  db: Db,
  walletId: string,
  status?: ApprovalRow['status'],
): Promise<ApprovalRow[]> {
  const base = eq(approvals.walletId, walletId);
  return db
    .select()
    .from(approvals)
    .where(status === undefined ? base : and(base, eq(approvals.status, status)))
    .orderBy(desc(approvals.expiresAt));
}

/**
 * Move a pending approval to a decided state, atomically.
 *
 * The `status = 'pending'` predicate is the replay guard: a second approve (or an approve racing a
 * reject, an expiry or a policy-change cancellation) updates zero rows and gets `undefined` back.
 */
export async function decideApproval(
  db: Db,
  id: string,
  status: 'approved' | 'rejected' | 'expired' | 'cancelled',
  at: Date,
  signature?: string,
): Promise<ApprovalRow | undefined> {
  const [row] = await db
    .update(approvals)
    .set({ status, decidedAt: at, ...(signature === undefined ? {} : { signature }) })
    .where(and(eq(approvals.id, id), eq(approvals.status, 'pending')))
    .returning();
  return row;
}

/** `approvals.expire` (6.5): every pending approval whose 24 h window has closed. */
export async function expirePendingApprovals(db: Db, now: Date): Promise<ApprovalRow[]> {
  return db
    .update(approvals)
    .set({ status: 'expired', decidedAt: now })
    .where(and(eq(approvals.status, 'pending'), lt(approvals.expiresAt, now)))
    .returning();
}

/**
 * Cancel every pending approval for a wallet (6.4: a new policy version invalidates them, since an
 * owner signature is bound to `Policy: v{n}`; also used by the freeze path, SECURITY §4).
 */
export async function cancelPendingApprovals(
  db: Db,
  walletId: string,
  now: Date,
): Promise<ApprovalRow[]> {
  return db
    .update(approvals)
    .set({ status: 'cancelled', decidedAt: now })
    .where(and(eq(approvals.walletId, walletId), eq(approvals.status, 'pending')))
    .returning();
}

/**
 * A new policy version invalidates every pending approval (6.4).
 *
 * Owner approvals are bound to `Policy: v{n}` (SECURITY §5), so one signed under the old version can
 * never be redeemed anyway — `executeApproval` refuses a stale message outright. Cancelling is what
 * makes that visible to the owner instead of leaving dead cards in the queue.
 *
 * Lives here rather than in the worker so that BOTH callers — the worker and the web's
 * `/api/policy/activate` — use one implementation (the web app may not import the worker).
 */
export async function cancelApprovalsForPolicyChange(
  db: Db,
  walletId: string,
  newVersion: number,
  now: Date,
): Promise<ApprovalRow[]> {
  const cancelled = await cancelPendingApprovals(db, walletId, now);
  for (const row of cancelled) {
    await appendAudit(db, {
      walletId,
      actor: 'system',
      event: 'APPROVAL_CANCELLED',
      entityType: 'approval',
      entityId: row.id,
      payload: { reason: 'policy version changed', newVersion, proposalHash: row.proposalHash },
      createdAt: now,
    });
  }
  return cancelled;
}

// ── policies (owner-signed; task 7.6) ────────────────────────────────────────────────────────────

/** Highest version this wallet has ever had, active or superseded. 0 when it has none. */
export async function latestPolicyVersion(db: Db, walletId: string): Promise<number> {
  const row = (
    await db
      .select({ version: policies.version })
      .from(policies)
      .where(eq(policies.walletId, walletId))
      .orderBy(desc(policies.version))
      .limit(1)
  )[0];
  return row?.version ?? 0;
}

/**
 * Make an owner-signed policy version the active one, atomically.
 *
 * The old active row is superseded and the new one inserted in a single transaction, so the partial
 * unique index (`one active per wallet`) can never see two. A concurrent activation of the same
 * version loses on the primary key, which is the replay guard: the same signature cannot activate
 * twice.
 */
export async function activatePolicyVersion(
  db: Db,
  input: {
    walletId: string;
    version: number;
    mandateId: string | null;
    body: unknown;
    bodyHash: string;
    signature: string;
    now: Date;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(policies)
      .set({ status: 'superseded' })
      .where(and(eq(policies.walletId, input.walletId), eq(policies.status, 'active')));
    await tx.insert(policies).values({
      walletId: input.walletId,
      version: input.version,
      mandateId: input.mandateId,
      body: input.body,
      bodyHash: input.bodyHash,
      signature: input.signature,
      status: 'active',
      activatedAt: input.now,
    });
    await tx
      .update(wallets)
      .set({ activePolicyVersion: input.version })
      .where(eq(wallets.id, input.walletId));
  });
}

// ── recipients (owner-signed additions only; T3) ─────────────────────────────────────────────────

/**
 * Add an allowlist entry. The unique index on `(wallet_id, address)` is the duplicate guard, so a
 * replayed request inserts nothing rather than creating a second row for the same address.
 */
export async function insertRecipient(
  db: Db,
  row: {
    walletId: string;
    label: string;
    address: string;
    maxPerTx: bigint;
    schedule: unknown;
    addedSignature: string;
  },
): Promise<RecipientRow | undefined> {
  const [inserted] = await db.insert(recipients).values(row).onConflictDoNothing().returning();
  return inserted;
}

// ── notifications ────────────────────────────────────────────────────────────────────────────────

/**
 * Newest-first, keyset-paginated on `(createdAt, id)` — `id` is a random UUID (not sortable on its
 * own), so `createdAt` is the real order and `id` only breaks ties within the same millisecond.
 * `beforeId` names a row from a previous page; its own `(createdAt, id)` becomes the cursor.
 */
export async function listNotifications(
  db: Db,
  userId: string,
  opts: { limit?: number; beforeId?: string } = {},
): Promise<NotificationRow[]> {
  const limit = opts.limit ?? 50;
  const conds = [eq(notifications.userId, userId)];
  if (opts.beforeId !== undefined) {
    const [cursor] = await db
      .select({ createdAt: notifications.createdAt, id: notifications.id })
      .from(notifications)
      .where(eq(notifications.id, opts.beforeId))
      .limit(1);
    if (cursor)
      conds.push(
        sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.createdAt}, ${cursor.id})`,
      );
  }
  return db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit);
}

/** Newest notification of one kind for this owner — 8.6 uses this to serve the last weekly report. */
export async function latestNotificationOfType(
  db: Db,
  userId: string,
  type: NotificationRow['type'],
): Promise<NotificationRow | undefined> {
  return (
    await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.type, type)))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(1)
  )[0];
}

export async function unreadNotificationCount(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return rows.length;
}

/** Returns the updated row, or `undefined` if it does not exist or belongs to another user. */
export async function markNotificationRead(
  db: Db,
  userId: string,
  id: string,
  now: Date,
): Promise<NotificationRow | undefined> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning();
  return row;
}

export async function markAllNotificationsRead(db: Db, userId: string, now: Date): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

// ── ledger windows ───────────────────────────────────────────────────────────────────────────────

/** Proposal hashes seen in the rolling window, including ones that never reached the chain (R17). */
export async function recentDecisionProposalHashes(
  db: Db,
  walletId: string,
  since: Date,
): Promise<string[]> {
  const rows = await db
    .select({ proposalHash: agentDecisions.proposalHash })
    .from(agentDecisions)
    .where(and(eq(agentDecisions.walletId, walletId), gte(agentDecisions.createdAt, since)))
    .orderBy(desc(agentDecisions.createdAt));
  return rows.map((r) => r.proposalHash).filter((h): h is string => h !== null);
}

/** Decisions that are waiting on a human (used to avoid proposing the same thing again). */
export async function pendingApprovalHashes(db: Db, walletId: string): Promise<string[]> {
  const rows = await db
    .select({ proposalHash: approvals.proposalHash })
    .from(approvals)
    .where(and(eq(approvals.walletId, walletId), eq(approvals.status, 'pending')))
    .orderBy(desc(approvals.expiresAt));
  return rows.map((r) => r.proposalHash);
}

/** DENY verdicts for this wallet's decisions in `[start, end)` — task 8.6's "blocked events". */
export async function deniedVerdictCountSince(
  db: Db,
  walletId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const rows = await db
    .select({ id: verdicts.id })
    .from(verdicts)
    .innerJoin(agentDecisions, eq(verdicts.decisionId, agentDecisions.id))
    .where(
      and(
        eq(agentDecisions.walletId, walletId),
        eq(verdicts.decision, 'DENY'),
        gte(agentDecisions.createdAt, start),
        lt(agentDecisions.createdAt, end),
      ),
    );
  return rows.length;
}

/** Set `wallets.frozen`, for the breaker and the owner path. */
export async function setWalletFrozen(
  db: Db,
  walletId: string,
  frozen: boolean,
  reason: string | null,
  now: Date,
): Promise<void> {
  await db
    .update(wallets)
    .set(
      frozen
        ? { frozen: true, frozenAt: now, frozenReason: reason }
        : {
            frozen: false,
            frozenAt: null,
            frozenReason: null,
            breakerOpen: false,
            breakerFailures: 0,
          },
    )
    .where(eq(wallets.id, walletId));
}

// ---- Phase 7 read models (web UI). Read-only except `insertMandate`, which stores the owner's own
// mandate text and its compiled DRAFT (a draft grants nothing until the owner signs it: Phase 7.6).

export type MandateRow = typeof mandates.$inferSelect;

export async function insertMandate(
  db: Db,
  row: {
    walletId: string;
    text: string;
    template: MandateRow['template'];
    compiledDraft: unknown;
    assumptions: unknown;
    questions: unknown;
  },
): Promise<MandateRow> {
  const [r] = await db.insert(mandates).values(row).returning();
  if (!r) throw new Error('insertMandate: no row returned');
  return r;
}

export async function getLatestMandate(db: Db, walletId: string): Promise<MandateRow | undefined> {
  return (
    await db
      .select()
      .from(mandates)
      .where(eq(mandates.walletId, walletId))
      .orderBy(desc(mandates.createdAt))
      .limit(1)
  )[0];
}

/** Newest audit row written by the agent loop for this wallet: the "is the worker alive" signal. */
export async function latestAgentAudit(
  db: Db,
  walletId: string,
): Promise<{ event: string; payload: unknown; createdAt: Date } | undefined> {
  return (
    await db
      .select({
        event: auditLog.event,
        payload: auditLog.payload,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(and(eq(auditLog.walletId, walletId), eq(auditLog.actor, 'agent')))
      .orderBy(desc(auditLog.id))
      .limit(1)
  )[0];
}

/** How many decisions the Policy Engine has DENIED for this wallet (the "attacks blocked" widget). */
export async function countDeniedVerdicts(
  db: Db,
  walletId: string,
): Promise<{ count: number; lastAt: Date | null }> {
  const rows = await db
    .select({ at: verdicts.evaluatedAt })
    .from(verdicts)
    .innerJoin(agentDecisions, eq(agentDecisions.id, verdicts.decisionId))
    .where(and(eq(agentDecisions.walletId, walletId), eq(verdicts.decision, 'DENY')))
    .orderBy(desc(verdicts.evaluatedAt));
  return { count: rows.length, lastAt: rows[0]?.at ?? null };
}

export async function getActivePolicyBody(
  db: Db,
  walletId: string,
): Promise<{ version: number; body: unknown } | undefined> {
  const row = (
    await db
      .select({ version: policies.version, body: policies.body })
      .from(policies)
      .where(and(eq(policies.walletId, walletId), eq(policies.status, 'active')))
      .limit(1)
  )[0];
  return row;
}
