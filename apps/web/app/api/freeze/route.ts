import { NextResponse } from 'next/server';
import { requireWallet } from '@/lib/requireWallet';
import { ownerFreezeAction } from '@/lib/ownerFreeze';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  return ownerFreezeAction(auth, 'freeze', body, 'owner freeze', true);
}

/** Not in API.md's table but needed by the freeze screen's own undo — same nonce+signature gate. */
export async function DELETE(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  return ownerFreezeAction(auth, 'unfreeze', body, 'owner unfreeze', false);
}
