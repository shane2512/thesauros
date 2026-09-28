// R06 — per-transaction size: 0 < amount <= policy per-tx limit, <= the system hard cap, and
// <= the recipient's own cap. All comparisons in micro-USD at the oracle price (I12).
import { SYSTEM_CEILINGS } from '@thesauros/shared';
import { proposalAmountBaseUnits, valueInput } from '../units';
import { deny, pass, resolveRecipient, type Rule } from './kit';

export const R06: Rule = (input) => {
  const amount = proposalAmountBaseUnits(input.proposal);
  if (amount === null) return pass('R06', 'proposal carries no amount');
  if (amount <= 0n) return deny('R06', 'amount must be > 0');

  const valued = valueInput(input);
  if (!valued.ok) return deny('R06', `cannot value the amount: ${valued.error}`);
  const micro = valued.value.amountMicroUsd;
  if (micro <= 0n) return deny('R06', 'amount is worth 0 micro-USD at the oracle price');

  if (micro > input.policy.limits.perTxMicroUsd)
    return deny(
      'R06',
      `${micro} micro-USD exceeds the per-tx limit ${input.policy.limits.perTxMicroUsd}`,
    );
  if (micro > SYSTEM_CEILINGS.MAX_PER_TX_MICRO_USD)
    return deny('R06', `${micro} micro-USD exceeds the system per-tx ceiling`);

  if (input.proposal.kind === 'pay_recipient') {
    const recipient = resolveRecipient(input.policy, input.proposal.params.recipientId);
    // An unknown recipient is R05's DENY; nothing to check here.
    if (recipient && micro > recipient.maxPerTxMicroUsd)
      return deny('R06', `${micro} micro-USD exceeds ${recipient.id}'s per-tx cap`);
  }
  return pass('R06', `${micro} micro-USD is within every per-tx limit`);
};
