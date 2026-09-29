'use client';
// Account closure: freeze -> revoke -> sweep -> export -> delete personal data. The first three
// steps are FreezeFlow's own domain — embedded here, not reimplemented. Export reuses Settings' own
// export call. Delete personal data never touches audit_log (I6): it only clears the PII fields
// Thesauros owns, via POST /api/account/delete-personal-data.
import { useState, type ReactNode } from 'react';
import { FreezeFlow } from '@/components/freeze/FreezeFlow';
import { Banner, Button, Eyebrow } from '@/components/primitives';
import { apiPost } from '@/lib/api';
import { zDashboard, zPersonalDataDeleted } from '@/lib/contracts';
import { useApi } from '@/lib/useApi';

type StepState = 'todo' | 'done';

function StepRow({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  children?: ReactNode;
}) {
  return (
    <li className="border-b border-line py-4 last:border-0">
      <div className="flex items-center gap-3">
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-full text-small font-bold ${
            state === 'done' ? 'bg-surface-3 text-allow' : 'bg-surface-2 text-muted'
          }`}
          aria-hidden="true"
        >
          {state === 'done' ? '✓' : n}
        </span>
        <span className="text-h3 font-semibold text-ink">{title}</span>
        <span className="ml-auto text-small text-muted">{state === 'done' ? 'Done' : ''}</span>
      </div>
      {children ? <div className="pt-3 pl-10">{children}</div> : null}
    </li>
  );
}

export function ClosureChecklist() {
  const dash = useApi('/api/dashboard', zDashboard);
  const [exported, setExported] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const frozen = dash.data?.wallet.frozen ?? false;

  const runExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/audit/export?format=json', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const blob = new Blob([await res.text()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'thesauros-audit.json';
      a.click();
      URL.revokeObjectURL(url);
      setExported(true);
    } finally {
      setExporting(false);
    }
  };

  const runDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await apiPost('/api/account/delete-personal-data', zPersonalDataDeleted);
      setDeleted(true);
    } catch {
      setError('Thesauros could not delete your personal data. Nothing changed. Try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="pb-10">
      <Eyebrow>Close your account</Eyebrow>
      <p className="max-w-[52ch] px-4 text-small text-muted">
        Work through these in order. Each step is safe to retry, and your audit log is never deleted
        — closing your account anonymizes it, it does not erase it.
      </p>

      <ol className="px-4 pt-2">
        <StepRow n={1} title="Freeze, revoke and sweep home" state={frozen ? 'done' : 'todo'}>
          <FreezeFlow frozen={frozen} onDone={() => dash.refetch()} onClose={() => undefined} />
        </StepRow>

        <StepRow n={2} title="Export your audit log" state={exported ? 'done' : 'todo'}>
          <Button
            variant="ghost"
            className="w-auto"
            loading={exporting}
            onClick={() => void runExport()}
          >
            Export JSON
          </Button>
        </StepRow>

        <StepRow n={3} title="Delete your personal data" state={deleted ? 'done' : 'todo'}>
          <p className="max-w-[46ch] pb-3 text-small text-muted">
            This clears your display name and Telegram link from Thesauros. Your audit history
            stays, without your name attached to it — the ledger is append-only and never deleted
            (I6).
          </p>
          {error ? (
            <p role="alert" className="pb-2 text-small text-deny">
              {error}
            </p>
          ) : null}
          {deleted ? (
            <Banner tone="info" title="Deleted">
              Your personal data was cleared.
            </Banner>
          ) : (
            <Button
              variant="danger"
              className="w-auto"
              disabled={!frozen}
              loading={deleting}
              onClick={() => void runDelete()}
            >
              Delete my personal data
            </Button>
          )}
          {!frozen ? (
            <p className="pt-2 text-small text-muted">Freeze the wallet first (step 1).</p>
          ) : null}
        </StepRow>
      </ol>
    </div>
  );
}
