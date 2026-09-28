// R10 — the approval threshold: at or above it, the owner decides. `approvalThresholdByKind`
// tunes it per kind (e.g. moving funds into an allowlisted vault is lower risk than paying out).
import { proposalAmountBaseUnits, valueInput } from '../units';
import { deny, escalate, pass, type Rule } from './kit';

export const R10: Rule = (input) => {
  if (proposalAmountBaseUnits(input.proposal) === null)
    return pass('R10', 'proposal carries no amount');

  const valued = valueInput(input);
  if (!valued.ok) return deny('R10', `cannot value the amount: ${valued.error}`);
  const micro = valued.value.amountMicroUsd;

  const threshold =
    input.policy.approvalThresholdByKind?.[input.proposal.kind] ??
    input.policy.approvalThresholdMicroUsd;
  return micro >= threshold
    ? escalate('R10', `${micro} micro-USD is at or above the approval threshold ${threshold}`)
    : pass('R10', `${micro} micro-USD is below the approval threshold ${threshold}`);
};
