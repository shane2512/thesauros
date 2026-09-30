// 6.1 steps 7–10 — the part of an iteration that is the same whoever produced the proposal:
// build -> simulate -> evaluate -> ALLOW/ESCALATE/DENY.
//
// A SERV proposal, a deterministic proposal and an owner-approved proposal all come through here.
// There is deliberately no second route: `signReceipt` is reached from exactly one place in this
// file, after exactly one `evaluate()` call, and the executor refuses anything else (PHASES 6
// "Do not: add any shortcut path from SERV output to executor").
//
// Every step writes an audit row before the next one starts, and an `Err` from the audit writer
// aborts the iteration before anything is broadcast (I5/I6).
import { randomUUID } from 'node:crypto';
import type { PublicClient } from 'viem';
import {
  appendAudit,
  getUserIdForWallet,
  insertApproval,
  insertNotification,
  insertSimulation,
  insertVerdict,
  updateAgentDecision,
  type ApprovalRow,
  type Db,
} from '@thesauros/db';
import { evaluate, hashProposal, signReceipt } from '@thesauros/policy';
import { simulateProposalCalls } from '@thesauros/risk';
import {
  APPROVAL_TTL_MS,
  addressEquals,
  approvalMessage,
  type Address,
  type Delta,
  type Hex,
  type Proposal,
  type SimulatedApproval,
  type Verdict,
} from '@thesauros/shared';
import {
  buildCalls,
  callsHash,
  execute,
  tripBreaker,
  type Call,
  type ExecuteOutcome,
  type TxSender,
} from '@thesauros/wallet';
import { buildContextOf, type Gathered } from './gather';

export type PipelineDeps = {
  db: Db;
  publicClient: PublicClient;
  sender: TxSender;
  receiptKey: Uint8Array;
  now: () => Date;
  spendPermissionManagerAddress: Address;
  /** D-024: the USYC token address, needed to read a usyc_teller-kind vault's position. */
  usycAddress?: Address | undefined;
  allowMainnet: boolean;
  /** Hand the execution to the confirmer (pg-boss). Absent in tests that confirm inline. */
  enqueueConfirm?: (job: ConfirmRequest) => Promise<void>;
};

export type ConfirmRequest = {
  executionId: string;
  /** Circle's transaction id (`executions.userOpHash`) — the confirmer's handle to poll. */
  providerTxId: string;
  token: Address;
  holders: { agent: Address; treasury: Address; recipient?: Address };
  expectedDeltas: readonly Delta[];
  obligationId?: string;
  counterpartyLabel?: string;
};

export type PipelineInput = {
  g: Gathered;
  decisionId: string;
  proposal: Proposal;
  screen: { injectionSuspected: boolean; signals: string[] };
  verifier: { verdict: 'AGREE' | 'DISAGREE' | 'UNSURE'; reasons: string[] } | null;
  contextFactIds: string[];
  ownerApproval: { signer: Address; proposalHash: Hex; expiresAt: Date } | null;
};

export type PipelineOutcome =
  | { status: 'executed'; verdict: Verdict; execution: ExecuteOutcome }
  | { status: 'escalated'; verdict: Verdict; approval: ApprovalRow }
  | { status: 'denied'; verdict: Verdict }
  | { status: 'failed'; verdict?: Verdict; code: string; message: string };

/** Security-relevant denials the owner is told about (SECURITY §8, DEMO beat 1:30). */
const SECURITY_CODES = new Set(['R04', 'R05', 'R15', 'R16', 'R18', 'R19']);

export async function runPipeline(
  deps: PipelineDeps,
  input: PipelineInput,
): Promise<PipelineOutcome> {
  const { db } = deps;
  const g = input.g;
  const now = deps.now();
  const proposal = input.proposal;
  const proposalHash = hashProposal(proposal);
  const buildContext = buildContextOf(g, deps.spendPermissionManagerAddress, deps.allowMainnet);

  // ── build + simulate ──────────────────────────────────────────────────────────────────────────
  let hash: Hex | null = null;
  let simulation: {
    ok: boolean;
    deltas: Delta[];
    approvals: SimulatedApproval[];
    error?: string;
  } | null = null;

  const built = buildCalls(proposal, g.policy, buildContext);
  if (!built.ok) {
    // No calls means no simulation, which R11 turns into a DENY. We still run `evaluate` so the
    // audit carries every rule result rather than a bare "could not build".
    await audit(db, g.wallet.id, 'SIMULATION', input.decisionId, now, {
      ok: false,
      error: `${built.error.code}: ${built.error.message}`,
    });
  } else {
    const calls: readonly Call[] = built.value;
    hash = callsHash(calls);
    const recipient = recipientAddressFor(proposal, g);
    const simulated = await simulateProposalCalls({
      publicClient: deps.publicClient,
      calls,
      from: g.agent,
      token: g.usdc,
      holders: { agent: g.agent, treasury: g.treasury, ...(recipient ? { recipient } : {}) },
    });
    if (simulated.ok) {
      simulation = {
        ok: simulated.value.ok,
        deltas: simulated.value.deltas,
        approvals: simulated.value.approvals,
        ...(simulated.value.error === undefined ? {} : { error: simulated.value.error }),
      };
      await insertSimulation(db, {
        decisionId: input.decisionId,
        calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value.toString() })),
        callsHash: hash,
        ok: simulated.value.ok,
        deltas: simulated.value.deltas.map((d) => ({ ...d, delta: d.delta.toString() })),
        error: simulated.value.error ?? null,
        blockNumber: simulated.value.blockNumber,
      });
    }
    const audited = await audit(db, g.wallet.id, 'SIMULATION', input.decisionId, now, {
      callsHash: hash,
      ok: simulated.ok ? simulated.value.ok : false,
      error: simulated.ok ? (simulated.value.error ?? null) : simulated.error.message,
      deltas: simulated.ok
        ? simulated.value.deltas.map((d) => ({ ...d, delta: d.delta.toString() }))
        : [],
    });
    if (!audited) return { status: 'failed', code: 'AUDIT_FAILED', message: 'SIMULATION' };
  }

  // ── the Policy Engine — the only gate ─────────────────────────────────────────────────────────
  const evaluationInput = {
    policy: g.policy,
    proposal,
    now,
    chainId: g.policy.chainId,
    allowMainnet: deps.allowMainnet,
    // I11: only when there is genuinely no quote, and the engine still fences it to Base Sepolia.
    demoStableParity: g.quote === undefined,
    state: evaluationStateOf(g),
    ledger: g.ledger,
    simulation,
    verifier: input.verifier,
    screen: input.screen,
    contextFactIds: input.contextFactIds,
    ownerApproval: input.ownerApproval,
  };
  const verdict = evaluate(evaluationInput);

  await insertVerdict(db, {
    decisionId: input.decisionId,
    decision: verdict.decision,
    results: verdict.results,
    policyVersion: verdict.policyVersion,
  });
  const verdictAudited = await audit(db, g.wallet.id, 'VERDICT', input.decisionId, now, {
    decision: verdict.decision,
    proposalHash,
    policyVersion: verdict.policyVersion,
    results: verdict.results,
    ownerApproval: input.ownerApproval === null ? null : { signer: input.ownerApproval.signer },
    // NFR-4: the COMPLETE input the verdict is a function of, minus the policy body (referenced by
    // `policyVersion`, which is itself immutable once activated). `replay(decisionId)` re-runs the
    // real `evaluate()` on exactly this and must get an identical verdict. Storing it in the
    // append-only, hash-chained audit log — rather than in a mutable table — is what makes the
    // reproducibility claim worth anything.
    evaluationInput: serializeEvaluationInput(evaluationInput),
  });
  if (!verdictAudited)
    return { status: 'failed', verdict, code: 'AUDIT_FAILED', message: 'VERDICT' };

  // RR-12: the confirmer's breaker only counts *failures*. A rate-limit breach is a refusal, so it
  // would otherwise loop forever without opening the breaker. R14 is the bound; trip it here.
  if (verdict.results.some((r) => r.code === 'R14' && r.result !== 'PASS')) {
    await tripBreaker(db, g.wallet.id, 'R14 rate limit breached', now);
  }

  if (verdict.decision === 'DENY') {
    await updateAgentDecision(db, input.decisionId, { status: 'denied', proposalHash });
    const security = verdict.results.filter(
      (r) => r.result === 'DENY' && SECURITY_CODES.has(r.code),
    );
    if (security.length > 0 || input.screen.injectionSuspected) {
      await notify(db, g.wallet.id, {
        type: 'blocked',
        title: 'Thesauros blocked an action',
        body:
          security.map((r) => `${r.code}: ${r.message ?? r.result}`).join(' · ') ||
          'A proposal was blocked by the Policy Engine.',
        payload: { decisionId: input.decisionId, proposalHash, codes: security.map((r) => r.code) },
      });
    }
    return { status: 'denied', verdict };
  }

  if (verdict.decision === 'ESCALATE') {
    const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS);
    const message = approvalMessage({
      walletId: g.wallet.id,
      proposalHash,
      policyVersion: verdict.policyVersion,
      expiresAt,
    });
    const approval = await insertApproval(db, {
      decisionId: input.decisionId,
      walletId: g.wallet.id,
      proposalHash,
      message,
      expiresAt,
    });
    await updateAgentDecision(db, input.decisionId, { status: 'escalated', proposalHash });
    const escalated = await audit(db, g.wallet.id, 'APPROVAL_CREATED', approval.id, now, {
      decisionId: input.decisionId,
      proposalHash,
      policyVersion: verdict.policyVersion,
      expiresAt: expiresAt.toISOString(),
      codes: verdict.results.filter((r) => r.result === 'ESCALATE').map((r) => r.code),
    });
    if (!escalated)
      return { status: 'failed', verdict, code: 'AUDIT_FAILED', message: 'APPROVAL_CREATED' };
    await notify(db, g.wallet.id, {
      type: 'escalation',
      title: 'Thesauros needs your approval',
      body: verdict.results
        .filter((r) => r.result === 'ESCALATE')
        .map((r) => r.message ?? r.code)
        .join(' · '),
      payload: { approvalId: approval.id, decisionId: input.decisionId, proposalHash },
    });
    return { status: 'escalated', verdict, approval };
  }

  // ── ALLOW -> receipt -> executor ──────────────────────────────────────────────────────────────
  if (hash === null)
    return { status: 'failed', verdict, code: 'NO_CALLS', message: 'ALLOW without built calls' };

  const receipt = signReceipt(verdict, deps.receiptKey, now, randomUUID(), { callsHash: hash });
  if (!receipt.ok)
    return { status: 'failed', verdict, code: receipt.error.code, message: receipt.error.message };
  const receiptAudited = await audit(db, g.wallet.id, 'RECEIPT', input.decisionId, now, {
    proposalHash,
    policyVersion: receipt.value.policyVersion,
    callsHash: hash,
    expiresAt: receipt.value.expiresAt,
    // The nonce is the single-use idempotency key, not a secret; the MAC is deliberately not stored.
    nonce: receipt.value.nonce,
  });
  if (!receiptAudited)
    return { status: 'failed', verdict, code: 'AUDIT_FAILED', message: 'RECEIPT' };

  const executed = await execute(
    { db, sender: deps.sender, receiptKey: deps.receiptKey, now: deps.now },
    {
      walletId: g.wallet.id,
      decisionId: input.decisionId,
      proposal,
      policy: g.policy,
      receipt: receipt.value,
      buildContext,
      simulatedCallsHash: hash,
    },
  );
  if (!executed.ok)
    return {
      status: 'failed',
      verdict,
      code: executed.error.code,
      message: executed.error.message,
    };

  await updateAgentDecision(db, input.decisionId, { status: 'allowed', proposalHash });

  if (executed.value.status === 'submitted' && deps.enqueueConfirm) {
    const recipient = recipientAddressFor(proposal, g);
    const obligationId =
      proposal.kind === 'pay_recipient' ? proposal.params.obligationId : undefined;
    await deps.enqueueConfirm({
      executionId: executed.value.execution.id,
      providerTxId: executed.value.providerTxId,
      token: g.usdc,
      holders: { agent: g.agent, treasury: g.treasury, ...(recipient ? { recipient } : {}) },
      expectedDeltas: proposal.expectedDeltas,
      ...(obligationId === undefined ? {} : { obligationId }),
      ...(recipient ? { counterpartyLabel: recipientLabelFor(proposal, g) } : {}),
    });
  }

  return { status: 'executed', verdict, execution: executed.value };
}

/**
 * The replayable half of an `EvaluationInput`, as canonical JSON.
 *
 * The policy body is left out on purpose: it is already immutable (`policies(wallet_id, version)`
 * with exactly one active row) and including it would put an owner signature into the audit payload,
 * which `appendAudit` refuses on principle (SECURITY §6). Dates become ISO strings, bigints decimal
 * strings — `zEvaluationInput` reads both back.
 */
export function serializeEvaluationInput(i: EvaluationInputLike): Record<string, unknown> {
  return {
    proposal: JSON.parse(JSON.stringify(i.proposal, bigint)) as unknown,
    now: i.now.toISOString(),
    chainId: i.chainId,
    allowMainnet: i.allowMainnet,
    demoStableParity: i.demoStableParity,
    state: {
      ...i.state,
      agentUsdc: i.state.agentUsdc.toString(),
      treasuryUsdc: i.state.treasuryUsdc.toString(),
      allowanceRemaining: i.state.allowanceRemaining.toString(),
      vaultPositions: Object.fromEntries(
        Object.entries(i.state.vaultPositions).map(([k, v]) => [k, v.toString()]),
      ),
      prices: Object.fromEntries(
        Object.entries(i.state.prices).map(([k, v]) => [
          k,
          { microUsd: v.microUsd.toString(), publishedAt: v.publishedAt.toISOString() },
        ]),
      ),
    },
    ledger: {
      outflowsLast24hMicroUsd: i.ledger.outflowsLast24hMicroUsd.toString(),
      actionsLastHour: i.ledger.actionsLastHour,
      recentProposalHashes: i.ledger.recentProposalHashes,
    },
    simulation:
      i.simulation === null
        ? null
        : {
            ok: i.simulation.ok,
            deltas: i.simulation.deltas.map((d) => ({ ...d, delta: d.delta.toString() })),
            approvals: i.simulation.approvals.map((a) => ({ ...a, amount: a.amount.toString() })),
            ...(i.simulation.error === undefined ? {} : { error: i.simulation.error }),
          },
    verifier: i.verifier,
    screen: i.screen,
    contextFactIds: i.contextFactIds,
    ownerApproval:
      i.ownerApproval === null
        ? null
        : {
            signer: i.ownerApproval.signer,
            proposalHash: i.ownerApproval.proposalHash,
            expiresAt: i.ownerApproval.expiresAt.toISOString(),
          },
  };
}

type EvaluationInputLike = Omit<PipelineInput, 'g' | 'decisionId'> & {
  now: Date;
  chainId: number;
  allowMainnet: boolean;
  demoStableParity: boolean;
  state: ReturnType<typeof evaluationStateOf>;
  ledger: Gathered['ledger'];
  simulation: {
    ok: boolean;
    deltas: Delta[];
    approvals: SimulatedApproval[];
    error?: string;
  } | null;
};

const bigint = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/**
 * RFB 5 / I13 — the DB's `recipients.riskTier`/`lastScreenedAt` (set by Phase 3's screening
 * scheduler), remapped from the DB row's own id to the POLICY recipient id R22 looks up by address
 * equality (I4: never trust a stored id across two different id spaces without re-checking it).
 * A row still at `low`/never-screened contributes nothing — R22 treats "no entry" as "no known
 * degradation," not as a confirmed clean bill.
 */
function recipientScreensOf(
  g: Gathered,
): Record<string, { tier: 'medium' | 'high'; screenedAt: Date }> {
  const out: Record<string, { tier: 'medium' | 'high'; screenedAt: Date }> = {};
  for (const row of g.recipients) {
    if (row.riskTier === 'low' || !row.lastScreenedAt) continue;
    const policyRecipient = g.policy.recipients.find((p) => addressEquals(p.address, row.address));
    if (policyRecipient)
      out[policyRecipient.id] = { tier: row.riskTier, screenedAt: row.lastScreenedAt };
  }
  return out;
}

/** `EvaluationInput.state` — kept next to the pipeline so the approval path builds the same shape. */
export function evaluationStateOf(g: Gathered) {
  return {
    frozen: g.wallet.frozen,
    breakerOpen: g.wallet.breakerOpen,
    agentUsdc: g.balances.agentUsdc,
    treasuryUsdc: g.balances.treasuryUsdc,
    allowanceRemaining: g.allowanceRemaining,
    vaultPositions: Object.fromEntries(g.vaults.map((v) => [v.id, v.positionAssets])),
    prices: g.quote === undefined ? {} : { [g.usdc]: g.quote },
    contractHasCode: g.contractHasCode,
    riskTriggers: g.riskTriggers,
    recipientScreens: recipientScreensOf(g),
  };
}

/** I4: the address comes from the POLICY, by exact id match — never from the proposal. */
function recipientAddressFor(proposal: Proposal, g: Gathered): Address | undefined {
  if (proposal.kind !== 'pay_recipient') return undefined;
  const r = g.policy.recipients.find((x) => x.id === proposal.params.recipientId);
  return r ? (r.address as Address) : undefined;
}

function recipientLabelFor(proposal: Proposal, g: Gathered): string | undefined {
  if (proposal.kind !== 'pay_recipient') return undefined;
  return g.policy.recipients.find((x) => x.id === proposal.params.recipientId)?.label;
}

/** Append one audit row; `false` means the caller must abort (I6). */
export async function audit(
  db: Db,
  walletId: string,
  event: string,
  entityId: string,
  createdAt: Date,
  payload: unknown,
  entityType = 'decision',
): Promise<boolean> {
  const row = await appendAudit(db, {
    walletId,
    actor: 'agent',
    event,
    entityType,
    entityId,
    payload,
    createdAt,
  });
  return row.ok;
}

async function notify(
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
