// R05 — the recipient id resolves to a policy recipient. The address comes from the Policy and
// nowhere else: this is the anti address-poisoning rule (I4 / T3). There is no ENS resolution, no
// "looks like" matching, and no path by which a proposal can introduce an address.
import { deny, pass, resolveRecipient, type Rule } from './kit';

export const R05: Rule = (input) => {
  if (input.proposal.kind !== 'pay_recipient') return pass('R05', 'proposal names no recipient');
  const recipient = resolveRecipient(input.policy, input.proposal.params.recipientId);
  return recipient
    ? pass('R05', `recipient ${recipient.id} (${recipient.label}) is allowlisted`)
    : deny('R05', `recipient ${input.proposal.params.recipientId} is not in the policy allowlist`);
};
