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
import {
  Banner,
  Button,
  EmptyState,
  ErrorPanel,
  Row,
  RowSkeleton,
  TextButton,
} from '@/components/primitives';
import { apiDelete } from '@/lib/api';
import { zRecipientList, zRecipientRemoved, type Recipient } from '@/lib/contracts';
import { formatMoney, groupAddress, toBig } from '@/lib/format';
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
      <div className="px-4 pt-6">
        <TextButton onClick={() => setMode('list')}>← Back to recipients</TextButton>
        <div className="pt-4">
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
      <div className="px-4 pt-6">
        <TextButton onClick={() => setMode('list')}>← Back to recipients</TextButton>
        <div className="pt-4">
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
      <div className="px-4 pt-6">
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
    <div>
      <div className="px-4 pt-4" aria-live="polite">
        {q.isLoading ? (
          <>
            <RowSkeleton />
            <RowSkeleton />
          </>
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
          <ul data-testid="recipients-list">
            {recipients.map((r: Recipient) => (
              <li key={r.id}>
                <Row
                  title={r.label}
                  sub={
                    <>
                      <span className="block font-mono text-small text-muted">
                        {groupAddress(r.address).slice(0, 14)}…
                      </span>
                      <span className="block text-small text-muted">
                        Up to {formatMoney(toBig(r.maxPerTx))} per payment
                        {r.scheduleDayOfMonth
                          ? ` · monthly on day ${r.scheduleDayOfMonth}`
                          : ''} · {r.riskTier} risk
                      </span>
                    </>
                  }
                  right={
                    <span className="flex flex-col items-end gap-1">
                      <TextButton onClick={() => copy(r.address)}>
                        {copied === r.address ? 'Copied' : 'Copy'}
                      </TextButton>
                      <TextButton
                        onClick={() => {
                          setEditing(r);
                          setMode('edit');
                        }}
                      >
                        Edit
                      </TextButton>
                      <TextButton
                        onClick={() => {
                          setRemoveError(null);
                          setRemoving(r);
                        }}
                      >
                        Remove
                      </TextButton>
                    </span>
                  }
                />
                {removing?.id === r.id ? (
                  <div className="mx-4 mb-3 rounded-md bg-deny-tint p-3" role="alert">
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

      <div className="px-4 pt-6">
        <Button onClick={() => setMode('add')}>Add recipient</Button>
      </div>
    </div>
  );
}
