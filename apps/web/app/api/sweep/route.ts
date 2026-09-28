import { NextResponse } from 'next/server';
import { getAddress, verifyMessage } from 'viem';
import { z } from 'zod';
import { getActivePolicyBody } from '@thesauros/db';
import { getEnv } from '@thesauros/shared';
import { FREEZE_CONFIRMATION_TTL_MS, freezeMessage } from '@thesauros/shared';
import { requireWallet } from '@/lib/requireWallet';
import { issuePending, consumePending, newNonce } from '@/lib/nonce';
import { getSession } from '@/lib/session';
import { db } from '@/lib/db';
import { runOwnerSweep } from '@/lib/sweep';

const zBody = z.object({ signature: z.string().optional(), message: z.string().optional() });

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  const parsed = zBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request body' }, { status: 400 });

  const session = await getSession();

  if (!parsed.data.signature || !parsed.data.message) {
    const nonce = newNonce();
    const expiresAt = new Date(Date.now() + FREEZE_CONFIRMATION_TTL_MS);
    const message = freezeMessage({ action: 'sweep', walletId: auth.wallet.id, nonce, expiresAt });
    await issuePending(session, 'freeze:sweep', message, FREEZE_CONFIRMATION_TTL_MS, nonce);
    return NextResponse.json({ message, expiresAt: expiresAt.toISOString() });
  }

  const pendingCheck = await consumePending(session, 'freeze:sweep', parsed.data.message);
  if (!pendingCheck.ok) return NextResponse.json({ error: pendingCheck.error }, { status: 409 });

  const validSig = await verifyMessage({
    address: getAddress(auth.ownerAddress),
    message: parsed.data.message,
    signature: parsed.data.signature as `0x${string}`,
  }).catch(() => false);
  if (!validSig) return NextResponse.json({ error: 'signature does not verify' }, { status: 401 });

  const env = getEnv();
  if (!env.RECEIPT_HMAC_SECRET) {
    return NextResponse.json({ error: 'RECEIPT_HMAC_SECRET is not configured' }, { status: 503 });
  }
  const database = db();
  const activePolicy = await getActivePolicyBody(database, auth.wallet.id);
  const receiptKey = new TextEncoder().encode(env.RECEIPT_HMAC_SECRET.reveal());

  const outcome = await runOwnerSweep(database, env, auth.wallet, activePolicy, receiptKey);
  if (outcome.status === 'executed') return NextResponse.json(outcome);
  if (outcome.status === 'denied') return NextResponse.json(outcome, { status: 409 });
  return NextResponse.json(outcome, { status: 500 });
}
