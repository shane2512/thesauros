import { NextResponse } from 'next/server';
import { getAddress } from 'viem';
import {
  countDeniedVerdicts,
  getActivePolicyBody,
  latestAgentAudit,
  listApprovals,
  listVaultRows,
} from '@thesauros/db';
import { formatUnits, getEnv, USDC_DECIMALS } from '@thesauros/shared';
import { getBalances, getVaultPosition, publicClientFor } from '@thesauros/wallet';
import { requireWallet } from '@/lib/requireWallet';
import { db } from '@/lib/db';

export async function GET(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  const env = getEnv();
  const database = db();
  const wallet = auth.wallet;

  const [policy, pendingApprovals, denied, heartbeat, vaultRows] = await Promise.all([
    getActivePolicyBody(database, wallet.id),
    listApprovals(database, wallet.id, 'pending'),
    countDeniedVerdicts(database, wallet.id),
    latestAgentAudit(database, wallet.id),
    listVaultRows(database, wallet.id),
  ]);

  let balances: { treasuryUsdc: string; agentUsdc: string } | null = null;
  let vaultPositions: { id: string; name: string; assets: string; redeemableAssets: string }[] = [];
  if (wallet.agentWalletAddress) {
    const agentWalletAddress = getAddress(wallet.agentWalletAddress);
    const publicClient = publicClientFor(env);
    const bal = await getBalances(publicClient, {
      usdc: getAddress(env.USDC_ADDRESS),
      treasuryAddress: getAddress(wallet.treasuryAddress),
      agentWalletAddress,
    });
    if (bal.ok) {
      balances = {
        treasuryUsdc: formatUnits(bal.value.treasuryUsdc, USDC_DECIMALS),
        agentUsdc: formatUnits(bal.value.agentUsdc, USDC_DECIMALS),
      };
    }
    const positions = await Promise.all(
      vaultRows.map(async (v) => {
        const pos = await getVaultPosition(publicClient, {
          vault: getAddress(v.address),
          holder: agentWalletAddress,
        });
        if (!pos.ok) return null;
        return {
          id: v.id,
          name: v.name,
          assets: formatUnits(pos.value.assets, USDC_DECIMALS),
          redeemableAssets: formatUnits(pos.value.redeemableAssets, USDC_DECIMALS),
        };
      }),
    );
    vaultPositions = positions.filter((p): p is NonNullable<typeof p> => p !== null);
  }

  return NextResponse.json({
    wallet: {
      id: wallet.id,
      treasuryAddress: wallet.treasuryAddress,
      agentWalletAddress: wallet.agentWalletAddress,
      frozen: wallet.frozen,
      frozenReason: wallet.frozenReason,
      breakerOpen: wallet.breakerOpen,
      activePolicyVersion: wallet.activePolicyVersion,
    },
    balances,
    vaultPositions,
    policyVersion: policy?.version ?? null,
    pendingApprovals,
    deniedCount: denied.count,
    lastDeniedAt: denied.lastAt,
    workerHeartbeat: heartbeat ?? null,
  });
}
