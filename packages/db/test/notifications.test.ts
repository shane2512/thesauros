// Task 8.5: the notifications table's write/read helpers, plus the Telegram best-effort send that
// `insertNotification` fires when configured. Requires Postgres (see helpers.ts).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import {
  insertNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  setTelegramChatId,
  unreadNotificationCount,
  upsertUserByAddress,
  type Db,
} from '../src';

let db: Db;
let pool: pg.Pool;
beforeAll(async () => {
  const helpers = await import('./helpers');
  ({ db, pool } = await helpers.freshTestDb());
});
afterAll(async () => {
  await pool?.end();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const addr = () => `0x${Math.random().toString(16).slice(2).padEnd(40, '0')}`;

describe('insertNotification / listNotifications / read state', () => {
  it('writes a row and lists it back newest-first, unread by default', async () => {
    const user = await upsertUserByAddress(db, addr(), new Date());
    await insertNotification(db, { userId: user.id, type: 'execution', title: 'A', body: 'a' });
    await insertNotification(db, { userId: user.id, type: 'blocked', title: 'B', body: 'b' });

    const rows = await listNotifications(db, user.id);
    expect(rows.map((r) => r.title)).toEqual(['B', 'A']);
    expect(rows.every((r) => r.readAt === null)).toBe(true);
    expect(await unreadNotificationCount(db, user.id)).toBe(2);
  });

  it('paginates with beforeId', async () => {
    const user = await upsertUserByAddress(db, addr(), new Date());
    for (let i = 0; i < 3; i++)
      await insertNotification(db, {
        userId: user.id,
        type: 'execution',
        title: `${i}`,
        body: 'x',
      });

    const page1 = await listNotifications(db, user.id, { limit: 2 });
    expect(page1).toHaveLength(2);
    const page2 = await listNotifications(db, user.id, {
      limit: 2,
      beforeId: page1[page1.length - 1]?.id,
    });
    expect(page2.map((r) => r.id)).not.toEqual(page1.map((r) => r.id));
  });

  it('markNotificationRead is scoped to the owning user and returns undefined otherwise', async () => {
    const owner = await upsertUserByAddress(db, addr(), new Date());
    const other = await upsertUserByAddress(db, addr(), new Date());
    await insertNotification(db, { userId: owner.id, type: 'execution', title: 'mine', body: 'x' });
    const [row] = await listNotifications(db, owner.id, { limit: 1 });
    if (!row) throw new Error('missing row');

    expect(await markNotificationRead(db, other.id, row.id, new Date())).toBeUndefined();
    const marked = await markNotificationRead(db, owner.id, row.id, new Date());
    expect(marked?.readAt).not.toBeNull();
    expect(await unreadNotificationCount(db, owner.id)).toBe(0);
  });

  it('markAllNotificationsRead clears every unread row for that user only', async () => {
    const user = await upsertUserByAddress(db, addr(), new Date());
    const untouched = await upsertUserByAddress(db, addr(), new Date());
    for (let i = 0; i < 3; i++)
      await insertNotification(db, {
        userId: user.id,
        type: 'execution',
        title: `${i}`,
        body: 'x',
      });
    await insertNotification(db, {
      userId: untouched.id,
      type: 'execution',
      title: 'x',
      body: 'x',
    });

    await markAllNotificationsRead(db, user.id, new Date());
    expect(await unreadNotificationCount(db, user.id)).toBe(0);
    expect(await unreadNotificationCount(db, untouched.id)).toBe(1);
  });
});

describe('insertNotification Telegram best-effort send', () => {
  it('does not call fetch when TELEGRAM_BOT_TOKEN is unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const user = await upsertUserByAddress(db, addr(), new Date());
    await setTelegramChatId(db, user.id, '12345');
    await insertNotification(db, { userId: user.id, type: 'execution', title: 'A', body: 'a' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // `getEnv()` caches its first successful parse for the life of the module (D-106's process-wide
  // singleton), so every test below that needs TELEGRAM_BOT_TOKEN stubs the SAME value once here
  // rather than re-stubbing per test — a later `vi.stubEnv` in this file cannot un-cache an earlier
  // successful parse.
  describe('with a bot token configured', () => {
    beforeAll(() => {
      vi.stubEnv('DATABASE_URL', 'postgres://x/y');
      vi.stubEnv('SESSION_SECRET', 'x'.repeat(40));
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
    });

    it('does not call fetch when no chat id is linked', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const user = await upsertUserByAddress(db, addr(), new Date());
      await insertNotification(db, { userId: user.id, type: 'execution', title: 'A', body: 'a' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends the right payload when both token and chat id are configured', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const user = await upsertUserByAddress(db, addr(), new Date());
      await setTelegramChatId(db, user.id, '555');
      await insertNotification(db, {
        userId: user.id,
        type: 'freeze',
        title: 'Frozen',
        body: 'stop',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.telegram.org/botbot-token/sendMessage');
      expect(JSON.parse(init.body as string)).toEqual({ chat_id: '555', text: 'Frozen\nstop' });
    });

    // ── 8.7 red-team RT-1/RT-2 ────────────────────────────────────────────────────────────────────
    // The Telegram transport is the only place a notification body leaves the app, and the chat id
    // is the only attacker-influenceable part of it. Two properties must hold no matter what either
    // string contains: the request goes to api.telegram.org and nowhere else (no SSRF), and the
    // body is sent as plain text with NO `parse_mode` (no HTML/Markdown entity parsing, so a memo
    // or vault name cannot become a clickable exfiltration link in the owner's chat).
    it('RT-2: a hostile chat id cannot move the request off api.telegram.org', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const hostile = [
        '../../../evil',
        '@publicchannel',
        'https://evil.example/x',
        '555\nHost: evil.example',
        '555?chat_id=-100123',
      ];
      for (const chatId of hostile) {
        const user = await upsertUserByAddress(db, addr(), new Date());
        await setTelegramChatId(db, user.id, chatId);
        await insertNotification(db, { userId: user.id, type: 'freeze', title: 'T', body: 'b' });
      }
      expect(fetchSpy).toHaveBeenCalledTimes(hostile.length);
      for (const [url, init] of fetchSpy.mock.calls as [string, RequestInit][]) {
        expect(url).toBe('https://api.telegram.org/botbot-token/sendMessage');
        expect(new URL(url).host).toBe('api.telegram.org');
        // The chat id is a JSON field, never part of the URL — so it cannot add a path, a query
        // parameter or a header no matter what it contains.
        const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(typeof parsed['chat_id']).toBe('string');
      }
    });

    it('RT-1: a notification body is sent verbatim with no parse_mode', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const user = await upsertUserByAddress(db, addr(), new Date());
      await setTelegramChatId(db, user.id, '555');
      const nasty = '<a href="https://evil.example">click</a> [x](https://evil.example) <b>*_`';
      await insertNotification(db, { userId: user.id, type: 'blocked', title: 'T', body: nasty });

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(parsed['text']).toBe(`T\n${nasty}`);
      // Absent, not 'none': Telegram only parses entities when asked to.
      expect(parsed).not.toHaveProperty('parse_mode');
    });

    it('a failed send does not throw or propagate to the caller', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
      const user = await upsertUserByAddress(db, addr(), new Date());
      await setTelegramChatId(db, user.id, '555');
      await expect(
        insertNotification(db, { userId: user.id, type: 'freeze', title: 'A', body: 'a' }),
      ).resolves.toBeUndefined();
      // The in-app row still landed even though the Telegram send failed.
      expect(await unreadNotificationCount(db, user.id)).toBe(1);
    });
  });
});
