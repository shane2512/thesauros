// R03 — `sweep_home` is owner-initiated only. No model and no scheduler may empty the wallet,
// even though the destination is the owner's own treasury (SECURITY §3 L1).
import { deny, pass, type Rule } from './kit';

export const R03: Rule = (input) => {
  if (input.proposal.kind !== 'sweep_home') return pass('R03', 'not a sweep_home');
  return input.proposal.source === 'owner'
    ? pass('R03', 'sweep_home was requested by the owner')
    : deny('R03', `sweep_home requires source=owner, got source=${input.proposal.source}`);
};
