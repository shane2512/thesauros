import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session.userId || !session.ownerAddress)
    return apiError(401, 'unauthorized', 'Sign in first.');
  const auth = await requireWallet();
  return NextResponse.json({
    user: { id: session.userId, address: session.ownerAddress },
    wallet: auth
      ? {
          id: auth.wallet.id,
          chainId: auth.wallet.chainId,
          agentWalletAddress: auth.wallet.agentWalletAddress,
          frozen: auth.wallet.frozen,
        }
      : null,
  });
}
