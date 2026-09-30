import { NextResponse } from 'next/server';
import { getAddress, verifyMessage } from 'viem';
import { z } from 'zod';
import { insertVault, listVaultRows } from '@thesauros/db';
import { getEnv, RECIPIENT_CONFIRMATION_TTL_MS, vaultAddMessage } from '@thesauros/shared';
import { requireWallet } from '@/lib/requireWallet';
import { issuePending, consumePending, newNonce } from '@/lib/nonce';
import { getSession } from '@/lib/session';
import { db } from '@/lib/db';
import { serializeVault } from '@/lib/vaults';

export async function GET(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  const rows = await listVaultRows(db(), auth.wallet.id);
  return NextResponse.json({ vaults: rows.map(serializeVault) });
}

const zBody = z.object({
  name: z.string().min(1).max(80),
  address: z.string(),
  maxAllocationPct: z.number().min(0).max(100),
  signature: z.string().optional(),
  message: z.string().optional(),
});

/**
 * Two-step, same shape as `/api/policy/recipients`. `kind` is never owner-supplied: the server
 * recognizes Circle's real USYC Teller by address (docs/VERIFY.md row 15) and treats anything else
 * as a plain ERC-4626 vault — an owner can't claim a vault is Teller-shaped when it isn't, and
 * doesn't need to understand the distinction to add one.
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
  const maxAllocationBps = Math.round(parsed.data.maxAllocationPct * 100);

  const env = getEnv();
  const kind = address === getAddress(env.USYC_TELLER_ADDRESS) ? 'usyc_teller' : 'erc4626';
  const session = await getSession();

  if (!parsed.data.signature || !parsed.data.message) {
    const nonce = newNonce();
    const expiresAt = new Date(Date.now() + RECIPIENT_CONFIRMATION_TTL_MS);
    const message = vaultAddMessage({
      walletId: auth.wallet.id,
      name: parsed.data.name,
      address,
      kind,
      maxAllocationBps,
      nonce,
      expiresAt,
    });
    await issuePending(session, 'vault-add', message, RECIPIENT_CONFIRMATION_TTL_MS, nonce);
    return NextResponse.json({ message, expiresAt: expiresAt.toISOString() });
  }

  const pendingCheck = await consumePending(session, 'vault-add', parsed.data.message);
  if (!pendingCheck.ok) return NextResponse.json({ error: pendingCheck.error }, { status: 409 });

  const validSig = await verifyMessage({
    address: getAddress(auth.ownerAddress),
    message: parsed.data.message,
    signature: parsed.data.signature as `0x${string}`,
  }).catch(() => false);
  if (!validSig) return NextResponse.json({ error: 'signature does not verify' }, { status: 401 });

  const existing = await listVaultRows(db(), auth.wallet.id);
  const id = `v${existing.length + 1}`;

  const inserted = await insertVault(db(), {
    id,
    walletId: auth.wallet.id,
    name: parsed.data.name,
    address,
    assetAddress: getAddress(env.USDC_ADDRESS),
    kind,
    maxAllocationBps,
  });
  if (!inserted) {
    return NextResponse.json({ error: 'could not add this vault, try again' }, { status: 409 });
  }

  return NextResponse.json({ vault: serializeVault(inserted) });
}
