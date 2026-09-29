'use client';
// Recipients. The list/add chrome lives here; validation, the poisoning warning and the signature
// all live in AddRecipientSign — embedded, not rebuilt. Adding a recipient is inert until the owner
// also signs the next policy version (it isn't in the active policy's recipients array yet), so a
// successful add always routes into PolicySign next — the same S7 diff+sign surface /app/policy uses.
import { useState } from 'react';
import { AddRecipientSign } from '@/components/sign/AddRecipientSign';
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
import { zRecipientList, type Recipient } from '@/lib/contracts';
import { formatMoney, groupAddress, toBig } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Mode = 'list' | 'add' | 'sign-policy';

export function RecipientsScreen() {
  const [mode, setMode] = useState<Mode>('list');
  const [copied, setCopied] = useState<string | null>(null);
  const q = useApi('/api/policy/recipients', zRecipientList);
  const recipients = q.data?.recipients ?? [];

  const copy = (addr: string) => {
    void navigator.clipboard?.writeText(addr).then(() => {
      setCopied(addr);
      setTimeout(() => setCopied(null), 2000);
    });
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

  if (mode === 'sign-policy')
    return (
      <div className="px-4 pt-6">
        <Banner tone="info" title="One more step">
          This recipient cannot be paid yet. Sign the next policy version to add them to what
          Thesauros is allowed to do.
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
                    <TextButton onClick={() => copy(r.address)}>
                      {copied === r.address ? 'Copied' : 'Copy'}
                    </TextButton>
                  }
                />
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
