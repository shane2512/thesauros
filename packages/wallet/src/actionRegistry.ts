// Turns an evaluated Proposal into the calls that would carry it out, and the deterministic hash
// `execute()` uses as its idempotency key (I10). Building the real Circle/Arc calls (Paymaster
// policy call, USYC deposit/redeem, CCTP transfer, a plain USDC transfer) is Phase 2 work — until
// then this returns `NOT_IMPLEMENTED`, which `runPipeline` already treats as "no calls" and DENIES
// (R11), so nothing can move funds through this path before Phase 2 lands.
import { keccak256, toHex } from 'viem';
import {
  err,
  type Address,
  type Hex,
  type Policy,
  type Proposal,
  type Result,
} from '@thesauros/shared';
import type { SpendPermission } from './spendPermission';

export type Call = { to: Address; data: Hex; value: bigint };

/** A vault position as read from the chain: shares held, and what a redeem would pay out now. */
export type VaultPosition = { shares: bigint; redeemableAssets: bigint };

export type BuildContext = {
  agentWalletAddress: Address;
  spendPermissionManagerAddress: Address;
  spendPermission?: SpendPermission;
  agentUsdcBalance: bigint;
  vaultPositions: Record<string, VaultPosition>;
  allowMainnet: boolean;
};

export type BuildCallsErrorCode = 'NOT_IMPLEMENTED' | 'UNKNOWN_VAULT' | 'UNKNOWN_RECIPIENT';
export type BuildCallsError = { code: BuildCallsErrorCode; message: string };

export function buildCalls(
  proposal: Proposal,
  policy: Policy,
  ctx: BuildContext,
): Result<Call[], BuildCallsError> {
  void proposal;
  void policy;
  void ctx;
  return err({
    code: 'NOT_IMPLEMENTED',
    message:
      'buildCalls is not implemented yet — see docs/PHASES.md Phase 2 (Circle Agent Stack calls)',
  });
}

/** Pure and deterministic: same calls, same hash, every time (I10). */
export function callsHash(calls: readonly Call[]): Hex {
  const canonical = JSON.stringify(
    calls.map((c) => ({ to: c.to, data: c.data, value: c.value.toString() })),
  );
  return keccak256(toHex(canonical));
}
