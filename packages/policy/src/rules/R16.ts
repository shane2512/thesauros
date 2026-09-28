// R16 — injection screen consequence (T1). A flag never blocks the safety actions (`noop`,
// `risk_exit`) — SECURITY §3 L5 is explicit about that — but any proposal that moves value to a
// holder other than the owner treasury is a DENY, and an owner approval cannot lift it. A
// `sweep_home` while a flag is up is an ESCALATE: the destination is the owner's own treasury, so
// the worst case is the owner being asked to confirm getting their money back.
import { VALUE_OUT_KINDS, deny, escalate, pass, type Rule } from './kit';

export const R16: Rule = (input) => {
  if (!input.screen.injectionSuspected) return pass('R16', 'no injection signals');
  const signals = input.screen.signals.join('; ') || 'unspecified';
  const kind = input.proposal.kind;

  if (kind === 'noop' || kind === 'risk_exit')
    return pass('R16', `injection suspected (${signals}) but ${kind} is a safety action`);
  if (VALUE_OUT_KINDS.includes(kind))
    return deny('R16', `injection suspected (${signals}) and ${kind} moves value out`);
  return escalate('R16', `injection suspected (${signals}); ${kind} needs the owner`);
};
