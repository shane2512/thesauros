// Shared vocabulary for the rule catalogue. Every rule is a pure `(input) => RuleResult`.
import type {
  ParsedEvaluationInput,
  Policy,
  PolicyRecipient,
  PolicyVault,
  ProposalKind,
  RuleCode,
  RuleResult,
} from '@thesauros/shared';

export type Rule = (input: ParsedEvaluationInput) => RuleResult;

export const pass = (code: RuleCode, message: string): RuleResult => ({
  code,
  result: 'PASS',
  message,
});
export const escalate = (code: RuleCode, message: string): RuleResult => ({
  code,
  result: 'ESCALATE',
  message,
});
export const deny = (code: RuleCode, message: string): RuleResult => ({
  code,
  result: 'DENY',
  message,
});

export const resolveVault = (policy: Policy, vaultId: string): PolicyVault | undefined =>
  policy.vaults.find((v) => v.id === vaultId);

export const resolveRecipient = (
  policy: Policy,
  recipientId: string,
): PolicyRecipient | undefined => policy.recipients.find((r) => r.id === recipientId);

/** Kinds that touch a vault and therefore need R04's contract checks. */
export const VAULT_KINDS: readonly ProposalKind[] = [
  'vault_deposit',
  'vault_withdraw',
  'risk_exit',
];

/**
 * Kinds that move value to a holder that is not the owner treasury. `sweep_home` and `noop` are
 * the only kinds that never can (SECURITY §3 L5, R16).
 */
export const VALUE_OUT_KINDS: readonly ProposalKind[] = [
  'pull_allowance',
  'vault_deposit',
  'pay_recipient',
];

/** The vault id a proposal targets, if any. */
export function targetVaultId(input: ParsedEvaluationInput): string | null {
  const p = input.proposal;
  return p.kind === 'vault_deposit' || p.kind === 'vault_withdraw' || p.kind === 'risk_exit'
    ? p.params.vaultId
    : null;
}
