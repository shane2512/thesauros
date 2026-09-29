'use client';
// Timeline: filter, cursor-paginated list, expandable decisions. Below 1024px the detail opens in
// place under its row; from 1024px the list stays at 440 and the detail sits in a sticky pane on
// the right (AppShell's own WIDE set already reserves that width for this route).
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorPanel,
  LoadBar,
  RowSkeleton,
  SegmentedControl,
  Skeleton,
} from '@/components/primitives';
import { apiGet, ApiError } from '@/lib/api';
import { zConfig, zDecisionDetail, zDecisionList, type DecisionItem } from '@/lib/contracts';
import { POLL_MS, useApi } from '@/lib/useApi';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { DecisionDetailView } from './DecisionDetail';
import { DecisionRow } from './DecisionRow';

export type Filter = 'all' | 'ALLOW' | 'ESCALATE' | 'DENY';
export const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'ALLOW', label: 'Allowed' },
  { value: 'ESCALATE', label: 'Needs you' },
  { value: 'DENY', label: 'Denied' },
] as const satisfies readonly { value: Filter; label: string }[];

export const applyFilter = (items: readonly DecisionItem[], f: Filter): DecisionItem[] =>
  f === 'all' ? [...items] : items.filter((i) => i.verdict?.decision === f);

function DetailLoader({
  id,
  explorerBase,
  panelId,
}: {
  id: string;
  explorerBase: string;
  panelId?: string;
}) {
  const q = useApi(`/api/decisions/${encodeURIComponent(id)}`, zDecisionDetail);
  if (q.data)
    return <DecisionDetailView detail={q.data} explorerBase={explorerBase} panelId={panelId} />;
  if (q.error)
    return (
      <div className="-mx-4">
        <ErrorPanel
          title="Thesauros could not load this decision"
          body="Nothing moved. The decision is still in the log. Try again."
          onRetry={q.refetch}
        />
      </div>
    );
  return (
    <div className="rounded-md bg-surface-2 p-4" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-3 h-24 w-full" />
    </div>
  );
}

export function ActivityScreen() {
  const params = useSearchParams();
  const wide = useMediaQuery('(min-width: 1024px)');
  const cfg = useApi('/api/config', zConfig);
  const explorerBase = cfg.data?.explorerBase ?? 'https://explorer.testnet.arc.io';

  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(params.get('open'));

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
  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));

  const list = (
    <>
      <div className="px-4 pt-4">
        <SegmentedControl
          label="Filter by verdict"
          options={FILTERS}
          value={filter}
          onChange={setFilter}
        />
      </div>

      <div className="pt-2" aria-live="polite">
        {q.isPending ? (
          <>
            <LoadBar active />
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : q.isError && all.length === 0 ? (
          <div className="pt-4">
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
          <ul>
            {items.map((item) => {
              const isOpen = open === item.id;
              const panelId = `detail-${item.id}`;
              return (
                <li key={item.id} className={isOpen && !wide ? 'mx-4 rounded-md row-press' : ''}>
                  <DecisionRow
                    item={item}
                    variant="full"
                    expanded={isOpen}
                    onToggle={() => toggle(item.id)}
                    controlsId={panelId}
                  />
                  {isOpen && !wide ? (
                    <div className="px-3 pb-3">
                      <DetailLoader id={item.id} explorerBase={explorerBase} panelId={panelId} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {q.hasNextPage ? (
        <div className="px-4 pt-4">
          <Button
            variant="ghost"
            onClick={() => void q.fetchNextPage()}
            loading={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? 'Loading' : 'Load older activity'}
          </Button>
        </div>
      ) : null}
      <div className="h-6" />
    </>
  );

  if (!wide) return list;
  return (
    <div className="grid grid-cols-[440px_1fr] gap-8">
      <div>{list}</div>
      <aside className="sticky top-20 self-start pt-4 pr-4" aria-label="Decision detail">
        {open ? (
          <DetailLoader id={open} explorerBase={explorerBase} panelId={`detail-${open}`} />
        ) : (
          <div className="rounded-md bg-surface-2 p-6 text-small text-muted">
            Pick a decision to see what Thesauros saw, what it proposed and which rules decided it.
          </div>
        )}
      </aside>
    </div>
  );
}
