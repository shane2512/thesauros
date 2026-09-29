import { NextResponse } from 'next/server';
import { getAddress, verifyMessage } from 'viem';
import { z } from 'zod';
import { appendAudit, getRecipientById, removeRecipient, updateRecipient } from '@thesauros/db';
import {
  parseUnits,
  recipientAddMessage,
  RECIPIENT_CONFIRMATION_TTL_MS,
  USDC_DECIMALS,
} from '@thesauros/shared';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { issuePending, consumePending, newNonce } from '@/lib/nonce';
import { getSession } from '@/lib/session';
import { db } from '@/lib/db';
import { serializeRecipient } from '@/lib/recipients';

const zBody = z.object({
  label: z.string().min(1).max(80),
  maxPerTxUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  scheduleDayOfMonth: z.number().int().min(1).max(28).optional(),
  signature: z.string().optional(),
  message: z.string().optional(),
});

/**
 * Edit an existing allowlist entry's label/cap/schedule. Two-step like the collection route's POST,
 * and reuses the exact same `recipientAddMessage` shape — the address stays whatever it already was
 * (immutable here), so the owner is re-confirming the same trust with new numbers, not granting a
 * fresh one. Raising or lowering a cap both need a signature for one code path rather than trying to
 * split "safe" edits from "risky" ones.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');
  const { id } = await params;

  const parsed = zBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'Invalid request body.');

  const maxPerTxParsed = parseUnits(parsed.data.maxPerTxUsdc, USDC_DECIMALS);
  if (!maxPerTxParsed.ok)
    return apiError(400, 'bad_request', `maxPerTxUsdc: ${maxPerTxParsed.error}`);
  const maxPerTxBaseUnits = maxPerTxParsed.value;

  const database = db();
  const existing = await getRecipientById(database, auth.wallet.id, id);
  if (!existing) return apiError(404, 'not_found', 'Recipient not found.');

  const session = await getSession();

  if (!parsed.data.signature || !parsed.data.message) {
    const nonce = newNonce();
    const expiresAt = new Date(Date.now() + RECIPIENT_CONFIRMATION_TTL_MS);
    const message = recipientAddMessage({
      walletId: auth.wallet.id,
      label: parsed.data.label,
      address: existing.address,
      maxPerTxBaseUnits,
      scheduleDayOfMonth: parsed.data.scheduleDayOfMonth,
      nonce,
      expiresAt,
    });
    await issuePending(session, 'recipient-edit', message, RECIPIENT_CONFIRMATION_TTL_MS, nonce);
    return NextResponse.json({ message, expiresAt: expiresAt.toISOString() });
  }

  const pendingCheck = await consumePending(session, 'recipient-edit', parsed.data.message);
  if (!pendingCheck.ok) return apiError(409, 'invalid', pendingCheck.error);

  const validSig = await verifyMessage({
    address: getAddress(auth.ownerAddress),
    message: parsed.data.message,
    signature: parsed.data.signature as `0x${string}`,
  }).catch(() => false);
  if (!validSig) return apiError(401, 'invalid_signature', 'Signature does not verify.');

  const updated = await updateRecipient(database, auth.wallet.id, id, {
    label: parsed.data.label,
    maxPerTx: maxPerTxBaseUnits,
    schedule: parsed.data.scheduleDayOfMonth
      ? { dayOfMonth: parsed.data.scheduleDayOfMonth }
      : null,
    addedSignature: parsed.data.signature,
  });
  if (!updated) return apiError(404, 'not_found', 'Recipient not found.');

  await appendAudit(database, {
    walletId: auth.wallet.id,
    actor: 'owner',
    event: 'recipient_edited',
    entityType: 'recipient',
    entityId: id,
    payload: { label: updated.label, maxPerTx: updated.maxPerTx.toString() },
  });

  return NextResponse.json({ recipient: serializeRecipient(updated) });
}

/**
 * Remove a recipient from the allowlist. No signature: this only ever narrows what Thesauros can
 * pay (the same asymmetry as rejecting an approval or freezing — a safety-increasing action doesn't
 * need the same bar as one that grants a new capability). The currently active, already-signed
 * policy still lists the old recipient until the owner signs a new version — same as adding one.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');
  const { id } = await params;

  const database = db();
  const removed = await removeRecipient(database, auth.wallet.id, id);
  if (!removed) return apiError(404, 'not_found', 'Recipient not found.');

  await appendAudit(database, {
    walletId: auth.wallet.id,
    actor: 'owner',
    event: 'recipient_removed',
    entityType: 'recipient',
    entityId: id,
    payload: { label: removed.label },
  });

  return NextResponse.json({ removed: true });
}
