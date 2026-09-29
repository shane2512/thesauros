import { NextResponse } from 'next/server';
import { getUserById } from '@thesauros/db';
import { getSession } from '@/lib/session';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { db } from '@/lib/db';

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session.userId || !session.ownerAddress)
    return apiError(401, 'unauthorized', 'Sign in first.');
  const [auth, user] = await Promise.all([requireWallet(), getUserById(db(), session.userId)]);
  return NextResponse.json({
    user: {
      id: session.userId,
      address: session.ownerAddress,
      telegramChatId: user?.telegramChatId ?? null,
    },
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
