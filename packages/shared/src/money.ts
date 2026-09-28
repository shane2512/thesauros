// I12: money is bigint base units; USD is integer micro-USD (6 decimals). No floats anywhere.
import { err, ok, type Result } from './result';

export const USDC_DECIMALS = 6;

/** Parse a non-negative decimal string ("12.5") into base units. Rejects floats, signs, excess precision. */
export function parseUnits(input: string, decimals: number): Result<bigint> {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(input);
  if (!m) return err(`invalid decimal amount: ${input}`);
  const frac = m[2] ?? '';
  if (frac.length > decimals) return err(`too many decimal places (max ${decimals})`);
  return ok(BigInt((m[1] ?? '0') + frac.padEnd(decimals, '0')));
}

/** Format base units as a decimal string with trailing zeros trimmed. */
export function formatUnits(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const s = (neg ? -value : value).toString().padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** Token base units -> micro-USD, given the token's decimals and its price in micro-USD per whole token. Floors. */
export function toMicroUsd(amount: bigint, tokenDecimals: number, priceMicroUsd: bigint): bigint {
  return (amount * priceMicroUsd) / 10n ** BigInt(tokenDecimals);
}

/** Strict decimal-string base-unit amount (API boundary): digits only. */
export function parseBaseUnits(input: string): Result<bigint> {
  return /^\d+$/.test(input) ? ok(BigInt(input)) : err(`invalid base-unit amount: ${input}`);
}
