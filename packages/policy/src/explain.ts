// Task 3.9 — deterministic explanation of a verdict. Phase 4's `explain` prompt phrases this more
// naturally; when SERV is slow, down, or says something we did not ask for, this text is what the
// timeline shows. It is derived only from the verdict, so it can never disagree with the decision.
import type { Verdict } from '@thesauros/shared';
import { ruleSentences } from './sentences';

const HEAD: Record<Verdict['decision'], string> = {
  ALLOW: 'Approved by your mandate.',
  ESCALATE: 'Needs your approval.',
  DENY: 'Blocked by your mandate.',
};

export function explainVerdict(verdict: Verdict): string {
  const blocking = verdict.results.filter((r) => r.result === 'DENY');
  const escalating = verdict.results.filter((r) => r.result === 'ESCALATE');
  const lifted = verdict.results.filter((r) => r.lifted === true);

  const lines = [HEAD[verdict.decision]];
  for (const r of [...blocking, ...escalating]) {
    lines.push(`- ${r.code}: ${ruleSentences[r.code]}${r.message ? ` (${r.message})` : ''}`);
  }
  if (blocking.length === 0 && escalating.length === 0) {
    lines.push(`- All ${verdict.results.length} checks passed.`);
  }
  if (lifted.length > 0) {
    lines.push(`- Your approval lifted: ${lifted.map((r) => r.code).join(', ')}.`);
  }
  lines.push(`Policy v${verdict.policyVersion}, evaluated at ${verdict.evaluatedAt}.`);
  return lines.join('\n');
}
