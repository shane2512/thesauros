// R01 — the wallet is not frozen and the circuit breaker is closed. The single exception is an
// owner-requested `sweep_home`: getting the money home must work while frozen (I7, SECURITY §4).
import { deny, pass, type Rule } from './kit';

export const R01: Rule = (input) => {
  const { frozen, breakerOpen } = input.state;
  const ownerSweep = input.proposal.kind === 'sweep_home' && input.proposal.source === 'owner';
  if (ownerSweep) return pass('R01', 'owner sweep_home is allowed while frozen');
  if (frozen) return deny('R01', 'wallet is frozen');
  if (breakerOpen) return deny('R01', 'circuit breaker is open');
  return pass('R01', 'wallet is active and the breaker is closed');
};
