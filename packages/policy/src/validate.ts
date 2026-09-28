// Task 3.2 — the mandate validator. Turns a policy draft into either a validated draft or a list
// of structured issues the UI can render next to the offending field.
//
// It REJECTS, it never clamps (POLICY_ENGINE §5): silently lowering a limit the owner typed would
// teach them their mandate means something other than what it says. T16 is the threat here — the
// owner is allowed to be careless, not to disarm the system ceilings.
import {
  SYSTEM_CEILINGS,
  addressEquals,
  err,
  formatUnits,
  ok,
  zPolicyDraft,
  type PolicyDraft,
  type Result,
  type SystemCeilings,
} from '@thesauros/shared';

export type PolicyIssueCode =
  'SCHEMA' | 'ABOVE_CEILING' | 'BELOW_FLOOR' | 'INCONSISTENT' | 'DUPLICATE' | 'UNSAFE' | 'MISSING';

export type PolicyIssue = {
  /** Dotted path into the draft, e.g. `limits.perTxMicroUsd` or `recipients.2.address`. */
  path: string;
  code: PolicyIssueCode;
  message: string;
  suggestion: string;
};

const usd = (v: bigint) => `${formatUnits(v, 6)} USDC`;

export function validatePolicyDraft(
  draft: unknown,
  ceilings: SystemCeilings = SYSTEM_CEILINGS,
): Result<PolicyDraft, PolicyIssue[]> {
  const parsed = zPolicyDraft.safeParse(draft);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        code: 'SCHEMA' as const,
        message: i.message,
        suggestion: 'Fix the field so it matches the policy schema.',
      })),
    );
  }

  const p = parsed.data;
  const issues: PolicyIssue[] = [];
  const add = (path: string, code: PolicyIssueCode, message: string, suggestion: string) =>
    issues.push({ path, code, message, suggestion });

  // --- tokens -----------------------------------------------------------------------------------
  const usdc = p.tokens.filter((t) => t.symbol === 'USDC');
  if (usdc.length !== 1)
    add(
      'tokens',
      usdc.length === 0 ? 'MISSING' : 'DUPLICATE',
      `expected exactly one USDC token entry, found ${usdc.length}`,
      'MVP policies hold exactly one token: USDC.',
    );

  // --- limits -----------------------------------------------------------------------------------
  const { perTxMicroUsd, dailyMicroUsd, maxActionsPerHour } = p.limits;
  if (perTxMicroUsd <= 0n)
    add(
      'limits.perTxMicroUsd',
      'BELOW_FLOOR',
      'the per-transaction limit must be > 0',
      'Set a limit the agent can actually work within.',
    );
  if (perTxMicroUsd > ceilings.MAX_PER_TX_MICRO_USD)
    add(
      'limits.perTxMicroUsd',
      'ABOVE_CEILING',
      `${usd(perTxMicroUsd)} is above the system per-transaction ceiling of ${usd(ceilings.MAX_PER_TX_MICRO_USD)}`,
      `Lower it to at most ${usd(ceilings.MAX_PER_TX_MICRO_USD)}.`,
    );
  if (dailyMicroUsd <= 0n)
    add(
      'limits.dailyMicroUsd',
      'BELOW_FLOOR',
      'the daily limit must be > 0',
      'Set a daily limit greater than zero.',
    );
  if (dailyMicroUsd > ceilings.MAX_DAILY_MICRO_USD)
    add(
      'limits.dailyMicroUsd',
      'ABOVE_CEILING',
      `${usd(dailyMicroUsd)} is above the system daily ceiling of ${usd(ceilings.MAX_DAILY_MICRO_USD)}`,
      `Lower it to at most ${usd(ceilings.MAX_DAILY_MICRO_USD)}.`,
    );
  if (perTxMicroUsd > dailyMicroUsd)
    add(
      'limits.perTxMicroUsd',
      'INCONSISTENT',
      `the per-transaction limit ${usd(perTxMicroUsd)} is above the daily limit ${usd(dailyMicroUsd)}`,
      'A single action can never be larger than a whole day of actions.',
    );
  if (maxActionsPerHour > ceilings.MAX_ACTIONS_PER_HOUR)
    add(
      'limits.maxActionsPerHour',
      'ABOVE_CEILING',
      `${maxActionsPerHour} actions/hour is above the system ceiling of ${ceilings.MAX_ACTIONS_PER_HOUR}`,
      `Lower it to at most ${ceilings.MAX_ACTIONS_PER_HOUR}.`,
    );

  // --- approval thresholds (MIN_APPROVAL_THRESHOLD_BPS_OF_DAILY <= 100%) -------------------------
  if (p.approvalThresholdMicroUsd > dailyMicroUsd)
    add(
      'approvalThresholdMicroUsd',
      'INCONSISTENT',
      `an approval threshold of ${usd(p.approvalThresholdMicroUsd)} is above the daily limit ${usd(dailyMicroUsd)}, so nothing would ever be escalated`,
      `Set it to at most the daily limit (${usd(dailyMicroUsd)}).`,
    );
  const byKind = Object.entries(p.approvalThresholdByKind ?? {}).filter(
    (e): e is [string, bigint] => e[1] !== undefined,
  );
  for (const [kind, threshold] of byKind) {
    if (threshold > dailyMicroUsd)
      add(
        `approvalThresholdByKind.${kind}`,
        'INCONSISTENT',
        `the ${kind} approval threshold ${usd(threshold)} is above the daily limit ${usd(dailyMicroUsd)}`,
        `Set it to at most the daily limit (${usd(dailyMicroUsd)}).`,
      );
  }

  // --- risk parameters --------------------------------------------------------------------------
  if (p.depegThresholdBps < ceilings.MIN_RISK_THRESHOLD_BPS)
    add(
      'depegThresholdBps',
      'BELOW_FLOOR',
      'a depeg threshold of 0 disables the depeg guard',
      'Use 50 bps (0.5%) unless you have a reason not to.',
    );
  if (p.depegThresholdBps > ceilings.MAX_DEPEG_THRESHOLD_BPS)
    add(
      'depegThresholdBps',
      'ABOVE_CEILING',
      `${p.depegThresholdBps} bps is wider than the ${ceilings.MAX_DEPEG_THRESHOLD_BPS} bps ceiling; a stable that far off $1 is broken`,
      `Use at most ${ceilings.MAX_DEPEG_THRESHOLD_BPS} bps.`,
    );
  if (p.vaultDrawdownBps < ceilings.MIN_RISK_THRESHOLD_BPS)
    add(
      'vaultDrawdownBps',
      'BELOW_FLOOR',
      'a drawdown threshold of 0 disables the vault guard',
      'Use 100 bps (1%) unless you have a reason not to.',
    );
  if (p.vaultDrawdownBps > ceilings.MAX_VAULT_DRAWDOWN_BPS)
    add(
      'vaultDrawdownBps',
      'ABOVE_CEILING',
      `${p.vaultDrawdownBps} bps is wider than the ${ceilings.MAX_VAULT_DRAWDOWN_BPS} bps ceiling; risk_exit would never fire`,
      `Use at most ${ceilings.MAX_VAULT_DRAWDOWN_BPS} bps.`,
    );

  // --- autonomy ---------------------------------------------------------------------------------
  if (p.autonomousKinds.includes('sweep_home'))
    add(
      'autonomousKinds',
      'UNSAFE',
      'sweep_home can never be autonomous: it is owner-initiated only (R03)',
      'Remove sweep_home; the owner triggers it from the Freeze screen.',
    );
  if (new Set(p.autonomousKinds).size !== p.autonomousKinds.length)
    add(
      'autonomousKinds',
      'DUPLICATE',
      'autonomousKinds contains duplicates',
      'List each kind once.',
    );

  // --- vaults -----------------------------------------------------------------------------------
  if (p.vaults.length > ceilings.MAX_VAULTS)
    add(
      'vaults',
      'ABOVE_CEILING',
      `${p.vaults.length} vaults is above the ceiling of ${ceilings.MAX_VAULTS}`,
      `Keep at most ${ceilings.MAX_VAULTS} vaults on the allowlist.`,
    );
  p.vaults.forEach((v, i) => {
    if (p.vaults.findIndex((o) => o.id === v.id) !== i)
      add(
        `vaults.${i}.id`,
        'DUPLICATE',
        `vault id "${v.id}" is used twice`,
        'Vault ids must be unique.',
      );
    if (p.vaults.findIndex((o) => addressEquals(o.address, v.address)) !== i)
      add(
        `vaults.${i}.address`,
        'DUPLICATE',
        'this vault address is already allowlisted',
        'Remove the duplicate entry.',
      );
    if (!p.tokens.some((t) => addressEquals(t.address, v.asset)))
      add(
        `vaults.${i}.asset`,
        'INCONSISTENT',
        `vault "${v.id}" holds an asset that is not a policy token`,
        'Allowlist vaults whose asset is the policy token (USDC).',
      );
    if (v.maxAllocationBps === 0)
      add(
        `vaults.${i}.maxAllocationBps`,
        'INCONSISTENT',
        `vault "${v.id}" may hold 0% of funds, so it can never be used`,
        'Give it an allocation or remove the vault.',
      );
  });

  // --- recipients -------------------------------------------------------------------------------
  if (p.recipients.length > ceilings.MAX_RECIPIENTS)
    add(
      'recipients',
      'ABOVE_CEILING',
      `${p.recipients.length} recipients is above the ceiling of ${ceilings.MAX_RECIPIENTS}`,
      `Keep at most ${ceilings.MAX_RECIPIENTS} recipients on the allowlist.`,
    );
  p.recipients.forEach((r, i) => {
    if (p.recipients.findIndex((o) => o.id === r.id) !== i)
      add(
        `recipients.${i}.id`,
        'DUPLICATE',
        `recipient id "${r.id}" is used twice`,
        'Recipient ids must be unique.',
      );
    // Two labels on one address is how a poisoning attempt looks after it got past the UI (T3).
    if (p.recipients.findIndex((o) => addressEquals(o.address, r.address)) !== i)
      add(
        `recipients.${i}.address`,
        'DUPLICATE',
        `"${r.label}" has the same address as an earlier recipient`,
        'Remove the duplicate; one address, one recipient.',
      );
    if (addressEquals(r.address, p.treasuryAddress))
      add(
        `recipients.${i}.address`,
        'UNSAFE',
        `"${r.label}" is the treasury itself`,
        'Use sweep_home to move funds home; do not model the treasury as a payee.',
      );
    if (r.maxPerTxMicroUsd <= 0n)
      add(
        `recipients.${i}.maxPerTxMicroUsd`,
        'BELOW_FLOOR',
        `"${r.label}" can never be paid`,
        'Set a per-transaction cap greater than zero.',
      );
    if (r.maxPerTxMicroUsd > perTxMicroUsd)
      add(
        `recipients.${i}.maxPerTxMicroUsd`,
        'INCONSISTENT',
        `"${r.label}" may receive ${usd(r.maxPerTxMicroUsd)} per transaction, above the policy per-tx limit ${usd(perTxMicroUsd)}`,
        `Lower it to at most ${usd(perTxMicroUsd)}.`,
      );
    if (r.schedule && r.schedule.amountMicroUsd > r.maxPerTxMicroUsd)
      add(
        `recipients.${i}.schedule.amountMicroUsd`,
        'INCONSISTENT',
        `the scheduled ${usd(r.schedule.amountMicroUsd)} for "${r.label}" is above their own per-transaction cap`,
        'Raise the cap or lower the scheduled amount; otherwise every payment is blocked by R06.',
      );
  });

  // A negative runway buffer is impossible: `zAmount` refuses negative money at the schema edge.
  return issues.length > 0 ? err(issues) : ok(p);
}
