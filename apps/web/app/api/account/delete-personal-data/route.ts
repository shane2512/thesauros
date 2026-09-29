import { NextResponse } from 'next/server';
import { appendAudit, scrubUserPersonalData } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { db } from '@/lib/db';

/** Account closure step 3: clear the PII fields `users` owns. audit_log is never touched (I6) — the
 * ledger stays complete, just no longer joined to a display name or Telegram chat id. Gated on the
 * wallet already being frozen (step 1), same as the closure checklist's own client-side ordering. */
export async function POST(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');
  if (!auth.wallet.frozen)
    return apiError(409, 'not_frozen', 'Freeze the wallet before deleting personal data.');

  const database = db();
  await scrubUserPersonalData(database, auth.userId);
  await appendAudit(database, {
    walletId: auth.wallet.id,
    actor: 'owner',
    event: 'personal_data_deleted',
    entityType: 'user',
    entityId: auth.userId,
    payload: {},
  });
  return NextResponse.json({ done: true });
}
