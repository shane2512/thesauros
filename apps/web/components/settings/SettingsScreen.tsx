'use client';
// Settings: treasury shortcuts (policy, recipients), Telegram link, export + verify the audit chain,
// unfreeze, close account. Nothing here makes a security decision in the browser — export and
// verify are plain server reads, and Unfreeze is an owner signature over a server-issued message
// that DELETE /api/freeze verifies before it clears the frozen flag.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AuditVerifyResult, useAuditVerify } from '@/components/activity/AuditChain';
import { UnfreezeSlot } from '@/components/freeze/UnfreezeSlot';
import {
  IconChevron,
  IconDownload,
  IconGavel,
  IconRecipients,
  IconRevoke,
  IconShieldCheck,
  IconVault,
  type IconComponent,
} from '@/components/icons';
import { Button, PageHeading, Row, Tag } from '@/components/primitives';
import { apiPost } from '@/lib/api';
import { zConfig, zDashboard, zMe, zTelegramLink } from '@/lib/contracts';
import { downloadAudit } from '@/lib/download';
import { shortAddress } from '@/lib/format';
import { useApi } from '@/lib/useApi';

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <p className="label px-1 pb-2">{label}</p>
      {children}
    </section>
  );
}

function LinkRow({
  icon,
  title,
  sub,
  href,
}: {
  icon: IconComponent;
  title: string;
  sub: string;
  href: string;
}) {
  return (
    <Row
      icon={icon}
      title={title}
      sub={sub}
      href={href}
      right={<IconChevron className="size-4 text-muted" />}
    />
  );
}

export function SettingsScreen() {
  const dash = useApi('/api/dashboard', zDashboard);
  const cfg = useApi('/api/config', zConfig);
  const me = useApi('/api/me', zMe);
  const verify = useAuditVerify();
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);
  const [exportError, setExportError] = useState(false);
  const [chatId, setChatId] = useState('');
  const [savingChatId, setSavingChatId] = useState(false);
  const [chatIdSaved, setChatIdSaved] = useState(false);
  const [chatIdError, setChatIdError] = useState(false);

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
    setChatIdError(false);
    try {
      await apiPost('/api/me/telegram', zTelegramLink, { chatId: chatId.trim() || null });
      setChatIdSaved(true);
      me.refetch();
    } catch {
      setChatIdError(true);
    } finally {
      setSavingChatId(false);
    }
  };

  const runExport = async (format: 'csv' | 'json') => {
    setExporting(format);
    setExportError(false);
    try {
      await downloadAudit(format);
    } catch {
      setExportError(true);
    } finally {
      setExporting(null);
    }
  };

  const frozen = dash.data?.wallet.frozen ?? false;
  const owner = me.data?.user.address;

  return (
    <div className="flex flex-col gap-5 px-4 pt-4 pb-10">
      <PageHeading sub={owner ? `Signed in as ${shortAddress(owner)}` : undefined}>
        Settings
      </PageHeading>

      <Group label="Treasury">
        <div className="card divide-y divide-line overflow-hidden">
          <LinkRow
            icon={IconGavel}
            title="Policy"
            sub={dash.data?.policy ? `v${dash.data.policy.version} active` : 'Not signed yet'}
            href="/app/policy"
          />
          <LinkRow
            icon={IconRecipients}
            title="Recipients"
            sub="Who Thesauros is allowed to pay"
            href="/app/recipients"
          />
          <LinkRow
            icon={IconVault}
            title="Vaults"
            sub="Where idle USDC earns yield"
            href="/app/vaults"
          />
        </div>
      </Group>

      <Group label="Notifications">
        <div className="card p-4">
          <label htmlFor="telegram" className="block text-small font-semibold text-ink">
            Telegram chat ID
          </label>
          {cfg.data && !cfg.data.telegramEnabled ? (
            <p className="pt-1.5 text-meta leading-[18px] text-muted">
              Telegram is not configured on this deployment yet. In-app notifications (the bell)
              always work.
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
                  inputMode="numeric"
                  placeholder="e.g. 123456789"
                  className="h-12 min-w-0 flex-1 rounded-sm bg-surface-2 px-4 text-small text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-accent"
                />
                <Button
                  variant="dark"
                  className="h-12 w-auto rounded-sm px-5 text-ui"
                  loading={savingChatId}
                  onClick={() => void saveChatId()}
                >
                  Save
                </Button>
              </div>
              <p className="pt-2 text-fine leading-4 text-muted">
                Message Thesauros&apos;s Telegram bot once. It replies with your chat ID. Paste it
                here to get the same alerts as the bell. Leave blank and save to unlink.
              </p>
              <div aria-live="polite">
                {chatIdSaved ? (
                  <p className="pt-2 text-meta font-semibold text-allow">Saved.</p>
                ) : null}
                {chatIdError ? (
                  <p role="alert" className="pt-2 text-meta text-deny">
                    Could not save. Nothing changed. Try again.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </div>
      </Group>

      <Group label="Audit log">
        <div className="card p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-3 text-ink">
              <IconShieldCheck className="size-5" />
            </span>
            <p className="text-meta leading-[18px] text-muted">
              Every proposal, verdict, execution, approval and freeze is an append-only,
              hash-chained row. Export it or re-walk the chain to prove nothing was edited.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-3">
            {(['csv', 'json'] as const).map((f) => (
              <Button
                key={f}
                variant="soft"
                className="h-11 rounded-sm text-meta"
                loading={exporting === f}
                onClick={() => void runExport(f)}
              >
                <IconDownload className="size-4" /> Export {f.toUpperCase()}
              </Button>
            ))}
          </div>
          {exportError ? (
            <p role="alert" className="pt-2 text-meta text-deny">
              Export failed. Nothing changed. Try again.
            </p>
          ) : null}
          <div className="pt-2">
            <Button
              variant="dark"
              className="h-11 rounded-sm text-ui"
              loading={verify.busy}
              onClick={() => void verify.run()}
            >
              Verify audit chain
            </Button>
          </div>
          <AuditVerifyResult result={verify.result} />
        </div>
      </Group>

      <Group label="Security">
        {frozen ? (
          <UnfreezeSlot frozen={frozen} onUnfrozen={() => dash.refetch()} />
        ) : (
          <div className="card flex items-center justify-between gap-3 p-4">
            <span className="min-w-0">
              <span className="block text-small font-semibold text-ink">Thesauros is running</span>
              <span className="block text-meta text-muted">
                Use Freeze in the header to stop it instantly.
              </span>
            </span>
            <Tag tone="soft" dot="pulse">
              Active
            </Tag>
          </div>
        )}
      </Group>

      <Group label="Account">
        <div className="card overflow-hidden">
          <Row
            icon={IconRevoke}
            tone="deny"
            title="Close account"
            sub="Freeze, sweep home, export, then delete your personal data"
            href="/app/settings/close"
            right={<IconChevron className="size-4 text-muted" />}
          />
        </div>
      </Group>
    </div>
  );
}
