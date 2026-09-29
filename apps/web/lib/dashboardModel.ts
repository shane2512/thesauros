// Pure view-model helpers for the dashboard. bigint in, display numbers out; the only `number`s are
// 0..100 bar widths (I12). Nothing here decides anything: it arranges values the server computed.
//
// Steward's own version also computed an `allowanceView` (the Spend Permission limit-line meter) —
// dropped here, not adapted: Circle's model has no per-wallet on-chain allowance to visualize
// (D-012/D-019 item 9). The Policy Engine's own per-tx/daily caps (R06/R07) are the real limit, and
// those are per-proposal, not a single running balance worth a meter.
import { pctOf, toBig } from './format';
import type { Dashboard } from './contracts';

/** Everything in play: treasury + agent wallet + every vault position. */
export function totalManaged(d: Pick<Dashboard, 'balances' | 'vaultPositions'>): bigint {
  return (
    toBig(d.balances.treasuryUsdc) +
    toBig(d.balances.agentUsdc) +
    d.vaultPositions.reduce((sum, v) => sum + toBig(v.assets), 0n)
  );
}

export const liquid = (d: Pick<Dashboard, 'balances'>): bigint =>
  toBig(d.balances.treasuryUsdc) + toBig(d.balances.agentUsdc);

export type RunwayView = {
  liquid: bigint;
  buffer: bigint | null;
  fillPct: number;
  covered: boolean | null;
};

/** Liquid funds against the runway buffer the policy asks Thesauros to keep (R08). */
export function runwayView(d: Dashboard): RunwayView {
  const l = liquid(d);
  const buffer = d.policy ? toBig(d.policy.runwayBufferMicroUsd) : null;
  if (buffer === null || buffer <= 0n) return { liquid: l, buffer, fillPct: 0, covered: null };
  // full bar == twice the buffer, so "just covered" reads as half-way and a shortfall is visible
  return { liquid: l, buffer, fillPct: pctOf(l, buffer * 2n), covered: l >= buffer };
}

/** `14:02` local, for "as of" indicators. */
export function clockTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
