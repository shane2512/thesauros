// Task 3.8 — mandate templates. JSON-safe presets (micro-USD as decimal strings, I12) that the
// onboarding wizard offers before the owner edits anything. A template carries only NUMBERS and
// POLICY, never addresses: the treasury, token, vaults and recipients are bound by the caller, so
// no template can ever introduce a destination (I4 / T3).
//
// The `startup` values are the DEMO.md "Startup Operating" demo values.
import { type Address, type PolicyDraft, type ProposalKind } from '@thesauros/shared';
import { validatePolicyDraft, type PolicyIssue } from './validate';
import type { Result } from '@thesauros/shared';

export const MANDATE_TEMPLATE_NAMES = ['startup', 'dao', 'creator'] as const;
export type MandateTemplateName = (typeof MANDATE_TEMPLATE_NAMES)[number];

export type MandateTemplate = {
  name: MandateTemplateName;
  title: string;
  summary: string;
  limits: { perTxMicroUsd: string; dailyMicroUsd: string; maxActionsPerHour: number };
  runwayBufferMicroUsd: string;
  approvalThresholdMicroUsd: string;
  approvalThresholdByKind: Partial<Record<ProposalKind, string>>;
  depegThresholdBps: number;
  vaultDrawdownBps: number;
  autonomousKinds: ProposalKind[];
  /** What to suggest as the on-chain Spend Permission allowance per day (SECURITY §3 L2). */
  suggestedAllowanceMicroUsd: string;
};

const USDC = (whole: number) => (BigInt(whole) * 1_000_000n).toString();

export const MANDATE_TEMPLATES: Record<MandateTemplateName, MandateTemplate> = {
  startup: {
    name: 'startup',
    title: 'Startup Operating',
    summary: 'Keep months of runway liquid, earn on the rest, pay the team on schedule.',
    limits: {
      perTxMicroUsd: USDC(50_000),
      dailyMicroUsd: USDC(60_000),
      maxActionsPerHour: 10,
    },
    runwayBufferMicroUsd: USDC(120_000),
    approvalThresholdMicroUsd: USDC(15_000),
    // Moving funds into an allowlisted vault, or pulling within the allowance the owner already
    // signed on-chain, is lower risk than paying it out — both get a higher bar before escalating.
    approvalThresholdByKind: { vault_deposit: USDC(60_000), pull_allowance: USDC(60_000) },
    depegThresholdBps: 50,
    vaultDrawdownBps: 100,
    autonomousKinds: [
      'pull_allowance',
      'vault_deposit',
      'vault_withdraw',
      'pay_recipient',
      'risk_exit',
      'noop',
    ],
    suggestedAllowanceMicroUsd: USDC(50_000),
  },
  dao: {
    name: 'dao',
    title: 'DAO Treasury',
    summary: 'Conservative: the agent manages yield, humans sign every payout.',
    limits: {
      perTxMicroUsd: USDC(100_000),
      dailyMicroUsd: USDC(200_000),
      maxActionsPerHour: 8,
    },
    runwayBufferMicroUsd: USDC(500_000),
    approvalThresholdMicroUsd: USDC(50_000),
    approvalThresholdByKind: { vault_deposit: USDC(100_000), pull_allowance: USDC(100_000) },
    depegThresholdBps: 30,
    vaultDrawdownBps: 75,
    autonomousKinds: ['pull_allowance', 'vault_deposit', 'vault_withdraw', 'risk_exit', 'noop'],
    suggestedAllowanceMicroUsd: USDC(100_000),
  },
  creator: {
    name: 'creator',
    title: 'Solo Creator',
    summary: 'Small balances, small limits, everything above a grand asks first.',
    limits: {
      perTxMicroUsd: USDC(2_000),
      dailyMicroUsd: USDC(5_000),
      maxActionsPerHour: 5,
    },
    runwayBufferMicroUsd: USDC(5_000),
    approvalThresholdMicroUsd: USDC(1_000),
    approvalThresholdByKind: { vault_deposit: USDC(5_000), pull_allowance: USDC(5_000) },
    depegThresholdBps: 50,
    vaultDrawdownBps: 150,
    autonomousKinds: [
      'pull_allowance',
      'vault_deposit',
      'vault_withdraw',
      'pay_recipient',
      'risk_exit',
      'noop',
    ],
    suggestedAllowanceMicroUsd: USDC(5_000),
  },
};

/** Everything a template cannot know: who you are and which addresses you trust. */
export type TemplateBinding = {
  chainId: 84532 | 8453;
  treasuryAddress: Address;
  usdcAddress: Address;
  vaults: { id: string; name: string; address: Address; maxAllocationBps: number }[];
  recipients: {
    id: string;
    label: string;
    address: Address;
    maxPerTxMicroUsd: string;
    schedule?: { dayOfMonth: number; amountMicroUsd: string };
  }[];
};

/**
 * Build a policy draft from a template and the owner's addresses, then validate it. Templates are
 * data, not trust: the result goes through `validatePolicyDraft` like anything a model produced.
 */
export function policyDraftFromTemplate(
  name: MandateTemplateName,
  binding: TemplateBinding,
): Result<PolicyDraft, PolicyIssue[]> {
  const t = MANDATE_TEMPLATES[name];
  return validatePolicyDraft({
    chainId: binding.chainId,
    treasuryAddress: binding.treasuryAddress,
    tokens: [{ symbol: 'USDC', address: binding.usdcAddress, decimals: 6 }],
    vaults: binding.vaults.map((v) => ({ ...v, asset: binding.usdcAddress, kind: 'erc4626' })),
    recipients: binding.recipients,
    limits: t.limits,
    runwayBufferMicroUsd: t.runwayBufferMicroUsd,
    approvalThresholdMicroUsd: t.approvalThresholdMicroUsd,
    approvalThresholdByKind: t.approvalThresholdByKind,
    depegThresholdBps: t.depegThresholdBps,
    vaultDrawdownBps: t.vaultDrawdownBps,
    autonomousKinds: t.autonomousKinds,
  });
}
