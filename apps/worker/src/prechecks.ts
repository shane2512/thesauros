// 6.2 — PreChecks. PURE: a function of numbers, the policy and the clock. No I/O, no SERV, no db.
//
// Two jobs (ARCHITECTURE §5 step 2):
//   * decide when an iteration has nothing to think about, so SERV is never called (SERV §7 budget);
//   * build the proposals that are a matter of arithmetic rather than judgement.
//
// Three deterministic triggers, in priority order:
//   (a) a risk trigger        -> `risk_exit`      — the safety action, R20 pre-authorises it
//   (b) an obligation due     -> `pay_recipient`  — plus the funding step it needs first
//   (c) idle cash above the buffer -> `pull_allowance` then `vault_deposit`
//
// (c) exists because the live SERV smoke showed the model does NOT reliably propose idle deployment
// (D-37: it returned `noop` for SERV_REASONING Example A). Yield is arithmetic, not judgement, so
// the loop computes it and the model is left the genuinely hard call — rebalancing under
// conflicting constraints.
//
// A deterministic proposal is NOT a bypass: it goes through `buildCalls`, the risk gate, the real
// `evaluate()`, a signed AllowReceipt and the executor exactly like a SERV one. It skips only the
// LLM proposer and (via R15's `source` exemption) the shadow verifier.
import { hashProposal } from '@thesauros/policy';
import type { Address, Policy, Proposal, ProposalKind, RiskTrigger } from '@thesauros/shared';

/** Below this, an action is not worth a transaction. 0.1 USDC at 6 decimals. */
export const MIN_ACTION_BASE_UNITS = 100_000n;
/** Obligations this far out are already "soon": keep their cash liquid rather than depositing it. */
export const PAYROLL_FLOAT_DAYS = 7;
const DAY_MS = 86_400_000;

export type PreCheckVault = {
  id: string;
  /** Asset-denominated position of the agent wallet. */
  positionAssets: bigint;
  /** What a full redeem pays out right now — the `risk_exit` expected delta. */
  redeemableAssets: bigint;
  shares: bigint;
  maxAllocationBps: number;
  flagged: boolean;
};

export type PreCheckObligation = {
  id: string;
  /** The POLICY recipient id (resolved by the caller from the db row, by id then by address). */
  policyRecipientId: string | null;
  amount: bigint;
  dueDate: Date;
};

export type PreCheckInput = {
  now: Date;
  policy: Policy;
  decimals: number;
  frozen: boolean;
  breakerOpen: boolean;
  agentUsdc: bigint;
  treasuryUsdc: bigint;
  allowanceRemaining: bigint;
  vaults: readonly PreCheckVault[];
  obligations: readonly PreCheckObligation[];
  riskTriggers: readonly RiskTrigger[];
  /**
   * Runway buffer in TOKEN base units. The caller converts with the oracle quote; the Policy Engine
   * re-does the conversion properly, so this is only ever used to SIZE a proposal, never to permit
   * one.
   */
  runwayBufferBaseUnits: bigint;
  /** Per-transaction cap in base units, same caveat. */
  perTxBaseUnits: bigint;
  /** SERV unavailable: only deterministic proposals may run (6.7). */
  degraded: boolean;
  /** Dust floor for an action, in base units. Defaults to `MIN_ACTION_BASE_UNITS`. */
  minActionBaseUnits?: bigint;
  /**
   * Proposal hashes already decided in the rolling 24 h window (R17's input).
   *
   * Building one of these again is pointless: R17 denies a repeat, so the loop would re-ask the
   * same refused question on every tick and write a decision row each time. A live run produced 21
   * identical `pay_recipient` DENYs this way, all correctly refused by R07's daily cap, none of
   * which needed asking twice. This does not weaken anything — the engine still decides, and an
   * action it would have permitted has a hash that is NOT in this set.
   */
  recentProposalHashes?: readonly string[];
};

export type PreCheck =
  /** Nothing may happen at all (frozen, breaker). Audited as SKIPPED; no context is even built. */
  | { kind: 'skip'; reason: string }
  /** Deterministically nothing to do. Audited as a NOOP decision; SERV is not called (SERV §7). */
  | { kind: 'noop'; reason: string }
  /** Arithmetic, not judgement. Still goes through policy + risk + receipt + executor. */
  | { kind: 'deterministic'; proposal: Proposal; trigger: DecisionTrigger; reason: string }
  /** Hand it to SERV: screen -> propose -> verify. */
  | { kind: 'discretionary'; reason: string };

export type DecisionTrigger = 'schedule' | 'balance' | 'obligation' | 'risk' | 'owner' | 'approval';

const clampZero = (v: bigint) => (v > 0n ? v : 0n);
const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));

function proposal(
  kind: Proposal['kind'],
  params: Record<string, unknown>,
  expectedDeltas: Proposal['expectedDeltas'],
  rationale: string,
  citedFactIds: string[],
): Proposal {
  // `source` is stamped here, in code, and never read from anything a model produced (RR-3).
  return {
    kind,
    params,
    expectedDeltas,
    rationale: rationale.slice(0, 600),
    citedFactIds,
    confidence: 1,
    source: 'deterministic',
  } as Proposal;
}

/**
 * Decide what this iteration should do. Total and deterministic: same input, same answer, which is
 * what makes `replay()` (NFR-4) meaningful for the deterministic path too.
 */
export function preChecks(input: PreCheckInput): PreCheck {
  const decided = decide(input);
  if (decided.kind !== 'deterministic') return decided;
  // Already asked and answered inside R17's window: stay quiet rather than re-proposing it.
  const seen = input.recentProposalHashes ?? [];
  if (!seen.includes(hashProposal(decided.proposal))) return decided;
  return {
    kind: 'noop',
    reason: `the only available action (${decided.proposal.kind}: ${decided.reason}) was already decided in the last 24h; R17 would refuse a repeat`,
  };
}

function decide(input: PreCheckInput): PreCheck {
  if (input.frozen) return { kind: 'skip', reason: 'wallet is frozen' };
  if (input.breakerOpen) return { kind: 'skip', reason: 'circuit breaker is open' };

  const minAction = input.minActionBaseUnits ?? MIN_ACTION_BASE_UNITS;
  const usdc = input.policy.tokens.find((t) => t.symbol === 'USDC');
  if (!usdc) return { kind: 'skip', reason: 'policy has no USDC token' };
  const token = usdc.address as Address;
  const allowed = (kind: ProposalKind) =>
    input.policy.autonomousKinds.includes(kind) || kind === 'risk_exit';

  // ── (a) risk exits first: a safety action outranks yield and even payroll ──────────────────────
  for (const trigger of input.riskTriggers) {
    const vault = input.vaults.find((v) => v.id === trigger.vaultId);
    if (!vault || vault.shares <= 0n) continue;
    return {
      kind: 'deterministic',
      trigger: 'risk',
      reason: `${trigger.trigger} on vault ${trigger.vaultId}`,
      proposal: proposal(
        'risk_exit',
        { vaultId: vault.id, trigger: trigger.trigger },
        // Funds move vault -> agent only (R20 denies anything else).
        [{ token, holder: 'agent', delta: vault.redeemableAssets }],
        `Risk trigger on vault ${vault.id} (${trigger.observed}); exiting the position to the agent wallet.`,
        [`F_VAULT_${vault.id}_POSITION`, `F_VAULT_${vault.id}_RISK`],
      ),
    };
  }

  // ── (b) obligations due today ──────────────────────────────────────────────────────────────────
  const today = input.now;
  const due = input.obligations
    .filter((o) => o.dueDate.getTime() <= today.getTime())
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  const payable = due.find((o) => o.policyRecipientId !== null && o.amount > 0n);
  if (payable && payable.policyRecipientId !== null) {
    if (input.agentUsdc >= payable.amount && allowed('pay_recipient')) {
      return {
        kind: 'deterministic',
        trigger: 'obligation',
        reason: `obligation ${payable.id} due ${payable.dueDate.toISOString().slice(0, 10)}`,
        proposal: proposal(
          'pay_recipient',
          {
            recipientId: payable.policyRecipientId,
            amount: payable.amount,
            obligationId: payable.id,
          },
          [
            { token, holder: 'agent', delta: -payable.amount },
            { token, holder: 'recipient', delta: payable.amount },
          ],
          `Scheduled payment for obligation ${payable.id}, due ${payable.dueDate
            .toISOString()
            .slice(0, 10)}.`,
          [`OBL_${payable.id}`, 'F_BAL_AGENT_USDC'],
        ),
      };
    }

    // The agent cannot cover it yet. Fund the shortfall — first from the on-chain allowance (cheap,
    // capped by the owner's signature), then by withdrawing from a vault.
    const shortfall = payable.amount - input.agentUsdc;
    const fund = fundShortfall(input, shortfall, token, minAction);
    if (fund) return fund;
    return {
      kind: 'noop',
      reason: `obligation ${payable.id} needs ${shortfall} more base units and there is no way to fund it`,
    };
  }

  // ── (c) idle cash above the buffer (D-37: the model will not do this reliably) ─────────────────
  const obligationTotal = input.obligations.reduce((s, o) => s + o.amount, 0n);
  const reserve = input.runwayBufferBaseUnits + obligationTotal;
  const liquid = input.agentUsdc + input.treasuryUsdc;
  const deployable = clampZero(liquid - reserve);

  if (deployable >= minAction) {
    // Step 1: bring the cash into the agent wallet, within the on-chain allowance. This moves money
    // between two liquid holders, so it cannot break the runway buffer (R08 exempts it).
    if (
      input.agentUsdc < deployable &&
      input.allowanceRemaining > 0n &&
      allowed('pull_allowance')
    ) {
      const amount = min(
        deployable - input.agentUsdc,
        input.allowanceRemaining,
        input.perTxBaseUnits,
        input.treasuryUsdc,
      );
      if (amount >= minAction) {
        return {
          kind: 'deterministic',
          trigger: 'balance',
          reason: `${deployable} base units deployable above the buffer`,
          proposal: proposal(
            'pull_allowance',
            { amount },
            [
              { token, holder: 'agent', delta: amount },
              { token, holder: 'treasury', delta: -amount },
            ],
            'Idle cash above the runway buffer: pulling within the owner-granted allowance so it can be put to work.',
            ['F_BAL_TREASURY_USDC', 'F_ALLOWANCE_REMAINING', 'F_OBLIGATIONS_30D'],
          ),
        };
      }
    }

    // Step 2: deposit what the agent holds, keeping the near-term payroll float liquid.
    if (allowed('vault_deposit')) {
      const floatUntil = new Date(today.getTime() + PAYROLL_FLOAT_DAYS * DAY_MS);
      const float = input.obligations
        .filter((o) => o.dueDate.getTime() <= floatUntil.getTime())
        .reduce((s, o) => s + o.amount, 0n);
      const free = clampZero(input.agentUsdc - float);
      const managed = liquid + input.vaults.reduce((s, v) => s + v.positionAssets, 0n);

      for (const vault of input.vaults) {
        if (vault.flagged) continue;
        if (input.riskTriggers.some((t) => t.vaultId === vault.id)) continue;
        // R09 head-room, computed the same multiplication-only way the rule does.
        const cap = (managed * BigInt(vault.maxAllocationBps)) / 10_000n;
        const room = clampZero(cap - vault.positionAssets);
        const amount = min(free, deployable, input.perTxBaseUnits, room);
        if (amount < minAction) continue;
        return {
          kind: 'deterministic',
          trigger: 'balance',
          reason: `${amount} base units idle above the buffer and the payroll float`,
          proposal: proposal(
            'vault_deposit',
            { vaultId: vault.id, amount },
            [{ token, holder: 'agent', delta: -amount }],
            `Depositing idle USDC into ${vault.id}, keeping the runway buffer and the next ${PAYROLL_FLOAT_DAYS} days of obligations liquid.`,
            ['F_BAL_AGENT_USDC', 'F_OBLIGATIONS_30D', `F_VAULT_${vault.id}_POSITION`],
          ),
        };
      }
    }
  }

  // ── nothing deterministic left ─────────────────────────────────────────────────────────────────
  // SERV §7: skip reasoning entirely unless there is a judgement call — an obligation coming up that
  // the liquid balance will not cover, or a vault over its allocation cap.
  if (input.degraded)
    return { kind: 'noop', reason: 'SERV is unavailable; no discretionary action this iteration' };

  const soon = new Date(today.getTime() + PAYROLL_FLOAT_DAYS * DAY_MS);
  const upcoming = input.obligations
    .filter((o) => o.dueDate.getTime() <= soon.getTime())
    .reduce((s, o) => s + o.amount, 0n);
  const shortOnPayroll = upcoming > 0n && liquid - upcoming < input.runwayBufferBaseUnits;
  const managed = liquid + input.vaults.reduce((s, v) => s + v.positionAssets, 0n);
  const overAllocated =
    managed > 0n &&
    input.vaults.some((v) => v.positionAssets * 10_000n > BigInt(v.maxAllocationBps) * managed);

  if (shortOnPayroll)
    return {
      kind: 'discretionary',
      reason: 'obligations in the next 7 days would push liquid funds below the runway buffer',
    };
  if (overAllocated)
    return { kind: 'discretionary', reason: 'a vault is above its allocation cap' };

  return {
    kind: 'noop',
    reason: 'nothing idle above the buffer, nothing due, no risk events, allocations within caps',
  };
}

/** Pull from the allowance, else withdraw from a vault, to cover `shortfall`. */
function fundShortfall(
  input: PreCheckInput,
  shortfall: bigint,
  token: Address,
  minAction: bigint,
): PreCheck | null {
  const allowed = (kind: ProposalKind) => input.policy.autonomousKinds.includes(kind);

  if (input.allowanceRemaining > 0n && input.treasuryUsdc > 0n && allowed('pull_allowance')) {
    const amount = min(
      shortfall,
      input.allowanceRemaining,
      input.perTxBaseUnits,
      input.treasuryUsdc,
    );
    if (amount >= minAction || amount === shortfall) {
      return {
        kind: 'deterministic',
        trigger: 'obligation',
        reason: 'funding a due obligation from the spend permission',
        proposal: proposal(
          'pull_allowance',
          { amount },
          [
            { token, holder: 'agent', delta: amount },
            { token, holder: 'treasury', delta: -amount },
          ],
          'Pulling within the owner-granted allowance to cover an obligation that is due.',
          ['F_ALLOWANCE_REMAINING', 'F_OBLIGATIONS_30D', 'F_BAL_AGENT_USDC'],
        ),
      };
    }
  }

  if (allowed('vault_withdraw')) {
    for (const vault of input.vaults) {
      if (vault.redeemableAssets <= 0n) continue;
      const amount = min(shortfall, vault.redeemableAssets, input.perTxBaseUnits);
      if (amount <= 0n) continue;
      return {
        kind: 'deterministic',
        trigger: 'obligation',
        reason: 'funding a due obligation from a vault position',
        proposal: proposal(
          'vault_withdraw',
          { vaultId: vault.id, amount },
          [{ token, holder: 'agent', delta: amount }],
          `Withdrawing from ${vault.id} to cover an obligation that is due.`,
          [`F_VAULT_${vault.id}_POSITION`, 'F_OBLIGATIONS_30D'],
        ),
      };
    }
  }

  return null;
}
