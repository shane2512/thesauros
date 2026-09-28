import { NextResponse } from 'next/server';
import { verifyMessage, getAddress } from 'viem';
import { z } from 'zod';
import { ensureWalletForUser, upsertUserByAddress } from '@thesauros/db';
import { getEnv } from '@thesauros/shared';
import { consumePending } from '@/lib/nonce';
import { getSession } from '@/lib/session';
import { db } from '@/lib/db';

const zBody = z.object({ address: z.string(), message: z.string(), signature: z.string() });

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = zBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request body' }, { status: 400 });

  let address: `0x${string}`;
  try {
    address = getAddress(parsed.data.address);
  } catch {
    return NextResponse.json({ error: 'address is not a valid EVM address' }, { status: 400 });
  }

  const session = await getSession();
  const pendingCheck = await consumePending(session, 'signin', parsed.data.message);
  if (!pendingCheck.ok) return NextResponse.json({ error: pendingCheck.error }, { status: 401 });

  const validSig = await verifyMessage({
    address,
    message: parsed.data.message,
    signature: parsed.data.signature as `0x${string}`,
  }).catch(() => false);
  if (!validSig) return NextResponse.json({ error: 'signature does not verify' }, { status: 401 });

  const now = new Date();
  const database = db();
  const user = await upsertUserByAddress(database, address, now);
  // The owner's connected address IS the treasury: the account sweep_home pays into (repos.ts).
  const wallet = await ensureWalletForUser(database, user.id, getEnv().CHAIN_ID, address);

  session.userId = user.id;
  session.walletId = wallet.id;
  session.ownerAddress = address;
  await session.save();

  return NextResponse.json({
    userId: user.id,
    walletId: wallet.id,
    ownerAddress: address,
    agentWalletAddress: wallet.agentWalletAddress,
  });
}
