// Task 3.4 — the verdict: run every rule, then combine with precedence DENY > ESCALATE > ALLOW.
//
// `evaluate` NEVER throws and never defaults to ALLOW (I5). Anything it cannot fully understand —
// input that does not parse, a proposal kind it does not know, a rule that blows up — comes back as
// a DENY carrying the reason.
import {
  addressEquals,
  zEvaluationInput,
  type EvaluationInput,
  type ParsedEvaluationInput,
  type RuleCode,
  type RuleResult,
  type Verdict,
} from '@thesauros/shared';
import { hashProposal, hashProposalSafe } from './hash';
import { RULES, type Rule } from './rules';

const EPOCH = new Date(0).toISOString();

/**
 * Rules a valid owner approval may turn from ESCALATE into PASS (POLICY_ENGINE §6, SECURITY §5).
 * DENY is never liftable — no approval makes an unknown recipient known.
 */
export const APPROVAL_LIFTABLE: readonly RuleCode[] = [
  'R02',
  'R08',
  'R09',
  'R10',
  'R15',
  'R16',
  'R19',
  'R20',
  'R22',
];

/** Runs the catalogue. A rule that throws becomes a DENY rather than an exception (I5). */
export function runRules(
  input: ParsedEvaluationInput,
  rules: readonly Rule[] = RULES,
): RuleResult[] {
  return rules.map((rule) => {
    try {
      return rule(input);
    } catch (e) {
      return {
        code: 'ENGINE' as const,
        result: 'DENY' as const,
        message: `rule threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });
}

function decide(results: readonly RuleResult[]): Verdict['decision'] {
  if (results.some((r) => r.result === 'DENY')) return 'DENY';
  if (results.some((r) => r.result === 'ESCALATE')) return 'ESCALATE';
  return 'ALLOW';
}

/** R20's documented override of R02 for a genuinely triggered risk exit. */
function applyRiskExitOverride(
  input: ParsedEvaluationInput,
  results: readonly RuleResult[],
): RuleResult[] {
  if (input.proposal.kind !== 'risk_exit') return [...results];
  const r20Passed = results.some((r) => r.code === 'R20' && r.result === 'PASS');
  if (!r20Passed) return [...results];
  return results.map((r) =>
    r.code === 'R02' && r.result === 'ESCALATE'
      ? { ...r, result: 'PASS' as const, message: `${r.message} (overridden by R20)` }
      : r,
  );
}

function approvalIsValid(input: ParsedEvaluationInput, proposalHash: string): boolean {
  const a = input.ownerApproval;
  if (!a) return false;
  if (!addressEquals(a.signer, input.policy.signedBy)) return false;
  if (a.proposalHash !== proposalHash) return false;
  return a.expiresAt.getTime() > input.now.getTime();
}

function applyOwnerApproval(
  input: ParsedEvaluationInput,
  results: readonly RuleResult[],
  proposalHash: string,
): RuleResult[] {
  if (!approvalIsValid(input, proposalHash)) return [...results];
  return results.map((r) =>
    r.result === 'ESCALATE' && APPROVAL_LIFTABLE.includes(r.code)
      ? { ...r, result: 'PASS' as const, lifted: true }
      : r,
  );
}

/** Reads a field off untrusted input without trusting its getters. */
function safeField(input: unknown, key: string): unknown {
  try {
    return typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

function failClosed(input: unknown, message: string): Verdict {
  let evaluatedAt = EPOCH;
  const now = safeField(input, 'now');
  if (now instanceof Date && Number.isFinite(now.getTime())) evaluatedAt = now.toISOString();
  return {
    decision: 'DENY',
    results: [{ code: 'R00', result: 'DENY', message }],
    proposalHash: hashProposalSafe(safeField(input, 'proposal')),
    policyVersion: 0,
    walletId: '',
    evaluatedAt,
  };
}

/**
 * The one entry point. Validates its own input at the boundary — callers are typed, but the data
 * behind those types came from a database, an HTTP body or a language model.
 */
export function evaluate(input: EvaluationInput): Verdict {
  try {
    const parsed = zEvaluationInput.safeParse(input);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return failClosed(input, `evaluation input is invalid: ${detail}`);
    }
    const ev = parsed.data;
    const proposalHash = hashProposal(ev.proposal);
    const results = applyOwnerApproval(ev, applyRiskExitOverride(ev, runRules(ev)), proposalHash);
    return {
      decision: decide(results),
      results,
      proposalHash,
      policyVersion: ev.policy.version,
      walletId: ev.policy.walletId,
      evaluatedAt: ev.now.toISOString(),
    };
  } catch (e) {
    return failClosed(input, `policy engine error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
