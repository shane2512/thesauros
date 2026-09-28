// Task 3.7 — the mandate in English. The UI shows these sentences for review before the owner
// signs a policy, and again next to every decision, so they must say exactly what the rules do.
import {
  PROPOSAL_KINDS,
  formatUnits,
  type PolicyDraft,
  type ProposalKind,
  type RuleCode,
} from '@thesauros/shared';

const usd = (v: bigint) => `${formatUnits(v, 6)} USDC`;

const KIND_WORDS: Record<ProposalKind, string> = {
  pull_allowance: 'pull USDC from your treasury within the signed allowance',
  vault_deposit: 'deposit into an approved vault',
  vault_withdraw: 'withdraw from an approved vault',
  pay_recipient: 'pay an approved recipient',
  sweep_home: 'sweep everything home',
  risk_exit: 'exit a vault when a risk trigger fires',
  noop: 'do nothing',
};

/** One sentence per rule code, for the decision detail view and the deterministic explainer. */
export const ruleSentences: Record<RuleCode, string> = {
  R00: 'The proposal is a well-formed action of a kind Thesauros knows.',
  R01: 'The wallet is not frozen and the circuit breaker is closed.',
  R02: 'The kind of action is one your mandate lets Thesauros take on its own.',
  R03: 'Only you can ask for a sweep home.',
  R04: 'The vault is on your allowlist, is a real contract, holds your token, and is not flagged.',
  R05: 'The recipient is on your allowlist, matched by exact address.',
  R06: 'The amount is within your per-transaction limit, the recipient cap and the system ceiling.',
  R07: 'The amount fits inside your rolling 24-hour limit.',
  R08: 'Your runway buffer is still covered after the action.',
  R09: 'No vault ends up holding more than the share of funds you allowed.',
  R10: 'Amounts at or above your approval threshold need your signature.',
  R11: 'A simulation of the exact calls produced the balance changes the proposal promised.',
  R12: 'Prices are fresh and the stablecoin is within your depeg threshold.',
  R13: 'The pull is within the allowance you signed on-chain.',
  R14: 'Thesauros has not acted more times this hour than you allowed.',
  R15: 'A second, independent model reviewed the proposal and agreed.',
  R16: 'No prompt-injection signals were found in the data behind this decision.',
  R17: 'The same action was not already proposed in the last 24 hours.',
  R18: 'Any token approval is for the exact amount and only to an approved vault.',
  R19: 'Every fact the proposal cites really exists, and the model was confident enough.',
  R20: 'A risk exit only runs by itself when a real trigger fired and funds only move home.',
  R21: 'The policy and the executor are on the same chain, and mainnet needs an explicit flag.',
  ENGINE: 'Thesauros could not evaluate this proposal, so it refused it.',
};

/** The mandate as plain English (POLICY_ENGINE §1, used by the onboarding review screen). */
export function renderPolicyAsSentences(p: PolicyDraft): string[] {
  const s: string[] = [];
  s.push(
    `Thesauros operates on chain ${p.chainId} and sends everything home to ${p.treasuryAddress}.`,
  );
  s.push(
    `Keep at least ${usd(p.runwayBufferMicroUsd)} liquid at all times; Thesauros may move at most ` +
      `${usd(p.limits.perTxMicroUsd)} per action and ${usd(p.limits.dailyMicroUsd)} per day, ` +
      `across at most ${p.limits.maxActionsPerHour} actions per hour.`,
  );
  s.push(`Ask you to approve anything worth ${usd(p.approvalThresholdMicroUsd)} or more.`);
  for (const kind of PROPOSAL_KINDS) {
    const threshold = p.approvalThresholdByKind?.[kind];
    if (threshold === undefined) continue;
    s.push(`For "${KIND_WORDS[kind]}", ask you only at ${usd(threshold)} or more.`);
  }
  s.push(
    p.autonomousKinds.length === 0
      ? 'Thesauros may take no action on its own; everything needs your approval.'
      : `Without asking, Thesauros may: ${p.autonomousKinds.map((k) => KIND_WORDS[k]).join('; ')}.`,
  );
  for (const v of p.vaults) {
    s.push(
      `"${v.name}" (${v.address}) may hold at most ${v.maxAllocationBps / 100}% of managed funds.`,
    );
  }
  if (p.vaults.length === 0) s.push('No vaults are approved, so Thesauros cannot deposit anywhere.');
  for (const r of p.recipients) {
    const schedule = r.schedule
      ? `, scheduled ${usd(r.schedule.amountMicroUsd)} on day ${r.schedule.dayOfMonth} of each month`
      : '';
    s.push(
      `"${r.label}" (${r.address}) may receive at most ${usd(r.maxPerTxMicroUsd)} per payment${schedule}.`,
    );
  }
  if (p.recipients.length === 0)
    s.push('No recipients are approved, so Thesauros cannot pay anyone.');
  s.push(
    `Exit a vault automatically if its share price falls ${p.vaultDrawdownBps / 100}% or if USDC ` +
      `moves more than ${p.depegThresholdBps / 100}% away from $1.00.`,
  );
  return s;
}
