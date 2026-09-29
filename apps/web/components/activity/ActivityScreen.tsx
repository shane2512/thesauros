'use client';
// Activity: loop heartbeat, telemetry over what is loaded, verdict filter, a day-grouped feed of
// decision cards (each opens its own Event & proof page), and the audit chain verifier.
import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type CSSProperties } from 'react';
import { IconBolt } from '@/components/icons';
import {
  Button,
  EmptyState,
  ErrorPanel,
  LoadBar,
  RowSkeleton,
  SegmentedControl,
} from '@/components/primitives';
import { apiGet, ApiError } from '@/lib/api';
import { zDashboard, zDecisionList, type DecisionItem } from '@/lib/contracts';
import { downloadAudit } from '@/lib/download';
import { formatAgo, formatToken, toBig } from '@/lib/format';
import { POLL_MS, useApi } from '@/lib/useApi';
import { useNow } from '@/lib/useNow';
import { AuditChainCard } from './AuditChain';
import { DecisionCard } from './DecisionRow';

export type Filter = 'all' | 'ALLOW' | 'ESCALATE' | 'DENY';
export const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'ESCALATE', label: 'Needs you' },
  { value: 'ALLOW', label: 'Allowed' },
  { value: 'DENY', label: 'Denied' },
] as const satisfies readonly { value: Filter; label: string }[];

export const applyFilter = (items: readonly DecisionItem[], f: Filter): DecisionItem[] =>
  f === 'all' ? [...items] : items.filter((i) => i.verdict?.decision === f);

const isFilter = (v: string | null): v is Filter =>
  v === 'all' || v === 'ALLOW' || v === 'ESCALATE' || v === 'DENY';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today · 30 Sep", "Yesterday · 29 Sep", "27 Sep". */
export function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return `Today · ${date}`;
  if (days === 1) return `Yesterday · ${date}`;
  return date;
}

function groupByDay(items: readonly DecisionItem[], now: Date) {
  const groups: { label: string; items: DecisionItem[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function Heartbeat({ nowMs }: { nowMs: number }) {
  const dash = useApi('/api/dashboard', zDashboard, { refetchInterval: POLL_MS });
  const d = dash.data;
  const now = new Date(nowMs);
  const state = !d
    ? { word: 'Checking the agent loop', dot: 'bg-muted' }
    : d.wallet.frozen
      ? { word: 'Agent loop frozen', dot: 'bg-deny' }
      : d.paused
        ? { word: 'Agent loop paused', dot: 'bg-escalate' }
        : { word: 'Agent loop online', dot: 'bg-accent breathe' };
  return (
    <div className="card flex items-center justify-between gap-2 px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className={`size-2 shrink-0 rounded-full ${state.dot}`} aria-hidden="true" />
        <span className="label text-ink">{state.word}</span>
        {d?.lastLoopAt ? (
          <span className="truncate text-cap text-muted">
            · last check {formatAgo(d.lastLoopAt, now)}
          </span>
        ) : null}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-cap font-semibold text-muted">
        <IconBolt className="size-3.5" /> Every row audited
      </span>
    </div>
  );
}

function Telemetry({ items, pending }: { items: DecisionItem[]; pending: number }) {
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);
  const [exportError, setExportError] = useState(false);
  const allowed = items.filter((i) => i.verdict?.decision === 'ALLOW');
  const allowedTotal = allowed.reduce((s, i) => s + toBig(i.amount), 0n);
  const run = async (f: 'csv' | 'json') => {
    setExporting(f);
    setExportError(false);
    try {
      await downloadAudit(f);
    } catch {
      setExportError(true);
    } finally {
      setExporting(null);
    }
  };
  return (
    <section className="card flex flex-col gap-4 p-5" aria-label="Treasury telemetry">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="label">Treasury telemetry</p>
          <h1 className="pt-0.5 font-display text-section leading-7 font-bold text-ink">
            Autonomous activity
          </h1>
        </div>
        <div
          className="flex items-center gap-1 rounded-sm bg-surface-2 p-1"
          role="group"
          aria-label="Export audit log"
        >
          {(['csv', 'json'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => void run(f)}
              aria-busy={exporting === f || undefined}
              className="min-h-9 rounded-[6px] px-2.5 text-cap font-bold text-ink uppercase hover:bg-card hover:shadow-e1"
            >
              {exporting === f ? '…' : f}
            </button>
          ))}
        </div>
      </div>
      {exportError ? (
        <p role="alert" className="-mt-2 text-fine text-deny">
          Export failed. Nothing changed. Try again.
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="rounded-sm bg-surface-2 p-2.5">
          <p className="text-cap font-semibold text-muted">Decisions</p>
          <p className="tabular pt-1 font-display text-stat-sm leading-7 font-bold text-ink">
            {items.length}
          </p>
          <p className="text-micro text-muted">loaded below</p>
        </div>
        <div className="rounded-sm bg-surface-2 p-2.5">
          <p className="text-cap font-semibold text-muted">Allowed</p>
          <p className="tabular truncate pt-1 font-display text-stat-sm leading-7 font-bold text-ink">
            ${formatToken(allowedTotal)}
          </p>
          <p className="text-micro text-muted">{allowed.length} actions</p>
        </div>
        <Link
          href="/app/approvals"
          className="rounded-sm bg-accent-soft p-2.5 transition-colors hover:bg-accent"
        >
          <p className="text-cap font-bold text-ink">Needs you</p>
          <p className="tabular flex items-baseline gap-1 pt-1 font-display text-stat-sm leading-7 font-bold text-ink">
            {pending}
            {pending > 0 ? (
              <span className="size-1.5 rounded-full bg-deny" aria-hidden="true" />
            ) : null}
          </p>
          <p className="text-micro font-semibold text-ink">Open approvals</p>
        </Link>
      </div>
    </section>
  );
}

export function ActivityScreen() {
  const params = useSearchParams();
  const nowMs = useNow(30_000);
  const now = new Date(nowMs);
  const initial = params.get('filter');
  const [filter, setFilter] = useState<Filter>(isFilter(initial) ? initial : 'all');
  const dash = useApi('/api/dashboard', zDashboard, { refetchInterval: POLL_MS });

  const q = useInfiniteQuery<
    ReturnType<typeof zDecisionList.parse>,
    ApiError,
    { pages: ReturnType<typeof zDecisionList.parse>[] },
    unknown[],
    string | null
  >({
    queryKey: ['/api/decisions'],
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      apiGet(
        `/api/decisions${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`,
        zDecisionList,
      ),
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: POLL_MS,
  });

  const all = q.data?.pages.flatMap((p) => p.decisions) ?? [];
  const items = applyFilter(all, filter);
  const options = FILTERS.map((f) => ({ ...f, count: applyFilter(all, f.value).length }));

  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-6">
      <Heartbeat nowMs={nowMs} />
      <Telemetry items={all} pending={dash.data?.pendingApprovals ?? 0} />

      <SegmentedControl
        label="Filter by verdict"
        options={options}
        value={filter}
        onChange={setFilter}
      />

      <div aria-live="polite" className="flex flex-col gap-4">
        {q.isPending ? (
          <div className="card">
            <LoadBar active />
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : q.isError && all.length === 0 ? (
          <div className="-mx-4">
            <ErrorPanel
              title="Thesauros could not load your activity"
              body="Nothing moved. Your log is safe. Check your connection and try again."
              onRetry={() => void q.refetch()}
            />
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            title="No activity yet"
            body="Thesauros checks in every few minutes. Every decision it makes, allowed or blocked, will show up here with the reasons."
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing matches"
            body="No loaded decisions have that verdict. Try All, or load older activity."
          />
        ) : (
          groupByDay(items, now).map((g) => (
            <section key={g.label} aria-label={g.label} className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className="label">{g.label}</span>
                <span className="text-cap text-muted">
                  {g.items.length} event{g.items.length === 1 ? '' : 's'}
                </span>
              </div>
              {g.items.map((item, i) => (
                <div key={item.id} className="rise-in" style={{ '--i': i } as CSSProperties}>
                  <DecisionCard item={item} now={now} />
                </div>
              ))}
            </section>
          ))
        )}
      </div>

      {q.hasNextPage ? (
        <Button
          variant="ghost"
          onClick={() => void q.fetchNextPage()}
          loading={q.isFetchingNextPage}
        >
          {q.isFetchingNextPage ? 'Loading' : 'Load older activity'}
        </Button>
      ) : null}

      <AuditChainCard />
    </div>
  );
}
