// Owner-initiated sweep_home, run entirely inside this route — never via the worker's job queue
// (I7: sweep must work even if the worker or the reasoning API is down). This mirrors the slice of
// apps/worker/src/pipeline.ts's runPipeline that a sweep actually needs (build -> simulate ->
// evaluate -> receipt -> execute); the rest of that pipeline (context gathering, proposer/verifier,
// approvals) doesn't apply to a deterministic owner action and isn't reachable from apps/web anyway
// ("the web app may not import the worker" — packages/db/src/agent.ts).
import { getAddress } from 'viem';
import {
  appendAudit,
  insertAgentDecision,
  insertVerdict,
  updateAgentDecision,
  type Db,
  type Wallet,
} from '@thesauros/db';
import { evaluate, signReceipt, hashProposal } from '@thesauros/policy';
import { simulateProposalCalls } from '@thesauros/risk';
import { hashCanonical, zPolicy, type Env, type Policy, type Proposal } from '@thesauros/shared';
import {
  buildCalls,
  callsHash,
  execute,
  getBalances,
  publicClientFor,
  type BuildContext,
} from '@thesauros/wallet';

export type SweepOutcome =
  | { status: 'executed'; providerTxId: string; amountBaseUnits: string }
  | { status: 'denied'; reasons: string[] }
  | { status: 'failed'; reason: string };

export async function runOwnerSweep(
  db: Db,
  env: Env,
  wallet: Wallet,
  activePolicy: { version: number; body: unknown } | undefined,
  receiptKey: Uint8Array,
): Promise<SweepOutcome> {
  if (!wallet.agentWalletAddress)
    return { status: 'failed', reason: 'wallet has no agent wallet provisioned yet' };
  if (!activePolicy) return { status: 'failed', reason: 'wallet has no active policy' };

  const policy = zPolicy.parse(activePolicy.body) as Policy;
  const agentWalletAddress = getAddress(wallet.agentWalletAddress);
  const usdc = policy.tokens.find((t) => t.symbol === 'USDC')?.address;
  if (!usdc) return { status: 'failed', reason: 'policy has no USDC token' };

  const publicClient = publicClientFor(env);
  const balances = await getBalances(publicClient, {
    usdc,
    treasuryAddress: policy.treasuryAddress,
    agentWalletAddress,
  });
  if (!balances.ok) return { status: 'failed', reason: balances.error };
  const { agentUsdc } = balances.value;
  if (agentUsdc === 0n) return { status: 'failed', reason: 'agent wallet already holds 0 USDC' };

  const proposal: Proposal = {
    kind: 'sweep_home',
    params: {},
    expectedDeltas: [
      { token: usdc, holder: 'agent', delta: -agentUsdc },
      { token: usdc, holder: 'treasury', delta: agentUsdc },
    ],
    rationale: 'Owner-initiated sweep to treasury',
    citedFactIds: [],
    confidence: 1,
    source: 'owner',
  };

  const buildContext: BuildContext = {
    agentWalletAddress,
    spendPermissionManagerAddress: getAddress(env.SPEND_PERMISSION_MANAGER_ADDRESS),
    agentUsdcBalance: agentUsdc,
    vaultPositions: {},
    allowMainnet: env.THESAUROS_ALLOW_MAINNET,
  };
  const built = buildCalls(proposal, policy, buildContext);
  if (!built.ok) return { status: 'failed', reason: `${built.error.code}: ${built.error.message}` };
  const calls = built.value;
  const hash = callsHash(calls);

  const simulated = await simulateProposalCalls({
    publicClient,
    calls,
    from: agentWalletAddress,
    token: usdc,
    holders: { agent: agentWalletAddress, treasury: policy.treasuryAddress },
  });

  const now = new Date();
  const decision = await insertAgentDecision(db, {
    walletId: wallet.id,
    trigger: 'owner_sweep',
    contextSnapshot: { agentUsdc: agentUsdc.toString() },
    contextHash: hashCanonical({ agentUsdc: agentUsdc.toString(), callsHash: hash }),
    // jsonb columns go through the pg driver's own JSON.stringify, which throws on a raw bigint
    // (expectedDeltas' delta) — round-trip through a bigint-to-string replacer first.
    proposal: JSON.parse(JSON.stringify(proposal, bigintToString)) as unknown,
    proposalHash: hashProposal(proposal),
    proposalSource: 'owner',
    status: 'pending',
  });

  const verdict = evaluate({
    policy,
    proposal,
    now,
    chainId: policy.chainId,
    allowMainnet: env.THESAUROS_ALLOW_MAINNET,
    demoStableParity: true,
    state: {
      frozen: wallet.frozen,
      breakerOpen: wallet.breakerOpen,
      agentUsdc,
      treasuryUsdc: balances.value.treasuryUsdc,
      allowanceRemaining: 0n,
      vaultPositions: {},
      prices: {},
      contractHasCode: {},
      riskTriggers: [],
      recipientScreens: {},
    },
    ledger: { outflowsLast24hMicroUsd: 0n, actionsLastHour: 0, recentProposalHashes: [] },
    simulation: simulated.ok
      ? {
          ok: simulated.value.ok,
          deltas: simulated.value.deltas,
          approvals: simulated.value.approvals,
          ...(simulated.value.error === undefined ? {} : { error: simulated.value.error }),
        }
      : { ok: false, deltas: [], approvals: [], error: simulated.error.message },
    verifier: null,
    screen: { injectionSuspected: false, signals: [] },
    contextFactIds: [],
    ownerApproval: null,
  });

  await insertVerdict(db, {
    decisionId: decision.id,
    decision: verdict.decision,
    results: verdict.results,
    policyVersion: verdict.policyVersion,
  });
  await appendAudit(db, {
    walletId: wallet.id,
    actor: 'owner',
    event: 'SWEEP_VERDICT',
    entityType: 'agent_decision',
    entityId: decision.id,
    payload: { decision: verdict.decision, results: verdict.results },
    createdAt: now,
  });

  if (verdict.decision !== 'ALLOW') {
    await updateAgentDecision(db, decision.id, {
      status: 'denied',
      proposalHash: verdict.proposalHash,
    });
    return {
      status: 'denied',
      reasons: verdict.results
        .filter((r) => r.result !== 'PASS')
        .map((r) => `${r.code}: ${r.message ?? r.result}`),
    };
  }

  const receipt = signReceipt(verdict, receiptKey, now, crypto.randomUUID(), { callsHash: hash });
  if (!receipt.ok)
    return { status: 'failed', reason: `${receipt.error.code}: ${receipt.error.message}` };

  await updateAgentDecision(db, decision.id, {
    status: 'allowed',
    proposalHash: verdict.proposalHash,
  });

  const outcome = await execute(
    { db, sender: await senderFor(env, wallet, agentWalletAddress), receiptKey, now: () => now },
    {
      walletId: wallet.id,
      decisionId: decision.id,
      proposal,
      policy,
      receipt: receipt.value,
      buildContext,
      simulatedCallsHash: hash,
    },
  );
  if (!outcome.ok)
    return { status: 'failed', reason: `${outcome.error.code}: ${outcome.error.message}` };

  return {
    status: 'executed',
    providerTxId: outcome.value.providerTxId,
    amountBaseUnits: agentUsdc.toString(),
  };
}

const bigintToString = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

async function senderFor(env: Env, wallet: Wallet, agentWalletAddress: `0x${string}`) {
  const { createCircleClient, circleTxSender } = await import('@thesauros/wallet');
  if (!env.CIRCLE_API_KEY || !env.CIRCLE_ENTITY_SECRET) {
    throw new Error('CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required to execute a sweep');
  }
  const client = createCircleClient({
    apiKey: env.CIRCLE_API_KEY,
    entitySecret: env.CIRCLE_ENTITY_SECRET,
  });
  const ref = wallet.agentWalletRef as { circleWalletId?: string } | null;
  if (!ref?.circleWalletId) throw new Error('wallet has no Circle wallet id on record');
  return circleTxSender(client, ref.circleWalletId, agentWalletAddress);
}
