// R09 — concentration: after the deposit, this vault may hold at most `maxAllocationBps` of the
// managed funds (liquid USDC + every vault position). ESCALATE on breach — an owner may knowingly
// go heavier, but the agent may not decide that alone.
//
// bps math is done as `position * 10_000 > bps * managed` in bigint: no division, so no rounding
// window an attacker could sit in (I12).
import { valueInput } from '../units';
import { deny, escalate, pass, type Rule } from './kit';

export const R09: Rule = (input) => {
  if (input.proposal.kind !== 'vault_deposit') return pass('R09', 'not a vault deposit');
  const { vaultId } = input.proposal.params;

  const valued = valueInput(input);
  if (!valued.ok) return deny('R09', `cannot value positions: ${valued.error}`);
  const { managedMicroUsd, vaultPositionMicroUsd, amountMicroUsd } = valued.value;
  if (managedMicroUsd <= 0n)
    return escalate('R09', 'managed funds are 0; allocation is unverifiable');

  const post = vaultPositionMicroUsd(vaultId) + amountMicroUsd;
  const vault = input.policy.vaults.find((v) => v.id === vaultId);
  // An unknown vault is R04's DENY; use 0 bps here so this rule cannot silently pass it.
  const bps = BigInt(vault?.maxAllocationBps ?? 0);
  return post * 10_000n > bps * managedMicroUsd
    ? escalate(
        'R09',
        `vault ${vaultId} would hold ${post} of ${managedMicroUsd} micro-USD, over ${bps} bps`,
      )
    : pass('R09', `vault ${vaultId} would hold ${post} of ${managedMicroUsd} micro-USD`);
};
