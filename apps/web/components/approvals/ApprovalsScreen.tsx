'use client';
// Approvals queue. This screen only lists and filters; opening a card embeds the existing
// ApprovalSheet/ApprovalSign (signing, message-fetching and verification live there, not here).
import { useState } from 'react';
import { ApprovalSheet, timeLeft } from '@/components/sign/ApprovalSign';
import {
  EmptyState,
  ErrorPanel,
  LoadBar,
  Row,
  RowSkeleton,
  SegmentedControl,
} from '@/components/primitives';
import { zApprovalList, type Approval } from '@/lib/contracts';
import { useApi } from '@/lib/useApi';
import { useNow } from '@/lib/useNow';

export type ApprovalFilter = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
export const APPROVAL_FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
] as const satisfies readonly { value: ApprovalFilter; label: string }[];

/** A pending approval whose expiry has lapsed reads as "expired" even before the server re-labels it. */
export function displayStatus(a: Approval, now: number): string {
  if (a.status === 'pending' && timeLeft(a.expiresAt, now) === null) return 'expired';
  return a.status;
}

function statusNote(status: string): string | null {
  if (status === 'cancelled')
    return 'Cancelled because the policy changed after this was proposed. Thesauros will ask again under the new rules if it still applies.';
  if (status === 'expired')
    return 'This request expired before you decided. Nothing was done. Ask Thesauros to re-evaluate on its next check.';
  return null;
}

export function ApprovalsScreen() {
  const now = useNow(30_000);
  const [filter, setFilter] = useState<ApprovalFilter>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useApi(`/api/approvals?status=${filter}`, zApprovalList, { refetchInterval: 8_000 });

  const approvals = q.data?.approvals ?? [];
  const open = approvals.find((a) => a.id === openId) ?? null;

  return (
    <div>
      <div className="px-4 pt-4">
        <SegmentedControl
          label="Filter by status"
          options={APPROVAL_FILTERS}
          value={filter}
          onChange={setFilter}
        />
      </div>

      <div className="pt-2" aria-live="polite">
        {q.isLoading ? (
          <>
            <LoadBar active />
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : q.error && approvals.length === 0 ? (
          <div className="pt-4">
            <ErrorPanel
              title="Thesauros could not load your approvals"
              body="Nothing moved. Check your connection and try again."
              onRetry={q.refetch}
            />
          </div>
        ) : approvals.length === 0 ? (
          <EmptyState
            title={filter === 'pending' ? 'Nothing needs you' : 'Nothing here yet'}
            body={
              filter === 'pending'
                ? 'Thesauros asks for your signature only when a rule says it should. Everything else it decides on its own, within your policy.'
                : `No approvals are ${filter} yet.`
            }
          />
        ) : (
          <ul data-testid="approvals-list">
            {approvals.map((a) => {
              const status = displayStatus(a, now);
              const note = statusNote(status);
              const left = timeLeft(a.expiresAt, now);
              return (
                <li key={a.id}>
                  <Row
                    title={a.rationale ?? `Approval ${a.proposalHash.slice(0, 10)}…`}
                    sub={
                      <>
                        <span className="block text-small text-muted">
                          {status === 'pending' ? (left ?? 'expiring') : status}
                        </span>
                        {note ? <span className="block text-small text-muted">{note}</span> : null}
                      </>
                    }
                    onClick={() => setOpenId(a.id)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ApprovalSheet
        approval={open}
        onClose={() => setOpenId(null)}
        onDecided={() => {
          setOpenId(null);
          q.refetch();
        }}
      />
    </div>
  );
}
