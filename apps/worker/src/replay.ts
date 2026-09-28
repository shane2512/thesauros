// Opus review gate (NFR-4) — reproduce a past decision from what was STORED.
//
// The claim Thesauros makes is that every verdict is a pure function of its inputs, and that those
// inputs are all written down at the time. `replay()` proves it: it reads the `VERDICT` row out of
// the APPEND-ONLY, hash-chained audit log, reads the policy body for the version that row names,
// and re-runs the real `evaluate()` — the same function the loop calls, not a copy. If a single
// rule result differs, the decision was not reproducible and we want to know.
//
// Reading the inputs from `audit_log` rather than from `agent_decisions` is deliberate:
// `audit_log` cannot be updated or deleted (the `audit_log_no_mutation` trigger), and each row is
// chained to the one before it, so `verifyChain` can prove the inputs were not edited after the
// fact. Replaying from a mutable table would prove nothing.
//
// It reads only. It cannot sign a receipt or send anything.
import { getPolicyVersion, listAuditForEntity, type Db } from '@thesauros/db';
import { evaluate } from '@thesauros/policy';
import { err, ok, zEvaluationInput, zPolicy, type Result, type Verdict } from '@thesauros/shared';

export type ReplayError = { code: string; message: string };
const fail = (code: string, message: string): Result<never, ReplayError> => err({ code, message });

export type ReplayResult = {
  decisionId: string;
  /** The verdict recorded at decision time, from the audit row. */
  stored: { decision: string; policyVersion: number; results: { code: string; result: string }[] };
  /** What `evaluate()` produces NOW from those same inputs. */
  replayed: Verdict;
  /** True when the decision and every rule result match exactly. */
  identical: boolean;
  differences: string[];
  /** The audit row id the inputs came from, so a report can point at it. */
  auditRowId: number;
};

type VerdictPayload = {
  decision?: string;
  policyVersion?: number;
  results?: { code: string; result: string }[];
  evaluationInput?: Record<string, unknown>;
};

/**
 * Re-evaluate one decision from its stored inputs.
 *
 * The clock comes from the stored `now`, not the wall clock: replaying at a different instant
 * would legitimately change R12's freshness answer and would prove nothing about reproducibility.
 */
export async function replay(
  db: Db,
  decisionId: string,
  walletId: string,
): Promise<Result<ReplayResult, ReplayError>> {
  const rows = await listAuditForEntity(db, 'decision', decisionId);
  const verdictRow = rows.filter((r) => r.event === 'VERDICT').at(-1);
  if (!verdictRow) return fail('MISSING_VERDICT', 'no VERDICT audit row for this decision');

  const payload = verdictRow.payload as VerdictPayload;
  if (!payload.evaluationInput)
    return fail('MISSING_INPUT', 'the VERDICT row carries no evaluationInput');
  if (typeof payload.policyVersion !== 'number')
    return fail('MISSING_INPUT', 'the VERDICT row carries no policyVersion');

  const policyRow = await getPolicyVersion(db, walletId, payload.policyVersion);
  if (!policyRow)
    return fail('MISSING_POLICY', `policy v${payload.policyVersion} is not in the database`);
  const policy = zPolicy.safeParse(policyRow.body);
  if (!policy.success) return fail('POLICY_INVALID', 'the stored policy does not parse');

  const revived = reviveDates(payload.evaluationInput);
  const parsed = zEvaluationInput.safeParse({ ...revived, policy: policy.data });
  if (!parsed.success)
    return fail('INPUT_INVALID', `stored evaluationInput does not parse: ${parsed.error.message}`);

  const replayed = evaluate(parsed.data);

  const stored = payload.results ?? [];
  const storedByCode = new Map(stored.map((r) => [r.code, r.result]));
  const differences: string[] = [];
  for (const r of replayed.results) {
    const was = storedByCode.get(r.code);
    if (was !== r.result)
      differences.push(`${r.code}: stored ${was ?? '(absent)'}, replayed ${r.result}`);
  }
  if (payload.decision !== replayed.decision)
    differences.push(`decision: stored ${payload.decision}, replayed ${replayed.decision}`);

  return ok({
    decisionId,
    stored: {
      decision: payload.decision ?? '(absent)',
      policyVersion: payload.policyVersion,
      results: stored,
    },
    replayed,
    identical: differences.length === 0,
    differences,
    auditRowId: verdictRow.id,
  });
}

/**
 * JSON has no Date. `zEvaluationInput` uses `z.date()` (the engine takes real Dates, never strings),
 * so the three date fields are revived here before parsing. Amounts stay as decimal strings: the
 * schema already normalises those to bigint (I12).
 */
function reviveDates(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  if (typeof out['now'] === 'string') out['now'] = new Date(out['now']);

  const state = out['state'];
  if (state && typeof state === 'object') {
    const s = { ...(state as Record<string, unknown>) };
    const prices = s['prices'];
    if (prices && typeof prices === 'object') {
      s['prices'] = Object.fromEntries(
        Object.entries(prices as Record<string, { microUsd: string; publishedAt: string }>).map(
          ([k, v]) => [k, { microUsd: v.microUsd, publishedAt: new Date(v.publishedAt) }],
        ),
      );
    }
    out['state'] = s;
  }

  const approval = out['ownerApproval'];
  if (approval && typeof approval === 'object') {
    const a = { ...(approval as Record<string, unknown>) };
    if (typeof a['expiresAt'] === 'string') a['expiresAt'] = new Date(a['expiresAt']);
    out['ownerApproval'] = a;
  }
  return out;
}
