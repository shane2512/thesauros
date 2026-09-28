import type { Context } from '@thesauros/context';
import { parseUnits, type Address, type Proposal } from '@thesauros/shared';
import { callJson, type CallMeta } from './call';
import { buildProposerPrompt } from './prompts';
import { SERV_SCHEMAS, zServProposal, type ServProposal } from './schemas';
import type { ServClient } from './serv/client';

/** I4: nothing the model says may contain a destination. */
export const ADDRESS_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;
const ENS_RE = /\b[a-z0-9-]{3,}\.(eth|xyz|crypto|lens)\b/i;

export type ProposeInput = {
  client: ServClient;
  model: string;
  ctx: Context;
  /** Filled in by us, never by the model: the token of every expected delta. */
  usdcAddress: Address;
  decimals: number;
};

export type ProposeOutcome = {
  proposal: Proposal;
  /** Empty when the model's proposal was accepted as-is. */
  issues: string[];
  meta?: CallMeta;
};

export function noopProposal(rationale: string): Proposal {
  return {
    kind: 'noop',
    params: {},
    expectedDeltas: [],
    rationale: rationale.slice(0, 600),
    citedFactIds: [],
    confidence: 1,
    source: 'serv',
  };
}

/**
 * Task 4.6. SERV JSON → zod → one repair retry → NOOP, then deterministic checks the model cannot
 * talk its way past: no addresses anywhere in its output, ids resolve inside the context, cited
 * facts exist, and no number exceeds the facts it claims to rest on.
 *
 * `source` is set here in code, never read from the model (RR-3).
 */
export async function propose(input: ProposeInput): Promise<ProposeOutcome> {
  const res = await callJson({
    client: input.client,
    task: 'propose',
    model: input.model,
    prompt: buildProposerPrompt(input.ctx),
    schema: SERV_SCHEMAS.propose,
    parser: zServProposal,
  });

  if (!res.ok) {
    return {
      proposal: noopProposal(`No usable proposal from SERV (${res.error.error.code}).`),
      issues: [`${res.error.error.code}: ${res.error.error.message}`],
      meta: res.error.meta,
    };
  }

  const mapped = mapProposal(res.value.value, input, res.value.meta.raw);
  if (!mapped.ok) {
    return {
      proposal: noopProposal(
        `Proposal rejected before evaluation: ${mapped.issues[0] ?? 'invalid'}.`,
      ),
      issues: mapped.issues,
      meta: res.value.meta,
    };
  }
  return { proposal: mapped.proposal, issues: [], meta: res.value.meta };
}

type MapResult = { ok: true; proposal: Proposal } | { ok: false; issues: string[] };

/** Exported for the adversarial suite, which feeds compromised model output straight in. */
export function mapProposal(
  out: ServProposal,
  input: Pick<ProposeInput, 'ctx' | 'usdcAddress' | 'decimals'>,
  rawTexts: readonly string[] = [],
): MapResult {
  const issues: string[] = [];
  const { ctx } = input;

  // 1. No destinations, anywhere in what the model produced.
  const surfaces = [
    ...rawTexts,
    out.vaultId,
    out.recipientId,
    out.obligationId,
    out.rationale,
    out.amountUsdc,
    ...out.citedFactIds,
  ];
  for (const s of surfaces) {
    if (ADDRESS_RE.test(s)) issues.push('model output contains a 20-byte address (I4)');
    else if (ENS_RE.test(s)) issues.push('model output contains an ENS-style name (I4)');
  }

  // 2. Only kinds this iteration allows.
  if (!ctx.allowedKinds.includes(out.kind))
    issues.push(`kind "${out.kind}" is not in allowedKinds`);

  // 3. Ids must resolve inside the context — this is the whole anti-poisoning design (T3).
  const needsVault =
    out.kind === 'vault_deposit' || out.kind === 'vault_withdraw' || out.kind === 'risk_exit';
  if (needsVault && !ctx.vaults.some((v) => v.id === out.vaultId)) {
    issues.push(`unknown vaultId "${out.vaultId.slice(0, 32)}"`);
  }
  if (out.kind === 'pay_recipient' && !ctx.recipients.some((r) => r.id === out.recipientId)) {
    issues.push(`unknown recipientId "${out.recipientId.slice(0, 32)}"`);
  }
  if (out.kind === 'risk_exit' && out.trigger === '') issues.push('risk_exit without a trigger');

  // 4. Grounding: cited facts must exist (R19 denies otherwise; catching it here saves a round trip).
  const factById = new Map(ctx.facts.map((f) => [f.id, f]));
  for (const id of out.citedFactIds) {
    if (!factById.has(id)) issues.push(`cited fact "${id.slice(0, 32)}" is not in the context`);
  }

  // 5. Amounts: parse, require > 0, and never above the facts they are drawn from.
  const needsAmount = out.kind !== 'noop' && out.kind !== 'risk_exit';
  let amount = 0n;
  if (needsAmount) {
    const parsed = parseUnits(out.amountUsdc || '0', input.decimals);
    if (!parsed.ok) issues.push(`unparseable amount "${out.amountUsdc.slice(0, 32)}"`);
    else amount = parsed.value;
    if (amount <= 0n) issues.push('amount must be greater than zero');

    const support = out.citedFactIds
      .map((id) => factById.get(id)?.baseUnits)
      .filter((v): v is bigint => typeof v === 'bigint');
    if (support.length === 0)
      issues.push('no cited fact carries a number that supports the amount');
    else if (amount > support.reduce((a, b) => (b > a ? b : a), 0n)) {
      issues.push('amount exceeds every fact it cites');
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  const common = {
    expectedDeltas: out.expectedDeltas.map((d) => ({
      token: input.usdcAddress,
      holder: d.holder,
      delta: parseSigned(d.amountUsdc, input.decimals),
    })),
    rationale: out.rationale.slice(0, 600),
    citedFactIds: out.citedFactIds,
    confidence: out.confidence,
    source: 'serv' as const,
  };

  switch (out.kind) {
    case 'noop':
      return { ok: true, proposal: { kind: 'noop', params: {}, ...common } };
    case 'pull_allowance':
      return { ok: true, proposal: { kind: 'pull_allowance', params: { amount }, ...common } };
    case 'vault_deposit':
      return {
        ok: true,
        proposal: { kind: 'vault_deposit', params: { vaultId: out.vaultId, amount }, ...common },
      };
    case 'vault_withdraw':
      return {
        ok: true,
        proposal: { kind: 'vault_withdraw', params: { vaultId: out.vaultId, amount }, ...common },
      };
    case 'pay_recipient':
      return {
        ok: true,
        proposal: {
          kind: 'pay_recipient',
          params: {
            recipientId: out.recipientId,
            amount,
            ...(out.obligationId ? { obligationId: out.obligationId } : {}),
          },
          ...common,
        },
      };
    case 'risk_exit':
      return {
        ok: true,
        proposal: {
          kind: 'risk_exit',
          params: {
            vaultId: out.vaultId,
            trigger: out.trigger === 'asset_depeg' ? 'asset_depeg' : 'vault_drawdown',
          },
          ...common,
        },
      };
  }
}

function parseSigned(value: string, decimals: number): bigint {
  const negative = value.startsWith('-');
  const parsed = parseUnits(negative ? value.slice(1) : value, decimals);
  if (!parsed.ok) return 0n;
  return negative ? -parsed.value : parsed.value;
}
