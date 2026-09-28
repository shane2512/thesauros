// R22 — continuous compliance screening (RFB 5, I13). A recipient's risk tier can degrade after
// the policy was signed; this rule clamps their effective per-tx cap to a system tier ceiling
// instead of requiring the owner to re-sign the whole policy every time a re-screen comes back
// worse. `state.recipientScreens` is empty unless Phase 3's screening scheduler has actually run
// for that recipient — no entry (or 'low') means no known degradation, not a confirmed clean bill.
//
// ESCALATE, not DENY: a tier-based clamp is a judgment call the owner should get to override
// (SECURITY-relevant, but not objectively wrong the way an unknown recipient is), so it is in
// `APPROVAL_LIFTABLE`.
import { SYSTEM_CEILINGS } from '@thesauros/shared';
import { valueInput } from '../units';
import { escalate, pass, resolveRecipient, type Rule } from './kit';

export const R22: Rule = (input) => {
  if (input.proposal.kind !== 'pay_recipient') return pass('R22', 'not a payment');

  const recipient = resolveRecipient(input.policy, input.proposal.params.recipientId);
  if (!recipient) return pass('R22', 'unresolved recipient — R05 already denies this');

  const screen = input.state.recipientScreens[recipient.id];
  if (!screen || screen.tier === 'low') return pass('R22', 'no elevated risk tier on record');

  const cap =
    screen.tier === 'high'
      ? SYSTEM_CEILINGS.RECIPIENT_TIER_CAP_HIGH_MICRO_USD
      : SYSTEM_CEILINGS.RECIPIENT_TIER_CAP_MEDIUM_MICRO_USD;

  const valued = valueInput(input);
  if (!valued.ok) return escalate('R22', `cannot value the amount: ${valued.error}`);
  const micro = valued.value.amountMicroUsd;
  if (micro <= cap)
    return pass('R22', `${micro} micro-USD is within the ${screen.tier}-risk tier cap ${cap}`);
  return escalate(
    'R22',
    `${micro} micro-USD exceeds the ${screen.tier}-risk tier cap ${cap} (screened ${screen.screenedAt.toISOString()})`,
  );
};
