// R13 — a pull may not exceed what the owner's on-chain Spend Permission still allows. The chain
// enforces this too (SECURITY §3 L2); denying here keeps us from burning a doomed transaction and
// from reading a stale allowance as permission.
import { deny, pass, type Rule } from './kit';

export const R13: Rule = (input) => {
  if (input.proposal.kind !== 'pull_allowance') return pass('R13', 'not a pull');
  const { amount } = input.proposal.params;
  return amount <= input.state.allowanceRemaining
    ? pass(
        'R13',
        `pull of ${amount} is within the remaining allowance ${input.state.allowanceRemaining}`,
      )
    : deny(
        'R13',
        `pull of ${amount} exceeds the remaining allowance ${input.state.allowanceRemaining}`,
      );
};
