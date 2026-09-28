// R14 — rate limit (T10). A bug or a loop that keeps proposing hits this before it drains
// anything; breaching it is also the circuit-breaker signal Phase 5 counts.
import { SYSTEM_CEILINGS } from '@thesauros/shared';
import { deny, pass, type Rule } from './kit';

export const R14: Rule = (input) => {
  const limit = Math.min(
    input.policy.limits.maxActionsPerHour,
    SYSTEM_CEILINGS.MAX_ACTIONS_PER_HOUR,
  );
  return input.ledger.actionsLastHour < limit
    ? pass('R14', `${input.ledger.actionsLastHour} actions in the last hour, limit ${limit}`)
    : deny(
        'R14',
        `${input.ledger.actionsLastHour} actions in the last hour reaches the limit ${limit}`,
      );
};
