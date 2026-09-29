'use client';
// Settings: Telegram link, export audit, verify audit chain, unfreeze, close account. Nothing here
// makes a security decision in the browser — export and verify are both plain server reads, and
// Unfreeze is an owner signature over a server-issued message that POST /api/freeze verifies before
// it clears the frozen flag.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { UnfreezeSlot } from '@/components/freeze/UnfreezeSlot';
import { Banner, Button, Eyebrow, TextButton } from '@/components/primitives';
import { apiGet, apiPost } from '@/lib/api';
import {
  zAuditVerify,
  zConfig,
  zDashboard,
  zMe,
  zTelegramLink,
  type AuditVerify,
} from '@/lib/contracts';
import { useApi } from '@/lib/useApi';

export function SettingsScreen() {
  const dash = useApi('/api/dashboard', zDashboard);
  const cfg = useApi('/api/config', zConfig);
  const me = useApi('/api/me', zMe);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<AuditVerify | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);
  const [chatId, setChatId] = useState('');
  const [savingChatId, setSavingChatId] = useState(false);
  const [chatIdSaved, setChatIdSaved] = useState(false);

  // Seed the field from whatever `/api/me` returns, but never once the owner has touched it — a
  // slow `/api/me` (or its refetch after Save) could otherwise land mid-keystroke and wipe what
  // they typed.
  const touchedChatId = useRef(false);
  useEffect(() => {
    if (touchedChatId.current || !me.data) return;
    setChatId(me.data.user.telegramChatId ?? '');
  }, [me.data]);

  const saveChatId = async () => {
    setSavingChatId(true);
    setChatIdSaved(false);
    try {
      await apiPost('/api/me/telegram', zTelegramLink, { chatId: chatId.trim() || null });
      setChatIdSaved(true);
      me.refetch();
    } finally {
      setSavingChatId(false);
    }
  };

  const runVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      setVerifyResult(await apiGet('/api/audit/verify', zAuditVerify));
    } catch {
      setVerifyResult({
        ok: false,
        break: { rowId: -1, reason: 'network', expected: '', actual: '' },
      });
    } finally {
      setVerifying(false);
    }
  };

  // The route already validates its own query and shapes its own output; this is a same-origin,
  // owner-authenticated download, so the raw text is saved as-is rather than re-parsed with zod.
  const runExport = async (format: 'csv' | 'json') => {
    setExporting(format);
    try {
      const res = await fetch(`/api/audit/export?format=${format}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const text = await res.text();
      downloadText(
        text,
        `thesauros-audit.${format}`,
        format === 'json' ? 'application/json' : 'text/csv',
      );
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="pb-10">
      <Eyebrow>Notifications</Eyebrow>
      <div className="px-4">
        <label htmlFor="telegram" className="block text-small font-semibold text-ink">
          Telegram chat ID
        </label>
        {cfg.data && !cfg.data.telegramEnabled ? (
          <p className="pt-2 text-small text-muted">
            Telegram is not configured on this deployment yet. In-app notifications above always
            work.
          </p>
        ) : (
          <>
            <div className="mt-2 flex gap-2">
              <input
                id="telegram"
                value={chatId}
                onChange={(e) => {
                  touchedChatId.current = true;
                  setChatId(e.target.value);
                  setChatIdSaved(false);
                }}
                placeholder="e.g. 123456789"
                className="h-14 flex-1 rounded-md bg-surface-2 px-4 text-h3 text-ink placeholder:text-faint"
              />
              <Button
                variant="ghost"
                className="w-auto"
                loading={savingChatId}
                onClick={() => void saveChatId()}
              >
                Save
              </Button>
            </div>
            <p className="pt-2 text-small text-muted">
              Message Thesauros&apos;s Telegram bot once — it replies with your chat ID. Paste that
              ID here and Thesauros will message you there too, for the same things it shows in the
              bell above. Leave it blank and save to unlink.
            </p>
            <div aria-live="polite">
              {chatIdSaved ? (
                <p className="pt-2 text-small font-semibold text-allow">Saved.</p>
              ) : null}
            </div>
          </>
        )}
      </div>

      <Eyebrow>Audit log</Eyebrow>
      <div className="space-y-3 px-4">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="ghost"
            className="w-auto"
            loading={exporting === 'csv'}
            onClick={() => void runExport('csv')}
          >
            Export CSV
          </Button>
          <Button
            variant="ghost"
            className="w-auto"
            loading={exporting === 'json'}
            onClick={() => void runExport('json')}
          >
            Export JSON
          </Button>
        </div>
        <div>
          <Button
            variant="ghost"
            className="w-auto"
            loading={verifying}
            onClick={() => void runVerify()}
          >
            Verify audit chain
          </Button>
        </div>
        <div aria-live="polite">
          {verifyResult ? (
            verifyResult.ok ? (
              <Banner tone="info" title="Verified">
                {verifyResult.rows} rows, unbroken from the first to row {verifyResult.rows}.
              </Banner>
            ) : (
              <Banner tone="bad" title="Chain broken" live="assertive">
                Row {verifyResult.break.rowId}: {verifyResult.break.reason}. Expected{' '}
                {verifyResult.break.expected || '(none)'}, found{' '}
                {verifyResult.break.actual || '(none)'}.
              </Banner>
            )
          ) : null}
        </div>
      </div>

      <Eyebrow>Security</Eyebrow>
      <div className="px-4">
        <UnfreezeSlot
          frozen={dash.data?.wallet.frozen ?? false}
          onUnfrozen={() => dash.refetch()}
        />
      </div>

      <Eyebrow>Account</Eyebrow>
      <div className="px-4">
        <Link href="/app/settings/close" className="inline-block">
          <TextButton>Close account</TextButton>
        </Link>
      </div>
    </div>
  );
}

function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
