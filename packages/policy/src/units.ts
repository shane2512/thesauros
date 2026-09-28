// Task 3.5 — unit conversion between token base units and micro-USD, bigint only (I12).
//
// The price always comes from `input.state.prices` (the oracle). A stable is NEVER assumed to be
// worth $1: that assumption is exactly what a depeg breaks, and R12 exists to notice. The single
// exception is the explicitly-passed DEMO fallback (I11), which only applies on Base Sepolia and
// only when no quote exists at all.
import {
  SYSTEM_CEILINGS,
  addressEquals,
  err,
  ok,
  toMicroUsd,
  type Address,
  type ParsedEvaluationInput,
  type Policy,
  type PolicyToken,
  type PriceQuote,
  type Proposal,
  type Result,
} from '@thesauros/shared';

export const ONE_USD_MICRO = 1_000_000n;
const DEMO_CHAIN_ID = 5042002; // Arc testnet (docs/VERIFY.md row 1)

/** MVP: the policy holds exactly one token, USDC. */
export function usdcToken(policy: Policy): PolicyToken | undefined {
  return policy.tokens.find((t) => t.symbol === 'USDC');
}

/** Record lookup that is not fooled by address casing (records come from JSON/DB). */
export function byAddress<T>(record: Record<string, T>, address: string): T | undefined {
  for (const [key, value] of Object.entries(record)) {
    if (addressEquals(key, address)) return value;
  }
  return undefined;
}

/** The oracle quote for a token, or the fenced demo fallback. */
export function priceOf(
  input: ParsedEvaluationInput,
  token: Address,
): Result<{ quote: PriceQuote; demoFallback: boolean }, string> {
  const quote = byAddress(input.state.prices, token);
  if (quote) return ok({ quote, demoFallback: false });
  // I11: fenced — explicit caller flag AND testnet. Never overrides a real quote.
  if (input.demoStableParity && input.chainId === DEMO_CHAIN_ID) {
    return ok({ quote: { microUsd: ONE_USD_MICRO, publishedAt: input.now }, demoFallback: true });
  }
  return err(`no price for token ${token}`);
}

/** Token base units -> micro-USD at the given quote. Floors (never rounds a limit up). */
export function baseUnitsToMicroUsd(
  amount: bigint,
  decimals: number,
  quote: PriceQuote,
): Result<bigint, string> {
  if (quote.microUsd <= 0n) return err('price must be > 0');
  return ok(toMicroUsd(amount, decimals, quote.microUsd));
}

/** micro-USD -> token base units at the given quote. Floors. */
export function microUsdToBaseUnits(
  microUsd: bigint,
  decimals: number,
  quote: PriceQuote,
): Result<bigint, string> {
  if (quote.microUsd <= 0n) return err('price must be > 0');
  return ok((microUsd * 10n ** BigInt(decimals)) / quote.microUsd);
}

/** The USDC base-unit amount a proposal moves, or null for kinds that carry no amount. */
export function proposalAmountBaseUnits(proposal: Proposal): bigint | null {
  switch (proposal.kind) {
    case 'pull_allowance':
    case 'vault_deposit':
    case 'vault_withdraw':
    case 'pay_recipient':
      return proposal.params.amount;
    default:
      return null;
  }
}

/**
 * Everything the size rules (R06–R10) need, valued ONCE at one oracle quote.
 *
 * Deliberately a single fallible step: if the price is missing, zero or the policy has no token,
 * no number in here exists, and every rule that would have used one denies. Valuing each figure
 * separately would leave rules asking "what if the amount converted but the balance did not",
 * which cannot happen and cannot be tested.
 */
export type Valuation = {
  quote: PriceQuote;
  demoFallback: boolean;
  /** The proposal's amount in micro-USD; 0 for kinds that carry no amount. */
  amountMicroUsd: bigint;
  /** Liquid USDC (agent + treasury). */
  liquidMicroUsd: bigint;
  /** Liquid USDC plus every position in a vault the Policy allowlists. */
  managedMicroUsd: bigint;
  /** The position in one policy vault, 0 if there is none. */
  vaultPositionMicroUsd: (vaultId: string) => bigint;
};

export function valueInput(input: ParsedEvaluationInput): Result<Valuation, string> {
  const token = usdcToken(input.policy);
  if (!token) return err('policy has no USDC token');
  const price = priceOf(input, token.address);
  if (!price.ok) return err(price.error);
  const quote = price.value.quote;
  if (quote.microUsd <= 0n) return err('price must be > 0');

  const toMicro = (base: bigint) => toMicroUsd(base, token.decimals, quote.microUsd);
  const amount = proposalAmountBaseUnits(input.proposal);
  const liquid = input.state.agentUsdc + input.state.treasuryUsdc;
  // Only allowlisted vaults count: a stray entry in the state map must not be able to inflate the
  // denominator R09 divides by.
  const positions = input.policy.vaults.reduce(
    (total, v) => total + (input.state.vaultPositions[v.id] ?? 0n),
    0n,
  );
  return ok({
    quote,
    demoFallback: price.value.demoFallback,
    amountMicroUsd: amount === null ? 0n : toMicro(amount),
    liquidMicroUsd: toMicro(liquid),
    managedMicroUsd: toMicro(liquid + positions),
    vaultPositionMicroUsd: (vaultId) => toMicro(input.state.vaultPositions[vaultId] ?? 0n),
  });
}

/** Deviation from $1.00 in basis points, bigint math (no float, no precision loss). */
export function depegBps(quote: PriceQuote): bigint {
  const diff =
    quote.microUsd > ONE_USD_MICRO
      ? quote.microUsd - ONE_USD_MICRO
      : ONE_USD_MICRO - quote.microUsd;
  return (diff * 10_000n) / ONE_USD_MICRO;
}

/** Quote age in whole seconds. Negative when the quote is stamped in the future. */
export function quoteAgeSeconds(quote: PriceQuote, now: Date): number {
  return Math.floor((now.getTime() - quote.publishedAt.getTime()) / 1000);
}

export const PRICE_MAX_AGE_SEC = SYSTEM_CEILINGS.PRICE_MAX_AGE_SEC;
