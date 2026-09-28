// R04 — the vault a proposal names resolves to an allowlisted policy vault, that address has code,
// its asset is a policy token, and (for deposits) it is not currently flagged by a risk trigger.
// This is the contract allowlist (T4): the id→address resolution happens against the Policy only.
import { addressEquals } from '@thesauros/shared';
import { byAddress } from '../units';
import { deny, pass, resolveVault, targetVaultId, type Rule } from './kit';

export const R04: Rule = (input) => {
  const vaultId = targetVaultId(input);
  if (vaultId === null) return pass('R04', 'proposal targets no vault');

  const vault = resolveVault(input.policy, vaultId);
  if (!vault) return deny('R04', `vault ${vaultId} is not in the policy allowlist`);

  const hasCode = byAddress(input.state.contractHasCode, vault.address);
  if (hasCode !== true) return deny('R04', `no contract code at vault ${vaultId}`);

  if (!input.policy.tokens.some((t) => addressEquals(t.address, vault.asset)))
    return deny('R04', `vault ${vaultId} asset is not a policy token`);

  if (input.proposal.kind === 'vault_deposit') {
    const trigger = input.state.riskTriggers.find((t) => t.vaultId === vaultId);
    if (trigger) return deny('R04', `vault ${vaultId} is flagged: ${trigger.trigger}`);
  }
  return pass('R04', `vault ${vaultId} is allowlisted and healthy`);
};
