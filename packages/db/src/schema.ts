// Drizzle schema for ALL tables in docs/DATA_MODEL.md. Money columns are numeric(78,0) <-> bigint (I12).
// UUIDs are gen_random_uuid() (v4; Postgres 16 has no native v7) — ordering uses created_at.
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** numeric(78,0) as bigint. */
const money = customType<{ data: bigint; driverData: string }>({
  dataType: () => 'numeric(78,0)',
  toDriver: (v) => v.toString(),
  fromDriver: (v) => BigInt(v),
});
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const id = () => uuid('id').primaryKey().defaultRandom();

export const policyStatus = pgEnum('policy_status', ['draft', 'active', 'superseded']);
export const recipientStatus = pgEnum('recipient_status', ['active', 'removed']);
export const spendPermissionStatus = pgEnum('spend_permission_status', [
  'pending',
  'approved_onchain',
  'revoked',
  'expired',
]);
export const recurrence = pgEnum('recurrence', ['none', 'monthly']);
export const obligationStatus = pgEnum('obligation_status', [
  'scheduled',
  'paid',
  'failed',
  'cancelled',
]);
export const verdictDecision = pgEnum('verdict_decision', ['ALLOW', 'ESCALATE', 'DENY']);
export const approvalStatus = pgEnum('approval_status', [
  'pending',
  'approved',
  'rejected',
  'expired',
  'cancelled',
]);
export const executionStatus = pgEnum('execution_status', [
  'pending',
  'submitted',
  'confirmed',
  'failed',
  'timeout',
  'cancelled',
]);
export const ledgerDirection = pgEnum('ledger_direction', ['in', 'out']);
export const notificationType = pgEnum('notification_type', [
  'execution',
  'escalation',
  'blocked',
  'risk',
  'freeze',
  'report',
]);
export const notificationChannel = pgEnum('notification_channel', ['inapp', 'telegram']);
export const mandateTemplate = pgEnum('mandate_template', ['startup', 'dao', 'creator', 'custom']);

export const users = pgTable('users', {
  id: id(),
  ownerAddress: text('owner_address').notNull().unique(), // checksummed
  displayName: text('display_name'),
  // 8.5: Telegram chat id the owner links in Settings. Not an address, not a secret — just a
  // routing id for the optional outbound notifier (nullable; unset means Telegram is off for them).
  telegramChatId: text('telegram_chat_id'),
  createdAt: createdAt(),
  lastLoginAt: ts('last_login_at'),
});

export const wallets = pgTable(
  'wallets',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    chainId: integer('chain_id').notNull(),
    treasuryAddress: text('treasury_address').notNull(), // sweep_home destination
    agentWalletAddress: text('agent_wallet_address').unique(), // null until provisioned (Phase 2)
    agentWalletRef: jsonb('agent_wallet_ref'), // CDP identifiers, no secrets
    frozen: boolean('frozen').notNull().default(false),
    frozenAt: ts('frozen_at'),
    frozenReason: text('frozen_reason'),
    breakerFailures: integer('breaker_failures').notNull().default(0),
    breakerOpen: boolean('breaker_open').notNull().default(false),
    activePolicyVersion: integer('active_policy_version'),
    createdAt: createdAt(),
  },
  (t) => [check('wallets_chain_id_check', sql`${t.chainId} in (84532, 8453)`)],
);

export const mandates = pgTable('mandates', {
  id: id(),
  walletId: uuid('wallet_id')
    .notNull()
    .references(() => wallets.id),
  text: text('text').notNull(),
  template: mandateTemplate('template').notNull(),
  compiledDraft: jsonb('compiled_draft'),
  assumptions: jsonb('assumptions'),
  questions: jsonb('questions'),
  promptVersion: integer('prompt_version'),
  createdAt: createdAt(),
});

export const policies = pgTable(
  'policies',
  {
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    version: integer('version').notNull(),
    mandateId: uuid('mandate_id').references(() => mandates.id),
    body: jsonb('body').notNull(),
    bodyHash: text('body_hash').notNull(),
    signature: text('signature'),
    status: policyStatus('status').notNull().default('draft'),
    createdAt: createdAt(),
    activatedAt: ts('activated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.walletId, t.version] }),
    // exactly one active policy per wallet
    uniqueIndex('policies_one_active_per_wallet')
      .on(t.walletId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const recipients = pgTable(
  'recipients',
  {
    id: id(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    label: text('label').notNull(),
    address: text('address').notNull(), // checksummed
    maxPerTx: money('max_per_tx').notNull(),
    schedule: jsonb('schedule'),
    addedSignature: text('added_signature'),
    status: recipientStatus('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('recipients_wallet_address_uq').on(t.walletId, t.address),
    check('recipients_max_per_tx_check', sql`${t.maxPerTx} >= 0`),
  ],
);

export const vaults = pgTable(
  'vaults',
  {
    id: text('id').notNull(), // slug, e.g. v1
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    name: text('name').notNull(),
    address: text('address').notNull(),
    assetAddress: text('asset_address').notNull(),
    kind: text('kind').notNull().default('erc4626'),
    maxAllocationBps: integer('max_allocation_bps').notNull(),
    flagged: boolean('flagged').notNull().default(false),
    flaggedReason: text('flagged_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.walletId] }),
    check('vaults_bps_check', sql`${t.maxAllocationBps} between 0 and 10000`),
  ],
);

export const spendPermissions = pgTable('spend_permissions', {
  id: id(),
  walletId: uuid('wallet_id')
    .notNull()
    .references(() => wallets.id),
  permission: jsonb('permission').notNull(),
  signature: text('signature').notNull(),
  permissionHash: text('permission_hash').notNull(),
  status: spendPermissionStatus('status').notNull().default('pending'),
  approvedTxHash: text('approved_tx_hash'),
  createdAt: createdAt(),
  revokedAt: ts('revoked_at'),
});

export const obligations = pgTable(
  'obligations',
  {
    id: id(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => recipients.id),
    amount: money('amount').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    recurrence: recurrence('recurrence').notNull().default('none'),
    status: obligationStatus('status').notNull().default('scheduled'),
    paidExecutionId: uuid('paid_execution_id'), // -> executions.id (declared without FK: circular)
    createdAt: createdAt(),
  },
  (t) => [check('obligations_amount_check', sql`${t.amount} >= 0`)],
);

export const agentDecisions = pgTable(
  'agent_decisions',
  {
    id: id(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    trigger: text('trigger').notNull(), // schedule|balance|obligation|risk|owner|approval
    contextSnapshot: jsonb('context_snapshot').notNull(),
    contextHash: text('context_hash').notNull(),
    screen: jsonb('screen'),
    proposal: jsonb('proposal'),
    proposalHash: text('proposal_hash'),
    proposalSource: text('proposal_source').notNull(), // serv|deterministic|owner
    verifier: jsonb('verifier'),
    servMeta: jsonb('serv_meta'),
    status: text('status').notNull(), // noop|allowed|escalated|denied|reasoning_invalid|skipped
    createdAt: createdAt(),
  },
  (t) => [index('agent_decisions_wallet_created_idx').on(t.walletId, t.createdAt.desc())],
);

export const verdicts = pgTable('verdicts', {
  id: id(),
  decisionId: uuid('decision_id')
    .notNull()
    .references(() => agentDecisions.id),
  decision: verdictDecision('decision').notNull(),
  results: jsonb('results').notNull(),
  policyVersion: integer('policy_version').notNull(),
  evaluatedAt: ts('evaluated_at').notNull().defaultNow(),
});

export const simulations = pgTable('simulations', {
  id: id(),
  decisionId: uuid('decision_id')
    .notNull()
    .references(() => agentDecisions.id),
  calls: jsonb('calls').notNull(),
  callsHash: text('calls_hash').notNull(),
  ok: boolean('ok').notNull(),
  deltas: jsonb('deltas'),
  error: text('error'),
  blockNumber: money('block_number'),
  createdAt: createdAt(),
});

export const approvals = pgTable('approvals', {
  id: id(),
  decisionId: uuid('decision_id')
    .notNull()
    .references(() => agentDecisions.id),
  walletId: uuid('wallet_id')
    .notNull()
    .references(() => wallets.id),
  proposalHash: text('proposal_hash').notNull(),
  message: text('message').notNull(),
  expiresAt: ts('expires_at').notNull(),
  status: approvalStatus('status').notNull().default('pending'),
  signature: text('signature'),
  decidedAt: ts('decided_at'),
});

export const receiptNonces = pgTable('receipt_nonces', {
  nonce: text('nonce').primaryKey(), // single-use (I10)
  walletId: uuid('wallet_id')
    .notNull()
    .references(() => wallets.id),
  proposalHash: text('proposal_hash').notNull(),
  issuedAt: ts('issued_at').notNull(),
  usedAt: ts('used_at'),
});

export const executions = pgTable(
  'executions',
  {
    id: id(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => agentDecisions.id),
    proposalHash: text('proposal_hash').notNull(),
    kind: text('kind').notNull(),
    callsHash: text('calls_hash').notNull(),
    userOpHash: text('user_op_hash'),
    txHash: text('tx_hash'),
    status: executionStatus('status').notNull().default('pending'),
    gasUsed: text('gas_used'),
    error: text('error'),
    createdAt: createdAt(),
    confirmedAt: ts('confirmed_at'),
  },
  // I10: idempotency key
  (t) => [uniqueIndex('executions_wallet_proposal_hash_uq').on(t.walletId, t.proposalHash)],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: id(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    executionId: uuid('execution_id').references(() => executions.id),
    token: text('token').notNull(),
    amount: money('amount').notNull(), // signed
    direction: ledgerDirection('direction').notNull(),
    counterpartyLabel: text('counterparty_label'),
    usdMicro: money('usd_micro').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ledger_entries_wallet_created_idx').on(t.walletId, t.createdAt)],
);

export const priceSnapshots = pgTable('price_snapshots', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  token: text('token').notNull(),
  microUsd: money('micro_usd').notNull(),
  publishedAt: ts('published_at').notNull(),
  source: text('source').notNull(),
  createdAt: createdAt(),
});

export const vaultSnapshots = pgTable(
  'vault_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    vaultId: text('vault_id').notNull(),
    sharePrice: money('share_price').notNull(),
    totalAssets: money('total_assets').notNull(),
    positionAssets: money('position_assets').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'vault_snapshots_nonneg',
      sql`${t.sharePrice} >= 0 and ${t.totalAssets} >= 0 and ${t.positionAssets} >= 0`,
    ),
  ],
);

export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  walletId: uuid('wallet_id').references(() => wallets.id),
  type: notificationType('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  payload: jsonb('payload'),
  readAt: ts('read_at'),
  channel: notificationChannel('channel').notNull().default('inapp'),
  createdAt: createdAt(),
});

// Append-only, hash-chained per wallet (global chain for wallet_id null). Writer + immutability trigger: task 1.9.
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    walletId: uuid('wallet_id'), // intentionally no FK: audit rows must outlive/never block on other tables
    actor: text('actor').notNull(), // agent|owner|system
    event: text('event').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    payload: jsonb('payload').notNull(),
    prevHash: text('prev_hash').notNull(),
    rowHash: text('row_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('audit_log_actor_check', sql`${t.actor} in ('agent', 'owner', 'system')`),
    index('audit_log_wallet_id_idx').on(t.walletId, t.id),
  ],
);
