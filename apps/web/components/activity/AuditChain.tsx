'use client';
// The audit chain, verified on demand. Every decision, verdict and execution is an append-only,
// hash-chained audit row (I6); this re-walks the chain server-side and says whether it is intact.
import { useState } from 'react';
import { IconFingerprint, IconShieldCheck } from '@/components/icons';
import { Button } from '@/components/primitives';
import { apiGet } from '@/lib/api';
import { zAuditVerify, type AuditVerify } from '@/lib/contracts';

export function useAuditVerify() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuditVerify | null>(null);
  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await apiGet('/api/audit/verify', zAuditVerify));
    } catch {
      setResult({ ok: false, break: { rowId: -1, reason: 'network', expected: '', actual: '' } });
    } finally {
      setBusy(false);
    }
  };
  return { busy, result, run };
}

export function AuditVerifyResult({ result }: { result: AuditVerify | null }) {
  return (
    <div aria-live="polite">
      {result === null ? null : result.ok ? (
        <p className="mt-3 flex items-center gap-2 rounded-sm bg-allow-tint px-3 py-2 text-meta font-semibold text-allow">
          <IconShieldCheck className="size-4 shrink-0" />
          Verified: {result.rows} rows, unbroken from the first to the last.
        </p>
      ) : result.break.reason === 'network' ? (
        <p role="alert" className="mt-3 rounded-sm bg-deny-tint px-3 py-2 text-meta text-deny">
          Could not reach the server to verify. Nothing changed. Try again.
        </p>
      ) : (
        <p role="alert" className="mt-3 rounded-sm bg-deny-tint px-3 py-2 text-meta text-deny">
          Chain broken at row {result.break.rowId}: {result.break.reason}. Expected{' '}
          {result.break.expected || '(none)'}, found {result.break.actual || '(none)'}.
        </p>
      )}
    </div>
  );
}

export function AuditChainCard() {
  const v = useAuditVerify();
  return (
    <section aria-label="Audit chain" className="card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-inverse text-on-inverse">
          <IconFingerprint className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-title font-semibold text-ink">Hash-chained audit log</h2>
          <p className="pt-0.5 text-meta leading-[18px] text-muted">
            Every context snapshot, proposal, verdict and execution is an append-only row linked to
            the one before it. Re-walk the chain to prove nothing was edited.
          </p>
        </div>
      </div>
      <div className="pt-3">
        <Button
          variant="dark"
          className="h-11 rounded-sm text-ui"
          loading={v.busy}
          onClick={() => void v.run()}
        >
          Verify audit chain
        </Button>
      </div>
      <AuditVerifyResult result={v.result} />
    </section>
  );
}
