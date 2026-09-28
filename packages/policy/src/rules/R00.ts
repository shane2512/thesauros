// R00 — the proposal parses against the schema and its kind is known. DENY on failure (I5).
// `evaluate` already refuses input that does not parse; this rule re-checks the proposal alone so
// the audit always carries an explicit R00 line, and so the rule is meaningful in isolation.
import { zProposal } from '@thesauros/shared';
import { deny, pass, type Rule } from './kit';

export const R00: Rule = (input) => {
  const parsed = zProposal.safeParse(input.proposal);
  return parsed.success
    ? pass('R00', `proposal kind ${parsed.data.kind} is known and well-formed`)
    : deny(
        'R00',
        `proposal does not parse: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
};
