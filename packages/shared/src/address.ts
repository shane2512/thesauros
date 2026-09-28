// I4: exact-match destinations by checksummed address equality. No ENS, no fuzzy matching.
import { getAddress, isAddress, type Address } from 'viem';
import { err, ok, type Result } from './result';

export type { Address };
/** 0x-prefixed hex string (same shape as viem's `Hex`); re-exported so pure packages need no viem. */
export type Hex = `0x${string}`;

/** Checksum an address. Strict: mixed-case input must already carry a valid checksum. */
export function checksum(input: string): Result<Address> {
  if (!isAddress(input, { strict: true })) return err(`invalid address: ${input}`);
  return ok(getAddress(input));
}

export function addressEquals(a: string, b: string): boolean {
  const ca = checksum(a);
  const cb = checksum(b);
  return ca.ok && cb.ok && ca.value === cb.value;
}
