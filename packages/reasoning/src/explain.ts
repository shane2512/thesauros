import { explainVerdict, ruleSentences } from '@thesauros/policy';
import type { Verdict } from '@thesauros/shared';
import { callJson, type CallMeta } from './call';
import { buildExplainPrompt } from './prompts';
import { SERV_SCHEMAS, zServExplanation } from './schemas';
import { ADDRESS_RE } from './propose';
import type { ServClient } from './serv/client';

export type ExplainOutcome = {
  text: string;
  /** True when the deterministic text was used because SERV failed or said something unusable. */
  fallback: boolean;
  meta?: CallMeta;
};

export type ExplainInput = { client: ServClient; model: string; verdict: Verdict };

/** Sentences for the rules that actually decided, in the order the engine reports them. */
export function verdictSentences(verdict: Verdict): string[] {
  const deciding = verdict.results.filter((r) => r.result !== 'PASS' || r.lifted === true);
  const rows = deciding.length > 0 ? deciding : verdict.results.slice(0, 1);
  return rows.map((r) => `${r.code}: ${ruleSentences[r.code]}`);
}

/**
 * Task 4.8. SERV only phrases what the engine already decided; on any failure — transport, schema,
 * an empty answer, or an answer that smuggles in an address — the deterministic `explainVerdict`
 * text is used instead. The explanation can never change or soften the decision.
 */
export async function explain(input: ExplainInput): Promise<ExplainOutcome> {
  const deterministic = explainVerdict(input.verdict);
  const res = await callJson({
    client: input.client,
    task: 'explain',
    model: input.model,
    prompt: buildExplainPrompt({
      decision: input.verdict.decision,
      sentences: verdictSentences(input.verdict),
      deterministic,
    }),
    schema: SERV_SCHEMAS.explain,
    parser: zServExplanation,
  });

  if (!res.ok) return { text: deterministic, fallback: true, meta: res.error.meta };

  const text = res.value.value.text.trim();
  if (text.length === 0 || ADDRESS_RE.test(text)) {
    return { text: deterministic, fallback: true, meta: res.value.meta };
  }
  return { text, fallback: false, meta: res.value.meta };
}
