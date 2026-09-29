'use client';
// Polls GET /api/dashboard every POLL_MS, keeps the last good data on screen when a refresh fails
// (stale, never blank), and shows skeletons / an error panel only when there is nothing to show yet.
import { ErrorPanel, LoadBar, RowSkeleton, Skeleton } from '@/components/primitives';
import { ApiError } from '@/lib/api';
import { zDashboard } from '@/lib/contracts';
import { POLL_MS, useApi } from '@/lib/useApi';
import { useNow } from '@/lib/useNow';
import { DashboardView } from './DashboardView';

export function DashboardSkeleton() {
  return (
    <div className="px-4 pt-4" aria-busy="true">
      <Skeleton className="h-[172px] w-full rounded-lg" />
      <div className="flex justify-between px-2 pt-6">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="size-[52px] rounded-full" />
        ))}
      </div>
      <div className="pt-6">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </div>
      <p className="sr-only" role="status">
        Loading your treasury
      </p>
    </div>
  );
}

export function DashboardScreen() {
  const dash = useApi('/api/dashboard', zDashboard, { refetchInterval: POLL_MS });
  const now = useNow(10_000);

  if (dash.data)
    return (
      <>
        <LoadBar active={dash.isFetching && dash.updatedAt === undefined} />
        <DashboardView
          d={dash.data}
          updatedAt={dash.updatedAt}
          nowMs={now}
          onRefresh={dash.refetch}
        />
      </>
    );
  if (dash.error) {
    const notReady = dash.error instanceof ApiError && dash.error.status === 404;
    return (
      <div className="pt-6">
        <ErrorPanel
          title={notReady ? 'Finish setting up first' : 'Thesauros could not load your treasury'}
          body={
            notReady
              ? 'Your account has no agent wallet yet. Nothing has moved. Finish setup to see your treasury.'
              : 'Thesauros could not read your balances. Nothing moved and your funds are untouched. Try again in a moment.'
          }
          onRetry={dash.refetch}
        />
      </div>
    );
  }
  return (
    <>
      <LoadBar active />
      <DashboardSkeleton />
    </>
  );
}
