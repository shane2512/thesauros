// Coinbase Spend Permissions (EIP-7715-ish, Base-specific). Arc has no equivalent primitive — the
// Circle Paymaster policy is what Phase 2 replaces this with (docs/MIGRATION.md, docs/VERIFY.md
// row 6). The type and the stored-row parser survive because the shape is generic enough to keep
// `gather.ts` compiling against a real, validated value; the on-chain read is the part that is
// actually Base-specific, and it stays a NotImplementedYet stub until Phase 2 lands.
import type { PublicClient } from 'viem';
import { err, ok, type Address, type Hex, type Result } from '@thesauros/shared';

export type SpendPermission = {
  account: Address;
  spender: Address;
  token: Address;
  allowance: bigint;
  period: number;
  start: number;
  end: number;
  salt: bigint;
  extraData: Hex;
};

function isHex(v: unknown): v is Hex {
  return typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v);
}

/** Validates a stored permission row's JSON body into a `SpendPermission`. Never throws. */
export function parseSpendPermission(raw: unknown): Result<SpendPermission, string> {
  if (typeof raw !== 'object' || raw === null) return err('spend permission row is not an object');
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : undefined;
  const big = (v: unknown): bigint | undefined => {
    try {
      if (typeof v === 'bigint') return v;
      if (typeof v === 'number' || typeof v === 'string') return BigInt(v);
      return undefined;
    } catch {
      return undefined;
    }
  };
  const account = r['account'];
  const spender = r['spender'];
  const token = r['token'];
  const allowance = big(r['allowance']);
  const period = num(r['period']);
  const start = num(r['start']);
  const end = num(r['end']);
  const salt = big(r['salt']);
  const extraData = r['extraData'];
  if (typeof account !== 'string' || typeof spender !== 'string' || typeof token !== 'string')
    return err('spend permission row is missing account/spender/token');
  if (
    allowance === undefined ||
    period === undefined ||
    start === undefined ||
    end === undefined ||
    salt === undefined
  )
    return err('spend permission row has a missing or unparseable numeric field');
  if (!isHex(extraData)) return err('spend permission row has a non-hex extraData');
  return ok({
    account: account as Address,
    spender: spender as Address,
    token: token as Address,
    allowance,
    period,
    start,
    end,
    salt,
    extraData,
  });
}

/**
 * Not implemented yet (Phase 2): reading remaining allowance requires the Base
 * `SpendPermissionManager` contract, which has no Arc deployment. A permission that cannot be read
 * is worth ZERO allowance to the caller (`gather.ts` already treats an `Err` this way), never
 * "unknown, assume fine" (I5).
 */
export async function readAllowanceRemaining(
  publicClient: PublicClient,
  managerAddress: Address,
  permission: SpendPermission,
): Promise<Result<bigint, string>> {
  void publicClient;
  void managerAddress;
  void permission;
  return err(
    'NOT_IMPLEMENTED: readAllowanceRemaining is Base SpendPermissionManager-specific; Phase 2 replaces it with the Circle Paymaster cap read',
  );
}
