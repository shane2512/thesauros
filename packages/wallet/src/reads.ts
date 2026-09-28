// 2.6 — read models. Pure reads through viem (never AgentKit actions: those return decimal strings
// and money is bigint, I12). Nothing here can write.
import type { PublicClient } from 'viem';
import { err, ok, type Address, type Result } from '@thesauros/shared';
import { ERC20_ABI, ERC4626_ABI, MOCK_PRICE_FEED_ABI } from './abi';

export type Balances = { treasuryUsdc: bigint; agentUsdc: bigint };

export async function getBalances(
  publicClient: PublicClient,
  args: { usdc: Address; treasuryAddress: Address; agentWalletAddress: Address },
): Promise<Result<Balances>> {
  try {
    const [treasuryUsdc, agentUsdc] = await Promise.all([
      publicClient.readContract({
        address: args.usdc,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [args.treasuryAddress],
      }),
      publicClient.readContract({
        address: args.usdc,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [args.agentWalletAddress],
      }),
    ]);
    return ok({ treasuryUsdc, agentUsdc });
  } catch (e) {
    return err(`balance read failed: ${String(e)}`);
  }
}

export type VaultPositionRead = {
  shares: bigint;
  /** `convertToAssets(shares)` — the position's value. */
  assets: bigint;
  /** `maxWithdraw(holder)` — what a redeem would actually pay out now. Used for `sweep_home`. */
  redeemableAssets: bigint;
};

export async function getVaultPosition(
  publicClient: PublicClient,
  args: { vault: Address; holder: Address },
): Promise<Result<VaultPositionRead>> {
  try {
    const shares = await publicClient.readContract({
      address: args.vault,
      abi: ERC4626_ABI,
      functionName: 'balanceOf',
      args: [args.holder],
    });
    const [assets, redeemableAssets] = await Promise.all([
      publicClient.readContract({
        address: args.vault,
        abi: ERC4626_ABI,
        functionName: 'convertToAssets',
        args: [shares],
      }),
      publicClient.readContract({
        address: args.vault,
        abi: ERC4626_ABI,
        functionName: 'maxWithdraw',
        args: [args.holder],
      }),
    ]);
    return ok({ shares, assets, redeemableAssets });
  } catch (e) {
    return err(`vault position read failed: ${String(e)}`);
  }
}

/**
 * Assets per whole share, in asset base units (micro-USD for a USDC vault).
 * Conversions round down by up to 1 base unit (OZ 5.x virtual assets) — callers must tolerate dust.
 */
export async function getSharePrice(
  publicClient: PublicClient,
  vault: Address,
): Promise<Result<{ sharePrice: bigint; shareDecimals: number; totalAssets: bigint }>> {
  try {
    const [shareDecimals, totalAssets] = await Promise.all([
      publicClient.readContract({ address: vault, abi: ERC4626_ABI, functionName: 'decimals' }),
      publicClient.readContract({ address: vault, abi: ERC4626_ABI, functionName: 'totalAssets' }),
    ]);
    const sharePrice = await publicClient.readContract({
      address: vault,
      abi: ERC4626_ABI,
      functionName: 'convertToAssets',
      args: [10n ** BigInt(shareDecimals)],
    });
    return ok({ sharePrice, shareDecimals, totalAssets });
  } catch (e) {
    return err(`share price read failed: ${String(e)}`);
  }
}

/** Demo oracle read (DEMO_MODE + chain 84532 only, I11). Price is micro-USD. */
export async function getMockPrice(
  publicClient: PublicClient,
  feed: Address,
): Promise<Result<{ microUsd: bigint; updatedAt: bigint }>> {
  try {
    const [microUsd, updatedAt] = await publicClient.readContract({
      address: feed,
      abi: MOCK_PRICE_FEED_ABI,
      functionName: 'latestPrice',
    });
    return ok({ microUsd, updatedAt });
  } catch (e) {
    return err(`price feed read failed: ${String(e)}`);
  }
}

/** "Maximum at risk" (SECURITY §3 L1): what a full compromise of the agent could reach right now. */
export function maxAtRisk(input: {
  agentUsdc: bigint;
  vaultAssets: bigint;
  allowanceRemaining: bigint;
}): bigint {
  return input.agentUsdc + input.vaultAssets + input.allowanceRemaining;
}
