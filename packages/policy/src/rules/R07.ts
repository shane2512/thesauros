// R07 — rolling 24h cap. Outflows are `vault_deposit` + `pay_recipient` (the ledger supplies the
// window); `pull_allowance` is bounded by R13 and the on-chain allowance instead, and the exits
// (`vault_withdraw`, `risk_exit`, `sweep_home`) bring money back.
//
// This is the rule dust-splitting attacks aim at: the cap is on the SUM over the window, so ten
// payments of a tenth of the cap hit it exactly like one payment of the cap.
import { SYSTEM_CEILINGS } from '@thesauros/shared';
import { valueInput } from '../units';
import { deny, pass, type Rule } from './kit';

const COUNTS_AS_OUTFLOW = ['vault_deposit', 'pay_recipient'] as const;

export const R07: Rule = (input) => {
  const kind = input.proposal.kind;
  if (!COUNTS_AS_OUTFLOW.some((k) => k === kind)) return pass('R07', `${kind} is not an outflow`);

  const valued = valueInput(input);
  if (!valued.ok) return deny('R07', `cannot value the amount: ${valued.error}`);

  const total = input.ledger.outflowsLast24hMicroUsd + valued.value.amountMicroUsd;
  if (total > input.policy.limits.dailyMicroUsd)
    return deny(
      'R07',
      `24h outflow would reach ${total} micro-USD, over the daily limit ${input.policy.limits.dailyMicroUsd}`,
    );
  if (total > SYSTEM_CEILINGS.MAX_DAILY_MICRO_USD)
    return deny('R07', `24h outflow would reach ${total} micro-USD, over the system daily ceiling`);
  return pass('R07', `24h outflow would reach ${total} micro-USD, within the daily limit`);
};
