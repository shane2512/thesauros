import { NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { boss } from '@/lib/boss';
import { requireWallet } from '@/lib/requireWallet';

/** Mirrors apps/worker/src/jobs.ts's LOOP_RUN_QUEUE (the web app never imports the worker app). */
const LOOP_RUN_QUEUE = 'loop.run';

/**
 * "Run now": the owner asks their own agent to look at the treasury immediately instead of waiting for
 * the next scheduled tick. It queues one ordinary loop iteration (trigger "owner"); everything the
 * agent does from there still passes the Policy Engine, the simulation and the owner's signed policy,
 * and a frozen treasury is skipped. At most one request per wallet every 30 seconds.
 */
export async function POST(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');
  if (!auth.wallet.agentWalletAddress)
    return apiError(409, 'no_agent_wallet', 'Finish setup to create your agent wallet first.');

  const queue = await boss();
  const id = await queue.send(
    LOOP_RUN_QUEUE,
    { walletId: auth.wallet.id, trigger: 'owner' },
    { singletonKey: auth.wallet.id, singletonSeconds: 30 },
  );
  if (id === null)
    return apiError(429, 'too_soon', 'A check was just queued. Give it a few seconds.');
  return NextResponse.json({ queued: true }, { status: 202 });
}
