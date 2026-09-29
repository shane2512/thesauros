import { NextResponse } from 'next/server';
import { appendAudit, setTelegramChatId } from '@thesauros/db';
import { z } from 'zod';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { db } from '@/lib/db';

const zBody = z.object({ chatId: z.string().nullable() });

/** 8.5 Settings: link or unlink the owner's Telegram chat id. Not a fund-moving action, so no
 * owner signature — session auth (the same cookie that guards every other read here) is enough. */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const body: unknown = await req.json().catch(() => null);
  const parsed = zBody.safeParse(body);
  if (!parsed.success) return apiError(400, 'bad_request', 'Send a chatId or null.');

  const database = db();
  const chatId = parsed.data.chatId?.trim() || null;
  await setTelegramChatId(database, auth.userId, chatId);
  await appendAudit(database, {
    walletId: auth.wallet.id,
    actor: 'owner',
    event: chatId ? 'telegram_linked' : 'telegram_unlinked',
    entityType: 'user',
    entityId: auth.userId,
    payload: {},
  });
  return NextResponse.json({ chatId });
}
