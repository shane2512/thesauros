import { getWalletByUserId, type Wallet } from '@thesauros/db';
import { getSession } from './session';
import { db } from './db';

export type AuthedWallet = { userId: string; ownerAddress: string; wallet: Wallet };

/** Every protected route's first line. Returns `undefined` when the caller should 401. */
export async function requireWallet(): Promise<AuthedWallet | undefined> {
  const session = await getSession();
  if (!session.userId || !session.ownerAddress) return undefined;
  const wallet = await getWalletByUserId(db(), session.userId);
  if (!wallet) return undefined;
  return { userId: session.userId, ownerAddress: session.ownerAddress, wallet };
}
