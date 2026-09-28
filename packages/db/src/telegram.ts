// 8.5 — best-effort outbound Telegram notifier (FR-22 should-have). Plain `fetch` against the Bot
// API, no new dependency. Gated cleanly off (same shape as SERV degraded mode, D-*): no
// TELEGRAM_BOT_TOKEN or no per-user chat id means this silently no-ops, structured-log only.
//
// Never throws and never blocks the event it reports on — a failed send is a warning, not an error
// (see `insertNotification`, the only caller).
import { createLogger, type Env } from '@thesauros/shared';

const log = createLogger('telegram');

export async function sendTelegramMessage(
  env: Pick<Env, 'TELEGRAM_BOT_TOKEN'>,
  chatId: string,
  text: string,
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return; // not configured — off by default
  try {
    const res = await fetch(`https://api.telegram.org/bot${token.reveal()}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) log.warn({ status: res.status }, 'telegram sendMessage refused');
  } catch (e) {
    log.warn({ err: String(e) }, 'telegram sendMessage failed');
  }
}
