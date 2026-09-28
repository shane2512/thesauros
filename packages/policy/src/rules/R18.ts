// R18 — approvals (T5). Every ERC-20 approval in the simulated calls must be for exactly the
// amount being deposited, on a policy token, to the allowlisted vault of THIS deposit. Anything
// else — an approval on another kind, a second approval, an approval to a non-vault, or any amount
// that is not the exact deposit — is a DENY. `maxUint256` can never pass this rule.
import { addressEquals } from '@thesauros/shared';
import { deny, pass, resolveVault, type Rule } from './kit';

export const R18: Rule = (input) => {
  const approvals = input.simulation?.approvals ?? [];
  if (approvals.length === 0) return pass('R18', 'the calls contain no approvals');

  if (input.proposal.kind !== 'vault_deposit')
    return deny('R18', `${input.proposal.kind} must not approve anything`);
  if (approvals.length > 1) return deny('R18', `${approvals.length} approvals in one deposit`);

  const vault = resolveVault(input.policy, input.proposal.params.vaultId);
  if (!vault) return deny('R18', 'approval targets a vault that is not in the policy');
  for (const approval of approvals) {
    if (!addressEquals(approval.spender, vault.address))
      return deny('R18', `approval spender ${approval.spender} is not vault ${vault.id}`);
    if (!input.policy.tokens.some((t) => addressEquals(t.address, approval.token)))
      return deny('R18', `approval is on token ${approval.token}, which is not a policy token`);
    if (approval.amount !== input.proposal.params.amount)
      return deny(
        'R18',
        `approval is for ${approval.amount}, not the exact deposit ${input.proposal.params.amount}`,
      );
  }
  return pass('R18', `one exact-amount approval to vault ${vault.id}`);
};
