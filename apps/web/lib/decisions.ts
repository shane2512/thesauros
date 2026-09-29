// Builds a DecisionItem/DecisionDetail (lib/contracts.ts) from the raw DB rows. Explanations use
// the deterministic `explainVerdict`/`ruleSentences` from packages/policy directly — no SERV call
// needed for a dashboard/activity read, and the text can never disagree with the stored verdict
// since it's derived only from it (same guarantee Steward's own `explain.ts` documents).
import { explainVerdict, ruleSentences } from '@thesauros/policy';
import type { AgentDecisionRow, SimulationRow, VerdictRow } from '@thesauros/db';
import type { RuleCode, Verdict } from '@thesauros/shared';
import type { DecisionDetail, DecisionItem, RuleCheck } from './contracts';

const KIND_TITLE: Record<string, string> = {
  pull_allowance: 'Pull allowance',
  vault_deposit: 'Vault deposit',
  vault_withdraw: 'Vault withdrawal',
  pay_recipient: 'Payment',
  sweep_home: 'Sweep to treasury',
  risk_exit: 'Risk exit',
  noop: 'No action needed',
};

function proposalOf(row: AgentDecisionRow): { kind: string | null; amount: string | null } {
  const p = row.proposal as { kind?: string; params?: { amount?: string } } | null;
  return { kind: p?.kind ?? null, amount: p?.params?.amount ?? null };
}

function verdictAsVerdict(v: VerdictRow, at: string): Verdict {
  return {
    decision: v.decision,
    results: v.results as Verdict['results'],
    policyVersion: v.policyVersion,
    proposalHash: `0x${'0'.repeat(64)}`,
    walletId: '',
    evaluatedAt: at,
  };
}

export function toDecisionItem(
  row: AgentDecisionRow,
  verdict: VerdictRow | undefined,
): DecisionItem {
  const { kind, amount } = proposalOf(row);
  const title = kind ? (KIND_TITLE[kind] ?? kind) : 'Decision';
  const explanation = verdict
    ? (explainVerdict(verdictAsVerdict(verdict, row.createdAt.toISOString())).split('\n')[0] ?? '')
    : 'Skipped: no proposal to evaluate.';
  const flaggedRules = verdict
    ? (verdict.results as { code: string; result: string }[])
        .filter((r) => r.result !== 'PASS')
        .map((r) => r.code)
    : [];
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    kind,
    title,
    explanation,
    amount,
    verdict: verdict
      ? {
          decision: verdict.decision,
          policyVersion: verdict.policyVersion,
          evaluatedAt: row.createdAt.toISOString(),
        }
      : null,
    flaggedRules,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toDecisionDetail(
  row: AgentDecisionRow,
  verdict: VerdictRow | undefined,
  simulation: SimulationRow | undefined,
): DecisionDetail {
  const { kind, amount } = proposalOf(row);
  const item = toDecisionItem(row, verdict);
  const proposal = row.proposal as { rationale?: string } | null;
  const checks: RuleCheck[] = verdict
    ? (
        verdict.results as {
          code: string;
          result: 'PASS' | 'ESCALATE' | 'DENY';
          message?: string | null;
        }[]
      ).map((r) => ({
        code: r.code,
        result: r.result,
        message: r.message ?? null,
        sentence: ruleSentences[r.code as RuleCode] ?? r.code,
      }))
    : [];
  const whyBlocked = checks
    .filter((c) => c.result === 'DENY')
    .map((c) => `${c.code}: ${c.sentence}`);
  return {
    decision: {
      id: row.id,
      trigger: row.trigger,
      status: row.status,
      title: item.title,
      explanation: verdict
        ? explainVerdict(verdictAsVerdict(verdict, row.createdAt.toISOString()))
        : item.explanation,
      proposalSource: row.proposalSource,
      proposalKind: kind,
      rationale: proposal?.rationale ?? null,
      amount,
      createdAt: row.createdAt.toISOString(),
    },
    verdict: verdict
      ? {
          decision: verdict.decision,
          policyVersion: verdict.policyVersion,
          evaluatedAt: row.createdAt.toISOString(),
          checks,
        }
      : null,
    simulation: simulation
      ? {
          ok: simulation.ok,
          error: simulation.error,
          deltas: (simulation.deltas as { holder: string; token: string; delta: string }[]) ?? [],
        }
      : null,
    execution: null,
    whyBlocked,
  };
}
