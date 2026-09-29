// Pure helpers for the add-recipient form. No I/O, so both can be tested directly.
//
// IMPORTANT: `looksLikeExisting` is a WARNING ONLY. Thesauros matches the allowlist by exact
// checksummed equality (I4, rule R05); nothing here relaxes, widens or influences that. Its whole
// job is to make an owner look twice at an address that shares a prefix or suffix with one they
// already pay, because that is what an address-poisoning attack is built to exploit (T3).
import { parseUnits, USDC_DECIMALS, type Result } from '@thesauros/shared/client';

/** How many leading / trailing hex characters must coincide before we say "check this". */
const EDGE = 4;

export function looksLikeExisting(
  candidate: string,
  existing: readonly { label: string; address: string }[],
): { label: string; address: string } | null {
  const a = candidate.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) return null;
  for (const r of existing) {
    const b = r.address.toLowerCase();
    if (b === a) continue; // identical is a duplicate, not a look-alike
    const samePrefix = a.slice(2, 2 + EDGE) === b.slice(2, 2 + EDGE);
    const sameSuffix = a.slice(-EDGE) === b.slice(-EDGE);
    if (samePrefix || sameSuffix) return r;
  }
  return null;
}

/** `1,200.50` -> 1_200_500_000n. Rejects anything that is not a plain amount (I12: no JS number). */
export function parseUsdc(input: string): Result<bigint> {
  return parseUnits(input.replace(/,/g, '').trim(), USDC_DECIMALS);
}

/** `0x1d4f2a…` shown as first 6 and last 6, the confirmation screen's compact form. */
export function sixAndSix(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}
