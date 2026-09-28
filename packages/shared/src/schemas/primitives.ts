import { getAddress, isAddress } from 'viem';
import { z } from 'zod';

/** Checksummed address; rejects bad checksums and non-addresses (I4). */
export const zAddress = z
  .string()
  .refine((v) => isAddress(v, { strict: true }), 'invalid address')
  .transform((v) => getAddress(v));

/**
 * Base-unit / micro-USD amount: bigint, or a decimal string (API/JSON boundary). Never a JS number.
 * Non-negative by construction: a negative amount is meaningless for money we hold or move, and
 * letting one through would invert every `<=` comparison in the Policy Engine (I12 / I5).
 */
export const zAmount = z
  .union([z.bigint(), z.string().regex(/^\d+$/, 'expected decimal digits')])
  .transform((v) => BigInt(v))
  .refine((v) => v >= 0n, 'amount must be >= 0');

/** A signed base-unit delta (balance changes can go either way). */
export const zSignedAmount = z
  .union([z.bigint(), z.string().regex(/^-?\d+$/, 'expected an optionally signed integer')])
  .transform((v) => BigInt(v));

export const zHex = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, 'expected 0x hex') as z.ZodType<`0x${string}`>;
export const zHash = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/, 'expected 32-byte lowercase hex') as z.ZodType<`0x${string}`>;
export const zChainId = z.union([z.literal(84532), z.literal(8453)]);
