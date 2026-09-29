'use client';
// Recipients. The list/add/edit chrome lives here; validation, the poisoning warning and the
// signature all live in AddRecipientSign/EditRecipientSign — embedded, not rebuilt. Adding or
// editing a recipient is inert until the owner also signs the next policy version (the active
// policy's recipients array is frozen at signing time), so a successful add or edit always routes
// into PolicySign next — the same diff+sign surface /app/policy uses. Removing needs no signature
// (see the [id] route's DELETE — same asymmetry as rejecting an approval) but still routes there,
// since the active policy still lists the removed recipient until the next version is signed.
import { useState } from 'react';
import { AddRecipientSign } from '@/components/sign/AddRecipientSign';
import { EditRecipientSign } from '@/components/sign/EditRecipientSign';
import { PolicySign } from '@/components/sign/PolicySign';
import { IconCopy, IconCheck, IconRecipients } from '@/components/icons';
import {
  Banner,
  Button,
  EmptyState,
  ErrorPanel,
  PageHeading,
  RowSkeleton,
  Tag,
  TextButton,
} from '@/components/primitives';
import { apiDelete } from '@/lib/api';
import { zRecipientList, zRecipientRemoved, type Recipient } from '@/lib/contracts';
import { formatToken, shortAddress, toBig } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Mode = 'list' | 'add' | 'edit' | 'sign-policy';

export function RecipientsScreen() {
  const [mode, setMode] = useState<Mode>('list');
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState<Recipient | null>(null);
  const [removing, setRemoving] = useState<Recipient | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const q = useApi('/api/policy/recipients', zRecipientList);
  const recipients = q.data?.recipients ?? [];

  const copy = (addr: string) => {
    void navigator.clipboard?.writeText(addr).then(() => {
      setCopied(addr);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await apiDelete(`/api/policy/recipients/${removing.id}`, zRecipientRemoved);
      setRemoving(null);
      await q.refetch();
      setMode('sign-policy');
    } catch {
      setRemoveError('Thesauros could not remove this recipient. Nothing changed. Try again.');
    } finally {
      setRemoveBusy(false);
    }
  };

  if (mode === 'add')
    return (
      <div className="px-4 pt-2">
        <TextButton className="-ml-3" onClick={() => setMode('list')}>
          ← Back to recipients
        </TextButton>
        <div className="card mt-2 p-4">
          <AddRecipientSign
            existing={recipients}
            onAdded={() => {
              q.refetch();
              setMode('sign-policy');
            }}
          />
        </div>
      </div>
    );

  if (mode === 'edit' && editing)
    return (
      <div className="px-4 pt-2">
        <TextButton className="-ml-3" onClick={() => setMode('list')}>
          ← Back to recipients
        </TextButton>
        <div className="card mt-2 p-4">
          <EditRecipientSign
            recipient={editing}
            onCancel={() => setMode('list')}
            onSaved={() => {
              q.refetch();
              setMode('sign-policy');
            }}
          />
        </div>
      </div>
    );

  if (mode === 'sign-policy')
    return (
      <div className="px-4 pt-4">
        <Banner tone="info" title="One more step">
          This change isn&apos;t in effect yet. Sign the next policy version so Thesauros picks it
          up.
        </Banner>
        <div className="pt-4">
          <PolicySign cta="Sign and activate" onActivated={() => setMode('list')} />
        </div>
        <div className="pt-3">
          <TextButton onClick={() => setMode('list')}>I&apos;ll sign later</TextButton>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <PageHeading sub="The only addresses Thesauros may ever pay. Matched exactly, by address and chain.">
        Recipients
      </PageHeading>
      <div aria-live="polite">
        {q.isLoading ? (
          <div className="card">
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : q.error ? (
          <ErrorPanel
            title="Thesauros could not load your recipients"
            body="Nothing changed. Check your connection and try again."
            onRetry={q.refetch}
          />
        ) : recipients.length === 0 ? (
          <EmptyState
            title="No recipients yet"
            body="Add someone Thesauros is allowed to pay. Every address is matched exactly — no ENS, no look-alikes."
          />
        ) : (
          <ul data-testid="recipients-list" className="flex flex-col gap-2">
            {recipients.map((r: Recipient) => (
              <li key={r.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-3 text-ink">
                    <IconRecipients className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-title font-semibold text-ink">{r.label}</span>
                      <Tag
                        tone={
                          r.riskTier === 'high'
                            ? 'deny'
                            : r.riskTier === 'medium'
                              ? 'warn'
                              : 'quiet'
                        }
                      >
                        {r.riskTier} risk
                      </Tag>
                    </div>
                    <button
                      type="button"
                      onClick={() => copy(r.address)}
                      aria-label={
                        copied === r.address ? 'Address copied' : `Copy ${r.label}'s address`
                      }
                      className="mt-1 inline-flex min-h-8 items-center gap-1.5 rounded-sm bg-surface-2 px-2 font-mono text-fine text-ink hover:bg-surface-3"
                    >
                      {shortAddress(r.address)}
                      {copied === r.address ? (
                        <IconCheck className="size-3.5" />
                      ) : (
                        <IconCopy className="size-3.5 text-muted" />
                      )}
                    </button>
                    <p className="pt-1.5 text-meta text-muted">
                      Up to{' '}
                      <strong className="font-semibold text-ink">
                        {formatToken(toBig(r.maxPerTx))} USDC
                      </strong>{' '}
                      per payment
                      {r.scheduleDayOfMonth ? ` · monthly on day ${r.scheduleDayOfMonth}` : ''}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(r);
                      setMode('edit');
                    }}
                    className="h-11 rounded-sm bg-surface-3 text-meta font-bold text-ink hover:brightness-95"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRemoveError(null);
                      setRemoving(r);
                    }}
                    className="h-11 rounded-sm bg-deny-tint text-meta font-bold text-deny hover:brightness-95"
                  >
                    Remove
                  </button>
                </div>
                {removing?.id === r.id ? (
                  <div className="mt-3 rounded-md bg-deny-tint p-3" role="alert">
                    <p className="text-small text-deny">
                      Remove {r.label}? This won&apos;t affect the currently signed policy until you
                      sign again.
                    </p>
                    {removeError ? (
                      <p className="pt-1 text-small text-deny">{removeError}</p>
                    ) : null}
                    <div className="flex gap-3 pt-2">
                      <Button
                        variant="danger"
                        className="w-auto px-5"
                        loading={removeBusy}
                        onClick={() => void confirmRemove()}
                      >
                        Remove
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-auto px-5"
                        disabled={removeBusy}
                        onClick={() => setRemoving(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button onClick={() => setMode('add')}>Add recipient</Button>
    </div>
  );
}
