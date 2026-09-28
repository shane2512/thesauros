import { NextResponse } from 'next/server';
import { getAddress, verifyMessage } from 'viem';
import { z } from 'zod';
import { insertRecipient, listRecipients } from '@thesauros/db';
import {
  parseUnits,
  recipientAddMessage,
  RECIPIENT_CONFIRMATION_TTL_MS,
  USDC_DECIMALS,
} from '@thesauros/shared';
import { requireWallet } from '@/lib/requireWallet';
import { issuePending, consumePending, newNonce } from '@/lib/nonce';
import { getSession } from '@/lib/session';
import { db } from '@/lib/db';

export async function GET(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  const recipients = await listRecipients(db(), auth.wallet.id);
  return NextResponse.json({ recipients });
}

const zBody = z.object({
  label: z.string().min(1).max(80),
  address: z.string(),
  maxPerTxUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  scheduleDayOfMonth: z.number().int().min(1).max(28).optional(),
  signature: z.string().optional(),
  message: z.string().optional(),
  nonce: z.string().optional(),
});

/**
 * Two-step: no `signature` yet mints the nonce+message to sign (mirrors `/api/auth/nonce`); the
 * signed message binds the exact label/address/amount so a phishing site can't get a signature that
 * adds something else (T3, address poisoning).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  const parsed = zBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request body' }, { status: 400 });

  let address: `0x${string}`;
  try {
    address = getAddress(parsed.data.address);
  } catch {
    return NextResponse.json({ error: 'address is not a valid EVM address' }, { status: 400 });
  }
  const maxPerTxParsed = parseUnits(parsed.data.maxPerTxUsdc, USDC_DECIMALS);
  if (!maxPerTxParsed.ok) {
    return NextResponse.json({ error: `maxPerTxUsdc: ${maxPerTxParsed.error}` }, { status: 400 });
  }
  const maxPerTxBaseUnits = maxPerTxParsed.value;

  const session = await getSession();

  if (!parsed.data.signature || !parsed.data.message) {
    const nonce = newNonce();
    const expiresAt = new Date(Date.now() + RECIPIENT_CONFIRMATION_TTL_MS);
    const message = recipientAddMessage({
      walletId: auth.wallet.id,
      label: parsed.data.label,
      address,
      maxPerTxBaseUnits,
      scheduleDayOfMonth: parsed.data.scheduleDayOfMonth,
      nonce,
      expiresAt,
    });
    await issuePending(session, 'recipient-add', message, RECIPIENT_CONFIRMATION_TTL_MS, nonce);
    return NextResponse.json({ message, expiresAt: expiresAt.toISOString() });
  }

  const pendingCheck = await consumePending(session, 'recipient-add', parsed.data.message);
  if (!pendingCheck.ok) return NextResponse.json({ error: pendingCheck.error }, { status: 409 });

  const validSig = await verifyMessage({
    address: getAddress(auth.ownerAddress),
    message: parsed.data.message,
    signature: parsed.data.signature as `0x${string}`,
  }).catch(() => false);
  if (!validSig) return NextResponse.json({ error: 'signature does not verify' }, { status: 401 });

  const inserted = await insertRecipient(db(), {
    walletId: auth.wallet.id,
    label: parsed.data.label,
    address,
    maxPerTx: maxPerTxBaseUnits,
    schedule: parsed.data.scheduleDayOfMonth
      ? { dayOfMonth: parsed.data.scheduleDayOfMonth }
      : null,
    addedSignature: parsed.data.signature,
  });
  if (!inserted) {
    return NextResponse.json(
      { error: 'this address is already on the allowlist' },
      { status: 409 },
    );
  }

  return NextResponse.json({ recipient: inserted });
}
