// R19 — grounding (T8). Every fact the proposal cites must exist in the context snapshot it was
// built from: an invented fact id is a DENY. Low confidence is an ESCALATE, which an owner
// approval can lift.
import { SYSTEM_CEILINGS } from '@thesauros/shared';
import { deny, escalate, pass, type Rule } from './kit';

export const R19: Rule = (input) => {
  const known = new Set(input.contextFactIds);
  const invented = input.proposal.citedFactIds.filter((id) => !known.has(id));
  if (invented.length > 0)
    return deny('R19', `cites facts that are not in the context snapshot: ${invented.join(', ')}`);

  if (input.proposal.confidence < SYSTEM_CEILINGS.MIN_CONFIDENCE_AUTONOMOUS)
    return escalate(
      'R19',
      `confidence ${input.proposal.confidence} is below ${SYSTEM_CEILINGS.MIN_CONFIDENCE_AUTONOMOUS}`,
    );
  return pass('R19', `all ${input.proposal.citedFactIds.length} cited facts exist`);
};
