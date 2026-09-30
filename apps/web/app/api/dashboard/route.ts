import { NextResponse } from 'next/server';
import { getAddress } from 'viem';
import {
  countDeniedVerdicts,
  getActivePolicyBody,
  getVerdictForDecision,
  latestAgentAudit,
  listAgentDecisions,
  listApprovals,
  listVaultRows,
} from '@thesauros/db';
import { getEnv, zPolicy, type Policy } from '@thesauros/shared';
import {
  getBalances,
  getUsycPriceMicroUsd,
  getVaultPosition,
  publicClientFor,
} from '@thesauros/wallet';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { toDecisionItem } from '@/lib/decisions';
import { db } from '@/lib/db';

const WORKER_STALE_MS = 5 * 60 * 1000;

export async function GET(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const env = getEnv();
  const database = db();
  const wallet = auth.wallet;

  const [policyRow, pendingApprovals, denied, heartbeat, vaultRows, recentDecisions] =
    await Promise.all([
      getActivePolicyBody(database, wallet.id),
      listApprovals(database, wallet.id, 'pending'),
      countDeniedVerdicts(database, wallet.id),
      latestAgentAudit(database, wallet.id),
      listVaultRows(database, wallet.id),
      listAgentDecisions(database, wallet.id, { limit: 10 }),
    ]);

  let balances = { treasuryUsdc: '0', agentUsdc: '0' };
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
        treasuryUsdc: bal.value.treasuryUsdc.toString(),
        agentUsdc: bal.value.agentUsdc.toString(),
      };
    }
    // D-024: fetched once, not per vault — every usyc_teller-kind vault on Arc shares the one real
    // USYC deployment, so there is exactly one price to look up regardless of how many vault rows
    // reference it.
    const usycPrice = vaultRows.some((v) => v.kind === 'usyc_teller')
      ? await getUsycPriceMicroUsd()
      : null;
    const positions = await Promise.all(
      vaultRows.map(async (v) => {
        const pos =
          v.kind === 'usyc_teller'
            ? usycPrice?.ok
              ? await getVaultPosition(publicClient, {
                  vault: getAddress(v.address),
                  holder: agentWalletAddress,
                  kind: 'usyc_teller',
                  shareToken: getAddress(env.USYC_ADDRESS),
                  sharePriceMicroUsd: usycPrice.value,
                })
              : null
            : await getVaultPosition(publicClient, {
                vault: getAddress(v.address),
                holder: agentWalletAddress,
              });
        if (!pos || !pos.ok) return null;
        return {
          id: v.id,
          name: v.name,
          assets: pos.value.assets.toString(),
          redeemableAssets: pos.value.redeemableAssets.toString(),
        };
      }),
    );
    vaultPositions = positions.filter((p): p is NonNullable<typeof p> => p !== null);
  }

  const decisionsWithVerdicts = await Promise.all(
    recentDecisions.map(async (row) =>
      toDecisionItem(row, await getVerdictForDecision(database, row.id)),
    ),
  );

  const policy = policyRow ? (zPolicy.parse(policyRow.body) as Policy) : null;
  const lastLoopAt = heartbeat?.createdAt.toISOString() ?? null;
  const paused =
    heartbeat === undefined || Date.now() - heartbeat.createdAt.getTime() > WORKER_STALE_MS;

  return NextResponse.json({
    wallet: {
      id: wallet.id,
      chainId: wallet.chainId,
      treasuryAddress: wallet.treasuryAddress,
      agentWalletAddress: wallet.agentWalletAddress,
      frozen: wallet.frozen,
      breakerOpen: wallet.breakerOpen,
    },
    degraded: !env.SERV_API_KEY,
    paused,
    lastLoopAt,
    demoMode: env.DEMO_MODE,
    balances,
    vaultPositions,
    policy:
      policy && policyRow
        ? {
            version: policyRow.version,
            runwayBufferMicroUsd: policy.runwayBufferMicroUsd.toString(),
            perTxMicroUsd: policy.limits.perTxMicroUsd.toString(),
            dailyMicroUsd: policy.limits.dailyMicroUsd.toString(),
          }
        : null,
    pendingApprovals: pendingApprovals.length,
    maxAtRiskMicroUsd: (
      BigInt(balances.agentUsdc) + vaultPositions.reduce((sum, v) => sum + BigInt(v.assets), 0n)
    ).toString(),
    recent: decisionsWithVerdicts,
    security: { blockedCount: denied.count, lastCheckAt: denied.lastAt?.toISOString() ?? null },
    asOf: new Date().toISOString(),
  });
}
