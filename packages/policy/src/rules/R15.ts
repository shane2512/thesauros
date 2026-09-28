// R15 — the shadow verifier (SECURITY §3 L5). DISAGREE is a DENY; UNSURE or a missing verdict is
// an ESCALATE (an owner approval can lift it). Skipped for proposals that no model authored.
import { deny, escalate, pass, type Rule } from './kit';

export const R15: Rule = (input) => {
  if (input.proposal.kind === 'noop') return pass('R15', 'noop moves nothing');
  if (input.proposal.source !== 'serv')
    return pass('R15', `source=${input.proposal.source} needs no verifier`);

  const verifier = input.verifier;
  if (!verifier) return escalate('R15', 'no verifier verdict was supplied');
  switch (verifier.verdict) {
    case 'AGREE':
      return pass('R15', 'the verifier agrees');
    case 'DISAGREE':
      return deny(
        'R15',
        `the verifier disagrees: ${verifier.reasons.join('; ') || 'no reason given'}`,
      );
    default:
      return escalate(
        'R15',
        `the verifier is unsure: ${verifier.reasons.join('; ') || 'no reason given'}`,
      );
  }
};
