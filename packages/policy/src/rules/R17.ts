// R17 — replay guard (T9/I10): the same action must not be proposed twice inside the ledger's 24h
// window. `noop` is exempt; doing nothing repeatedly is the normal case.
import { hashProposal } from '../hash';
import { deny, pass, type Rule } from './kit';

export const R17: Rule = (input) => {
  if (input.proposal.kind === 'noop') return pass('R17', 'noop is never a replay');
  const hash = hashProposal(input.proposal);
  return input.ledger.recentProposalHashes.includes(hash)
    ? deny('R17', `proposal ${hash} was already seen in the last 24h`)
    : pass('R17', `proposal ${hash} is new`);
};
