// RFB 5 (I13) — continuous compliance screening. A deterministic scheduler (not this file) calls
// this once per counterparty on a cadence; the output feeds `recipients.riskTier`, which
// `packages/policy`'s R22 reads to clamp an autonomous cap. This task is explicitly NOT a payment
// authorization: it has no path to `executor.ts` and never will (enforced by
// `.dependency-cruiser.cjs`'s `owner-path-no-reasoning` rule covering the scheduler's own module).
import { callJson, type CallMeta } from './call';
import { buildCounterpartyScreenPrompt } from './prompts';
import { SERV_SCHEMAS, zServCounterpartyScreen } from './schemas';
import type { ServClient } from './serv/client';

export type CounterpartyScreenInput = {
  client: ServClient;
  model: string;
  label: string;
  address: string;
  chainId: number;
  previousTier?: 'low' | 'medium' | 'high';
  signals: readonly string[];
};

/**
 * `ok: false` means "no verdict this cycle" — the caller must NOT touch the stored tier. A failed
 * re-screen is not evidence of anything; overwriting a prior `medium`/`high` with `low` on a
 * transport error would silently clear a real flag, and inventing `high` on a failure would be
 * just as wrong the other way (I5 — fail closed means "don't guess," not "always deny").
 */
export type CounterpartyScreenOutcome =
  | { ok: true; tier: 'low' | 'medium' | 'high'; reasons: string[]; meta?: CallMeta }
  | { ok: false; reason: string; meta?: CallMeta };

export async function screenCounterparty(
  input: CounterpartyScreenInput,
): Promise<CounterpartyScreenOutcome> {
  const res = await callJson({
    client: input.client,
    task: 'counterparty',
    model: input.model,
    prompt: buildCounterpartyScreenPrompt(input),
    schema: SERV_SCHEMAS.counterparty,
    parser: zServCounterpartyScreen,
  });

  if (!res.ok) {
    return {
      ok: false,
      reason: `${res.error.error.code}: ${res.error.error.message}`,
      meta: res.error.meta,
    };
  }

  const out = res.value.value;
  return { ok: true, tier: out.tier, reasons: out.reasons, meta: res.value.meta };
}
