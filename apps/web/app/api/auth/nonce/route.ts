import { NextResponse } from 'next/server';
import { getAddress } from 'viem';
import { domainFromRequest, signInMessage, SIGNIN_TTL_MS } from '@/lib/auth';
import { issuePending } from '@/lib/nonce';
import { getSession } from '@/lib/session';

export async function GET(req: Request): Promise<NextResponse> {
  const address = new URL(req.url).searchParams.get('address');
  if (!address)
    return NextResponse.json({ error: 'address query param is required' }, { status: 400 });

  let checksummed: string;
  try {
    checksummed = getAddress(address);
  } catch {
    return NextResponse.json({ error: 'address is not a valid EVM address' }, { status: 400 });
  }

  const domain = domainFromRequest(req);
  const expiresAt = new Date(Date.now() + SIGNIN_TTL_MS);
  const session = await getSession();
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const message = signInMessage({ domain, address: checksummed, nonce, expiresAt });
  await issuePending(session, 'signin', message, SIGNIN_TTL_MS, nonce);

  return NextResponse.json({ message, expiresAt: expiresAt.toISOString() });
}
