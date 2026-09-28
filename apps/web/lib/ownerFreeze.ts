import { NextResponse } from 'next/server';
import { getAddress, verifyMessage } from 'viem';
import { z } from 'zod';
import { appendAudit, cancelPendingApprovals, setWalletFrozen } from '@thesauros/db';
import { FREEZE_CONFIRMATION_TTL_MS, freezeMessage, type FreezeAction } from '@thesauros/shared';
import type { AuthedWallet } from './requireWallet';
import { issuePending, consumePending, newNonce } from './nonce';
import { getSession } from './session';
import { db } from './db';

export const zFreezeBody = z.object({
  signature: z.string().optional(),
  message: z.string().optional(),
});

/**
 * I7: freeze/unfreeze/sweep never touch the reasoning layer or the worker — this route talks only
 * to the DB (and, for sweep, straight to the chain through `@thesauros/wallet`'s executor). Two-step
 * like `/api/policy/recipients`: no `signature` yet mints the nonce to sign.
 */
export async function ownerFreezeAction(
  auth: AuthedWallet,
  action: FreezeAction,
  body: unknown,
  reason: string,
  frozen: boolean,
): Promise<NextResponse> {
  const parsed = zFreezeBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request body' }, { status: 400 });

  const session = await getSession();

  if (!parsed.data.signature || !parsed.data.message) {
    const nonce = newNonce();
    const expiresAt = new Date(Date.now() + FREEZE_CONFIRMATION_TTL_MS);
    const message = freezeMessage({ action, walletId: auth.wallet.id, nonce, expiresAt });
    await issuePending(session, `freeze:${action}`, message, FREEZE_CONFIRMATION_TTL_MS, nonce);
    return NextResponse.json({ message, expiresAt: expiresAt.toISOString() });
  }

  const pendingCheck = await consumePending(session, `freeze:${action}`, parsed.data.message);
  if (!pendingCheck.ok) return NextResponse.json({ error: pendingCheck.error }, { status: 409 });

  const validSig = await verifyMessage({
    address: getAddress(auth.ownerAddress),
    message: parsed.data.message,
    signature: parsed.data.signature as `0x${string}`,
  }).catch(() => false);
  if (!validSig) return NextResponse.json({ error: 'signature does not verify' }, { status: 401 });

  const now = new Date();
  const database = db();
  await setWalletFrozen(database, auth.wallet.id, frozen, frozen ? reason : null, now);
  if (frozen) await cancelPendingApprovals(database, auth.wallet.id, now);
  await appendAudit(database, {
    walletId: auth.wallet.id,
    actor: 'owner',
    event: frozen ? 'FROZEN' : 'UNFROZEN',
    entityType: 'wallet',
    entityId: auth.wallet.id,
    payload: { action, reason },
    createdAt: now,
  });

  return NextResponse.json({ frozen });
}
