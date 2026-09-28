// R13 — a pull may not exceed the agent's remaining operating allowance. Today that allowance is
// read from the Base-style Spend Permission this rule was written against; Phase 2 replaces the
// *source* of `state.allowanceRemaining` with the live Circle Paymaster policy's remaining cap
// (docs/VERIFY.md row 6) without changing this rule at all — "paymaster cap exceeded," not "spend
// permission exceeded," is the correct reading of a DENY here once that lands. The chain enforces
// this too (SECURITY §3 L2); denying here keeps us from burning a doomed transaction and from
// reading a stale allowance as permission.
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
