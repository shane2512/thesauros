import {
  renderPolicyAsSentences,
  validatePolicyDraft,
  type PolicyIssue,
  type TemplateBinding,
} from '@thesauros/policy';
import {
  formatUnits,
  parseUnits,
  SYSTEM_CEILINGS,
  type PolicyDraft,
  type ProposalKind,
} from '@thesauros/shared';
import { callJson, type CallMeta } from './call';
import { buildCompilerPrompt } from './prompts';
import { SERV_SCHEMAS, zServMandate, type ServMandate } from './schemas';
import type { ServClient } from './serv/client';

export type CompileInput = {
  client: ServClient;
  model: string;
  mandateText: string;
  /** Ids and addresses the owner created in the UI. The model can only reference these ids. */
  binding: TemplateBinding;
};

export type CompileOutcome = {
  /** Present only when the draft passed the deterministic validator. */
  draft?: PolicyDraft;
  sentences: string[];
  issues: PolicyIssue[];
  assumptions: string[];
  questions: string[];
  meta?: CallMeta;
};

/** The ceilings the model is shown — the same constants the validator enforces afterwards. */
export const ceilingsForPrompt = (): Record<string, string | number> => ({
  maxPerTxUsdc: formatUnits(SYSTEM_CEILINGS.MAX_PER_TX_MICRO_USD, 6),
  maxDailyUsdc: formatUnits(SYSTEM_CEILINGS.MAX_DAILY_MICRO_USD, 6),
  maxActionsPerHour: SYSTEM_CEILINGS.MAX_ACTIONS_PER_HOUR,
  maxVaults: SYSTEM_CEILINGS.MAX_VAULTS,
  maxRecipients: SYSTEM_CEILINGS.MAX_RECIPIENTS,
  maxDepegThresholdBps: SYSTEM_CEILINGS.MAX_DEPEG_THRESHOLD_BPS,
  maxVaultDrawdownBps: SYSTEM_CEILINGS.MAX_VAULT_DRAWDOWN_BPS,
  minRiskThresholdBps: SYSTEM_CEILINGS.MIN_RISK_THRESHOLD_BPS,
});

/** The limits the owner must end up with a number for. */
const MANDATE_NUMBERS = [
  'runwayBufferUsdc',
  'perTxUsdc',
  'dailyUsdc',
  'approvalThresholdUsdc',
] as const satisfies readonly (keyof ServMandate)[];

const KINDS: readonly ProposalKind[] = [
  'pull_allowance',
  'vault_deposit',
  'vault_withdraw',
  'pay_recipient',
  'risk_exit',
  'noop',
];

/**
 * Task 4.4. The model turns English into a draft; `validatePolicyDraft` decides whether that draft
 * is allowed to exist. Ceilings, shapes and addresses are never the model's business: addresses come
 * from the owner's binding, and a draft above a ceiling is rejected (not clamped) with issues the UI
 * can show. The owner still has to read and sign it.
 */
export async function compileMandate(input: CompileInput): Promise<CompileOutcome> {
  const res = await callJson({
    client: input.client,
    task: 'compile',
    model: input.model,
    prompt: buildCompilerPrompt({
      mandateText: input.mandateText,
      vaults: input.binding.vaults.map((v) => ({ id: v.id, name: v.name })),
      recipients: input.binding.recipients.map((r) => ({ id: r.id, label: r.label })),
      ceilings: ceilingsForPrompt(),
      allowedKinds: KINDS,
    }),
    schema: SERV_SCHEMAS.compile,
    parser: zServMandate,
  });

  if (!res.ok) {
    return {
      sentences: [],
      assumptions: [],
      questions: [],
      issues: [
        {
          path: '',
          code: 'MISSING',
          message: `The mandate compiler is unavailable (${res.error.error.code}).`,
          suggestion: 'Start from a template and edit it, or try again in a minute.',
        },
      ],
      meta: res.error.meta,
    };
  }

  const out = res.value.value;
  const extraQuestions = unknownIds(out, input.binding);

  // A limit the mandate never stated is a question for the owner, never a number we invent.
  const missing = MANDATE_NUMBERS.filter((f) => out[f] === '');
  if (missing.length > 0) {
    return {
      sentences: [],
      assumptions: out.assumptions,
      questions: [...out.questions, ...extraQuestions],
      issues: missing.map((path) => ({
        path,
        code: 'MISSING' as const,
        message: 'The mandate does not say what this limit should be.',
        suggestion: 'Answer the question below, or start from a template and edit it.',
      })),
      meta: res.value.meta,
    };
  }

  const draftInput = toDraft(out, input.binding);
  const validated = validatePolicyDraft(draftInput);

  if (!validated.ok) {
    return {
      sentences: [],
      issues: validated.error,
      assumptions: out.assumptions,
      questions: [...out.questions, ...extraQuestions],
      meta: res.value.meta,
    };
  }
  return {
    draft: validated.value,
    sentences: renderPolicyAsSentences(validated.value),
    issues: [],
    assumptions: out.assumptions,
    questions: [...out.questions, ...extraQuestions],
    meta: res.value.meta,
  };
}

const micro = (usd: string, fallback = '0'): string => {
  const r = parseUnits(usd || fallback, 6);
  return r.ok ? r.value.toString() : fallback;
};

/**
 * Model numbers + owner addresses → a draft shaped for the validator. Vaults and recipients are
 * driven by the BINDING, not by the model: the model can only tune the numbers of entries the owner
 * already created, and anything it invented is dropped here (and surfaced as a question).
 */
export function toDraft(out: ServMandate, binding: TemplateBinding): Record<string, unknown> {
  const vaultBps = new Map(out.vaults.map((v) => [v.id, v.maxAllocationBps]));
  const recipientRow = new Map(out.recipients.map((r) => [r.id, r]));

  const byKind: Partial<Record<ProposalKind, string>> = {};
  if (out.approvalThresholdVaultDepositUsdc) {
    byKind.vault_deposit = micro(out.approvalThresholdVaultDepositUsdc);
  }

  const autonomous: ProposalKind[] = out.autonomousKinds.filter((k) =>
    (KINDS as readonly string[]).includes(k),
  );

  return {
    chainId: binding.chainId,
    treasuryAddress: binding.treasuryAddress,
    tokens: [{ symbol: 'USDC', address: binding.usdcAddress, decimals: 6 }],
    vaults: binding.vaults.map((v) => ({
      id: v.id,
      name: v.name,
      address: v.address,
      asset: binding.usdcAddress,
      kind: 'erc4626',
      maxAllocationBps: vaultBps.get(v.id) ?? v.maxAllocationBps,
    })),
    recipients: binding.recipients.map((r) => {
      const row = recipientRow.get(r.id);
      const schedule =
        row && row.scheduleDayOfMonth > 0
          ? {
              dayOfMonth: row.scheduleDayOfMonth,
              amountMicroUsd: micro(row.scheduleAmountUsdc || '0'),
            }
          : r.schedule;
      return {
        id: r.id,
        label: r.label,
        address: r.address,
        // Empty maxPerTxUsdc means "the mandate doesn't say" (same convention as MANDATE_NUMBERS
        // above), not "zero" — the recipient's own signed per-tx cap (set when they were added,
        // via /api/policy/recipients) stays authoritative unless the model actually gave a number.
        // Without this check, a recipient the mandate text never mentions (e.g. one added after the
        // mandate was last written) got maxPerTxMicroUsd=0 from `micro('')`'s fallback, which fails
        // R06's BELOW_FLOOR check and made the whole policy refuse to compile.
        maxPerTxMicroUsd: row?.maxPerTxUsdc ? micro(row.maxPerTxUsdc) : r.maxPerTxMicroUsd,
        ...(schedule ? { schedule } : {}),
      };
    }),
    limits: {
      perTxMicroUsd: micro(out.perTxUsdc),
      dailyMicroUsd: micro(out.dailyUsdc),
      maxActionsPerHour: out.maxActionsPerHour,
    },
    runwayBufferMicroUsd: micro(out.runwayBufferUsdc),
    approvalThresholdMicroUsd: micro(out.approvalThresholdUsdc),
    ...(Object.keys(byKind).length > 0 ? { approvalThresholdByKind: byKind } : {}),
    depegThresholdBps: out.depegThresholdBps,
    vaultDrawdownBps: out.vaultDrawdownBps,
    autonomousKinds: autonomous.includes('noop') ? autonomous : [...autonomous, 'noop'],
  };
}

/** Ids the model referenced that the owner never created — a question, never a silent addition. */
function unknownIds(out: ServMandate, binding: TemplateBinding): string[] {
  const vaults = new Set(binding.vaults.map((v) => v.id));
  const recipients = new Set(binding.recipients.map((r) => r.id));
  const questions: string[] = [];
  for (const v of out.vaults) {
    if (!vaults.has(v.id))
      questions.push(
        `The mandate mentions a vault "${v.id.slice(0, 32)}" that you have not added. Add it first?`,
      );
  }
  for (const r of out.recipients) {
    if (!recipients.has(r.id))
      questions.push(
        `The mandate mentions a recipient "${r.id.slice(0, 32)}" that you have not added. Add them first?`,
      );
  }
  return questions;
}
