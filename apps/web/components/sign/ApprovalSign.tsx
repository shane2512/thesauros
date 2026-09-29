'use client';
// Approval signing. `ApprovalSheet` is what the queue opens; the body is exported separately so it
// can be tested without the sheet chrome.
//
// The message is NOT built here. It arrives on the approval from GET /api/approvals, which stores
// it as the row was created, and the server re-derives it from the CURRENT policy version before it
// accepts a signature — so if the policy moved, the signature is refused rather than being applied
// under rules the owner has replaced.
//
// Approving lifts ESCALATE rules only. It can never lift a DENY, and it never executes anything
// here: the worker re-gathers, re-simulates and re-evaluates before a single call is built.
import { useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Button, VerdictBadge, toneOf } from '@/components/primitives';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { zApprovalDecided, zApprovalList, zDecisionDetail, type Approval } from '@/lib/contracts';
import { formatMoney, toBig } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { useNow } from '@/lib/useNow';
import { useSignFlow } from '@/lib/useSignFlow';
import { useSigner } from '@/lib/useSigner';
import { connectAddress, signMessage } from '@/lib/injectedWallet';
import { signErrorCopy, type SignError } from '@/lib/signCopy';
import { BlockerPanel, FactRow, LiteralPayload, SignErrorPanel, SignStatus } from './SignSurface';

/** `4h 12m left`, `12 min left`, or null once it has lapsed. */
export function timeLeft(expiresAt: string, now: number): string | null {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(1, mins)} min left`;
  const hours = Math.floor(mins / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)}d left`;
  return `${hours}h ${mins % 60}m left`;
}

export function ApprovalSign({
  approval,
  onDecided,
}: {
  approval: Approval;
  onDecided: () => void;
}) {
  const now = useNow(30_000);
  const { blocker, switchNetwork, switching } = useSigner(undefined);
  const [address, setAddress] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<SignError | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const detail = useApi(`/api/decisions/${approval.decisionId}`, zDecisionDetail);

  const left = timeLeft(approval.expiresAt, now);
  const expired = left === null;
  const pending = approval.status === 'pending';

  const flow = useSignFlow<string>({
    // Re-read the queue before asking the wallet for anything: an approval that expired, was
    // cancelled by a policy change or was decided in another tab must not reach a signature prompt.
    prepare: async () => {
      const list = await apiGet('/api/approvals?status=pending', zApprovalList);
      const fresh = list.approvals.find((a) => a.id === approval.id);
      if (!fresh) throw new ApiError(409, 'not_pending', 'this approval is no longer pending');
      return fresh.message;
    },
    sign: async (message) => {
      const addr = address ?? (await connectAddress());
      setAddress(addr);
      return signMessage(addr, message);
    },
    submit: (_m, signature) =>
      apiPost(`/api/approvals/${approval.id}`, zApprovalDecided, {
        decision: 'approved',
        signature,
      }).then(() => undefined),
    onDone: onDecided,
  });

  const reject = () => {
    setRejectError(null);
    setRejecting(true);
    void apiPost(`/api/approvals/${approval.id}`, zApprovalDecided, { decision: 'rejected' })
      .then(() => onDecided())
      .catch((e: unknown) => setRejectError(signErrorCopy(e)))
      .finally(() => setRejecting(false));
  };

  const amount = detail.data?.decision.amount;
  const checks = (detail.data?.verdict?.checks ?? []).filter((c) => c.result !== 'PASS');

  return (
    <div data-testid="approval-sign">
      {detail.data ? (
        <p className="font-display text-h2 leading-6 font-bold text-ink">
          {detail.data.decision.title}
        </p>
      ) : null}
      {approval.rationale ? (
        <p className="max-w-[52ch] pt-2 text-small text-muted">{approval.rationale}</p>
      ) : null}

      <div className="mt-4 rounded-md bg-surface-2 px-4 py-2">
        {amount ? <FactRow label="Amount">{formatMoney(toBig(amount))}</FactRow> : null}
        <FactRow label={expired ? 'Expired' : 'Expires'}>
          <span className={expired ? 'text-deny' : 'text-ink'}>
            {left ?? new Date(approval.expiresAt).toLocaleString()}
          </span>
        </FactRow>
      </div>

      {checks.length > 0 ? (
        <ul className="pt-4 space-y-2" data-testid="approval-checks">
          {checks.map((c) => (
            <li key={c.code} className="flex items-baseline gap-2 text-small">
              <VerdictBadge tone={toneOf(c.result === 'DENY' ? 'DENY' : 'ESCALATE')} />
              <span className="font-mono text-mono text-faint">{c.code}</span>
              <span className="text-muted">{c.message ?? c.sentence}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <LiteralPayload value={flow.prepared ?? approval.message} />

      {blocker !== null && blocker.kind !== 'disconnected' ? (
        <div className="pt-4">
          <BlockerPanel blocker={blocker} onSwitch={switchNetwork} switching={switching} />
        </div>
      ) : null}

      <SignStatus phase={flow.phase} />
      {flow.error ? <SignErrorPanel error={flow.error} /> : null}
      {rejectError ? <SignErrorPanel error={rejectError} /> : null}

      {expired ? (
        <p role="status" className="pt-4 text-small text-muted" data-testid="approval-expired">
          This request expired, so Thesauros let it lapse rather than acting on it. Nothing was
          done. Thesauros will look at it again on its next check and ask you afresh if it still
          applies.
        </p>
      ) : null}
      {!pending && !expired ? (
        <p role="status" className="pt-4 text-small text-muted">
          This was already {approval.status}. Nothing further will happen.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 pt-6">
        <Button
          className="rounded-sm"
          disabled={expired || !pending || flow.phase === 'done'}
          loading={flow.phase === 'awaiting-signature' || flow.phase === 'submitting'}
          onClick={flow.prepared === null ? flow.prepare : flow.confirm}
        >
          {flow.prepared === null ? 'Approve' : 'Sign & execute'}
        </Button>
        <Button
          variant="soft"
          className="rounded-sm"
          disabled={!pending}
          loading={rejecting}
          onClick={reject}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

export function ApprovalSheet({
  approval,
  onClose,
  onDecided,
}: {
  approval: Approval | null;
  onClose: () => void;
  onDecided: () => void;
}) {
  if (!approval) return null;
  return (
    <Sheet open title="Thesauros needs you" onClose={onClose}>
      <ApprovalSign approval={approval} onDecided={onDecided} />
    </Sheet>
  );
}
