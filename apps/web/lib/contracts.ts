// Response contracts between the Thesauros API and the web UI. One zod schema per payload: the
// routes build their JSON to this shape and the client parses every response with it. Money is
// always a decimal string of base units (USDC, 6 decimals); the UI formats it with the shared
// money helpers and never with a JS `number` (I12).
//
// Adapted from Steward's own contracts.ts (D-020/D-021): field names and shapes are kept identical
// wherever the underlying concept exists in Circle's model. Fields tied to Base's Spend Permission
// (spendPermission, the on-chain revoke step) are dropped — Circle's Gas Station policy has no
// per-wallet on-chain permission to read or revoke (D-012) — and callers that used them are
// adapted, not ported verbatim.
import { z } from 'zod';

const amount = z.string().regex(/^\d+$/);
const iso = z.string();

export const zConfig = z.object({
  demoMode: z.boolean(),
  chainId: z.number(),
  explorerBase: z.string(),
});
export type ConfigResponse = z.infer<typeof zConfig>;

export const zMe = z.object({
  user: z.object({ id: z.string(), address: z.string() }),
  wallet: z
    .object({
      id: z.string(),
      chainId: z.number(),
      agentWalletAddress: z.string().nullable(),
      frozen: z.boolean(),
    })
    .nullable(),
});
export type MeResponse = z.infer<typeof zMe>;

export const zVerdictWord = z.enum(['ALLOW', 'ESCALATE', 'DENY']);
export type VerdictWord = z.infer<typeof zVerdictWord>;

export const zDecisionItem = z.object({
  id: z.string(),
  trigger: z.string(),
  status: z.string(),
  kind: z.string().nullable(),
  title: z.string(),
  explanation: z.string(),
  amount: amount.nullable(),
  verdict: z
    .object({ decision: zVerdictWord, policyVersion: z.number(), evaluatedAt: iso })
    .nullable(),
  flaggedRules: z.array(z.string()),
  createdAt: iso,
});
export type DecisionItem = z.infer<typeof zDecisionItem>;

export const zDecisionList = z.object({
  decisions: z.array(zDecisionItem),
  nextCursor: z.string().nullable(),
});
export type DecisionList = z.infer<typeof zDecisionList>;

export const zRuleCheck = z.object({
  code: z.string(),
  result: z.enum(['PASS', 'ESCALATE', 'DENY']),
  message: z.string().nullable(),
  sentence: z.string(),
});
export type RuleCheck = z.infer<typeof zRuleCheck>;

export const zDecisionDetail = z.object({
  decision: z.object({
    id: z.string(),
    trigger: z.string(),
    status: z.string(),
    title: z.string(),
    explanation: z.string(),
    proposalSource: z.string(),
    proposalKind: z.string().nullable(),
    rationale: z.string().nullable(),
    amount: amount.nullable(),
    createdAt: iso,
  }),
  verdict: z
    .object({
      decision: zVerdictWord,
      policyVersion: z.number(),
      evaluatedAt: iso,
      checks: z.array(zRuleCheck),
    })
    .nullable(),
  simulation: z
    .object({
      ok: z.boolean(),
      error: z.string().nullable(),
      deltas: z.array(z.object({ holder: z.string(), token: z.string(), delta: z.string() })),
    })
    .nullable(),
  execution: z
    .object({
      status: z.string(),
      txHash: z.string().nullable(),
      error: z.string().nullable(),
      confirmedAt: iso.nullable(),
    })
    .nullable(),
  whyBlocked: z.array(z.string()),
});
export type DecisionDetail = z.infer<typeof zDecisionDetail>;

export const zDashboard = z.object({
  wallet: z.object({
    id: z.string(),
    chainId: z.number(),
    treasuryAddress: z.string(),
    agentWalletAddress: z.string().nullable(),
    frozen: z.boolean(),
    breakerOpen: z.boolean(),
  }),
  /** Reasoning is unavailable (no SERV key): deterministic-only actions still run. */
  degraded: z.boolean(),
  /** The worker has not ticked for this active wallet in a while. */
  paused: z.boolean(),
  lastLoopAt: iso.nullable(),
  demoMode: z.boolean(),
  balances: z.object({ treasuryUsdc: amount, agentUsdc: amount }),
  vaultPositions: z.array(
    z.object({ id: z.string(), name: z.string(), assets: amount, redeemableAssets: amount }),
  ),
  policy: z
    .object({
      version: z.number(),
      runwayBufferMicroUsd: amount,
      perTxMicroUsd: amount,
      dailyMicroUsd: amount,
    })
    .nullable(),
  pendingApprovals: z.number(),
  /** agentUsdc + every vault position's assets — what a full compromise of the agent could reach
   * right now. No allowanceRemaining term (unlike Steward's): Circle has no on-chain allowance. */
  maxAtRiskMicroUsd: amount,
  recent: z.array(zDecisionItem),
  security: z.object({ blockedCount: z.number(), lastCheckAt: iso.nullable() }),
  asOf: iso,
});
export type Dashboard = z.infer<typeof zDashboard>;

export const zOnboarding = z.object({
  step: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal('done')]),
  agentWalletAddress: z.string().nullable(),
  mandate: z
    .object({
      id: z.string(),
      text: z.string(),
      sentences: z.array(z.string()),
      assumptions: z.array(z.string()),
      questions: z.array(z.string()),
      compiled: z.boolean(),
    })
    .nullable(),
  activePolicyVersion: z.number().nullable(),
});
export type OnboardingState = z.infer<typeof zOnboarding>;

export const zProvision = z.object({ agentWalletAddress: z.string() });

export const zIssue = z.object({ path: z.string(), code: z.string(), message: z.string() });
export const zCompile = z.object({
  compiled: z.boolean(),
  sentences: z.array(z.string()),
  issues: z.array(zIssue),
  assumptions: z.array(z.string()),
  questions: z.array(z.string()),
  mandateId: z.string().nullable(),
});
export type CompileResponse = z.infer<typeof zCompile>;

export const zApiError = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export const zPolicyPrepare = z.object({
  version: z.number(),
  bodyHash: z.string(),
  message: z.string(),
  sentences: z.array(z.string()),
});
export type PolicyPrepare = z.infer<typeof zPolicyPrepare>;

export const zPolicyActivated = z.object({ version: z.number() });

export const zRecipient = z.object({
  id: z.string(),
  label: z.string(),
  address: z.string(),
  maxPerTx: amount,
  scheduleDayOfMonth: z.number().nullable(),
  riskTier: z.enum(['low', 'medium', 'high']),
  status: z.string(),
});
export type Recipient = z.infer<typeof zRecipient>;

export const zRecipientList = z.object({ recipients: z.array(zRecipient) });
export type RecipientList = z.infer<typeof zRecipientList>;

export const zRecipientPrepare = z.object({ message: z.string(), expiresAt: iso });
export type RecipientPrepare = z.infer<typeof zRecipientPrepare>;

export const zRecipientAdded = z.object({ recipient: zRecipient });

export const zApproval = z.object({
  id: z.string(),
  decisionId: z.string(),
  proposalHash: z.string(),
  status: z.string(),
  message: z.string(),
  expiresAt: iso,
  decidedAt: iso.nullable(),
  rationale: z.string().nullable(),
});
export type Approval = z.infer<typeof zApproval>;

export const zApprovalList = z.object({ approvals: z.array(zApproval) });
export type ApprovalList = z.infer<typeof zApprovalList>;

export const zPolicyView = z.object({
  version: z.number().nullable(),
  sentences: z.array(z.string()),
  body: z.record(z.string(), z.unknown()).nullable(),
});
export type PolicyView = z.infer<typeof zPolicyView>;

export const zApprovalDecided = z.object({
  approval: z.object({ id: z.string(), status: z.string() }),
});

// ── owner control path (freeze/revoke/sweep; adapted for D-012: no on-chain permission to revoke) ──
//
// Steward's zOwnerPath/zFreezeResult read a resumable server-side status (frozen/revoke/sweep) so a
// reopened modal picks up where it left off. Circle's model collapses that: there is no separate
// on-chain revoke step to poll (D-012/D-019 item 9 — "revoke" is the same DB flag as freeze), and
// this session's sweep runs synchronously in the request rather than being submitted and polled
// (apps/web/lib/sweep.ts), so there is nothing to resume across a reload either. The freeze flow
// below tracks its own three-step state locally instead of reading it back from the server.

export const zFreezePrepare = z.object({ message: z.string(), expiresAt: iso });
export const zFreezeResult = z.object({ frozen: z.boolean() });
export const zUnfreezeResult = z.object({ frozen: z.boolean() });
export const zSweepResult = z.union([
  z.object({ status: z.literal('executed'), providerTxId: z.string(), amountBaseUnits: amount }),
  z.object({ status: z.literal('denied'), reasons: z.array(z.string()) }),
  z.object({ status: z.literal('failed'), reason: z.string() }),
]);
export type SweepResult = z.infer<typeof zSweepResult>;

// ── notifications ────────────────────────────────────────────────────────────────────────────────
export const zNotification = z.object({
  id: z.string(),
  type: z.enum(['execution', 'escalation', 'blocked', 'risk', 'freeze', 'report']),
  title: z.string(),
  body: z.string(),
  read: z.boolean(),
  createdAt: iso,
});
export type NotificationItem = z.infer<typeof zNotification>;
export const zNotificationList = z.object({
  rows: z.array(zNotification),
  nextCursor: z.string().nullable(),
  unreadCount: z.number(),
});
export type NotificationList = z.infer<typeof zNotificationList>;
