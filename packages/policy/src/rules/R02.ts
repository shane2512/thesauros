// R02 — the kind is one the mandate allows without asking. ESCALATE otherwise (an owner approval
// lifts it). R20 can override this for a triggered `risk_exit`; the override lives in `evaluate`.
//
// `noop` is exempt: it moves nothing, and escalating "do nothing" would bury the owner in cards.
// `sweep_home` is exempt because R03 already hard-requires source=owner — the owner asked for it in
// person. Every other kind, including `source='owner'` payments, still goes through this rule.
import { escalate, pass, type Rule } from './kit';

export const R02: Rule = (input) => {
  const kind = input.proposal.kind;
  if (kind === 'noop') return pass('R02', 'noop needs no autonomy');
  if (kind === 'sweep_home') return pass('R02', 'sweep_home is owner-initiated by R03');
  return input.policy.autonomousKinds.includes(kind)
    ? pass('R02', `${kind} is an autonomous kind`)
    : escalate('R02', `${kind} is not in autonomousKinds`);
};
