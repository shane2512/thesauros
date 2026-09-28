import { cookies } from 'next/headers';
import { getIronSession, type IronSession } from 'iron-session';
import { getEnv } from '@thesauros/shared';

// A pending nonce for an owner-signed action (auth sign-in, freeze/unfreeze/sweep, a recipient add,
// a policy activation). Stored in the encrypted session cookie, not a DB table: it is single-use
// (deleted once consumed) and short-lived (checked against `expiresAt`), and keeping it server-signed
// here means a stolen session cookie still can't forge the *next* nonce, only replay one already
// issued to it — which the single-use delete already closes.
export type PendingNonce = { action: string; nonce: string; message: string; expiresAt: string };

export type SessionData = {
  userId?: string;
  walletId?: string;
  ownerAddress?: string;
  pending?: PendingNonce;
};

function sessionOptions() {
  return {
    password: getEnv().SESSION_SECRET.reveal(),
    cookieName: 'thesauros_session',
    cookieOptions: { secure: process.env.NODE_ENV === 'production' },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}
