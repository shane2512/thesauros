import { randomBytes } from 'node:crypto';
import type { SessionData, PendingNonce } from './session';
import type { IronSession } from 'iron-session';

export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/** Stash a message the owner is about to sign; `consumePending` is the only way to clear it. */
export async function issuePending(
  session: IronSession<SessionData>,
  action: string,
  message: string,
  ttlMs: number,
  nonce = newNonce(),
): Promise<PendingNonce> {
  const pending: PendingNonce = {
    action,
    nonce,
    message,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
  session.pending = pending;
  await session.save();
  return pending;
}

/**
 * Consumes the session's pending nonce for `action` if it matches `message` and has not expired.
 * Single-use: cleared from the session whether it matched or not, so a wrong signature can't be
 * retried against the same nonce (it must go back through the GET step for a fresh one).
 */
export async function consumePending(
  session: IronSession<SessionData>,
  action: string,
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pending = session.pending;
  session.pending = undefined;
  await session.save();
  if (!pending) return { ok: false, error: 'no pending confirmation for this session' };
  if (pending.action !== action)
    return { ok: false, error: 'pending confirmation is for a different action' };
  if (pending.message !== message)
    return { ok: false, error: 'message does not match the issued nonce' };
  if (new Date(pending.expiresAt).getTime() < Date.now())
    return { ok: false, error: 'confirmation nonce expired' };
  return { ok: true };
}
