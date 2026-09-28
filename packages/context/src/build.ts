import { formatUnits, hashCanonical } from '@thesauros/shared';
import { sanitizeLabel, sanitizeText } from './sanitize';
import type { Context, ContextInput, Fact, UntrustedItem } from './types';

const F = {
  treasury: 'F_BAL_TREASURY_USDC',
  agent: 'F_BAL_AGENT_USDC',
  allowance: 'F_ALLOWANCE_REMAINING',
  price: 'F_PRICE_USDC',
  obligations: 'F_OBLIGATIONS_30D',
  outflows: 'F_OUTFLOWS_24H',
  vaultPosition: (id: string) => `F_VAULT_${id}_POSITION`,
  vaultApy: (id: string) => `F_VAULT_${id}_APY`,
  vaultRisk: (id: string) => `F_VAULT_${id}_RISK`,
  obligation: (id: string) => `OBL_${id}`,
} as const;

const secondsBetween = (a: Date, b: Date) =>
  Math.max(0, Math.floor((a.getTime() - b.getTime()) / 1000));

/**
 * Pure context assembly (ARCHITECTURE §5 step 1, SERV_REASONING §3). No I/O, no clock, no env: the
 * caller gathers, this shapes. Every number the model may reason about becomes a fact with a stable
 * id so a proposal can cite it and `groundProposal` can check it.
 */
export function buildContext(input: ContextInput): Context {
  const usd = (v: bigint) => formatUnits(v, input.decimals);
  const facts: Fact[] = [
    {
      id: F.treasury,
      value: usd(input.balances.treasuryUsdc),
      unit: 'USDC',
      baseUnits: input.balances.treasuryUsdc,
    },
    {
      id: F.agent,
      value: usd(input.balances.agentUsdc),
      unit: 'USDC',
      baseUnits: input.balances.agentUsdc,
    },
    {
      id: F.allowance,
      value: usd(input.balances.allowanceRemaining),
      unit: 'USDC',
      baseUnits: input.balances.allowanceRemaining,
      ...(input.balances.allowancePeriodEnds
        ? { periodEnds: input.balances.allowancePeriodEnds.toISOString() }
        : {}),
    },
    {
      id: F.price,
      value: formatUnits(input.priceUsdc.microUsd, 6),
      unit: 'USD',
      ageSec: secondsBetween(input.now, input.priceUsdc.publishedAt),
    },
    {
      id: F.outflows,
      value: usd(input.outflowsLast24hBaseUnits),
      unit: 'USDC',
      baseUnits: input.outflowsLast24hBaseUnits,
    },
  ];

  const obligationsTotal = input.obligations.reduce((s, o) => s + o.amountBaseUnits, 0n);
  facts.push({
    id: F.obligations,
    value: usd(obligationsTotal),
    unit: 'USDC',
    baseUnits: obligationsTotal,
    items: input.obligations.map((o) => F.obligation(o.id)),
  });
  for (const o of input.obligations) {
    facts.push({
      id: F.obligation(o.id),
      value: usd(o.amountBaseUnits),
      unit: 'USDC',
      baseUnits: o.amountBaseUnits,
      source: `due ${o.dueDate.toISOString().slice(0, 10)} to ${o.recipientId}`,
    });
  }

  for (const v of input.vaults) {
    facts.push({
      id: F.vaultPosition(v.id),
      value: usd(v.positionBaseUnits),
      unit: 'USDC',
      baseUnits: v.positionBaseUnits,
    });
    if (v.apyPct !== undefined) {
      facts.push({
        id: F.vaultApy(v.id),
        value: sanitizeLabel(v.apyPct, 16),
        unit: '%',
        ...(v.apySource ? { source: sanitizeLabel(v.apySource, 24) } : {}),
      });
    }
    if (v.flagged) {
      facts.push({ id: F.vaultRisk(v.id), value: 'flagged', source: 'risk trigger' });
    }
  }
  for (const t of input.riskTriggers) {
    facts.push({
      id: F.vaultRisk(t.vaultId),
      value: sanitizeLabel(t.trigger, 32),
      source: sanitizeLabel(t.observed, 80),
    });
  }

  const untrusted: UntrustedItem[] = input.untrusted.map((u) => {
    const s = sanitizeText(u.text);
    return {
      id: u.id,
      source: sanitizeLabel(u.source, 40),
      text: s.text,
      signals: s.signals,
    };
  });

  const context: Omit<Context, 'snapshotHash'> = {
    now: input.now.toISOString(),
    facts,
    policySummary: input.policySummary.map((s) => sanitizeLabel(s, 200)),
    allowedKinds: [...input.allowedKinds],
    vaults: input.vaults.map((v) => ({ id: v.id, name: sanitizeLabel(v.name) })),
    recipients: input.recipients.map((r) => ({ id: r.id, label: sanitizeLabel(r.label) })),
    untrusted,
    screen: { injectionSuspected: false, signals: [] },
  };

  return { snapshotHash: hashCanonical(context), ...context };
}

/** Every fact id in a context — what R19's `contextFactIds` is built from. */
export const factIds = (ctx: Context): string[] => ctx.facts.map((f) => f.id);

export const FACT_IDS = F;
