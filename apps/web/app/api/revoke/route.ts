import { NextResponse } from 'next/server';
import { requireWallet } from '@/lib/requireWallet';
import { ownerFreezeAction } from '@/lib/ownerFreeze';

/**
 * D-012: Circle's Gas Station policy is console-only and account-wide, not a per-treasury object an
 * API call can revoke — there is no separate "Paymaster policy" resource on Arc to reach for here.
 * The real enforcement is the app-layer Policy Engine plus this wallet's own frozen flag, so "revoke"
 * and "freeze" both flip the same flag; they are audited under different events so the owner (and a
 * judge reading the trail) can tell which button they pressed.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  return ownerFreezeAction(
    auth,
    'freeze',
    body,
    'owner revoke (D-012: no separate Paymaster policy on Arc)',
    true,
  );
}
