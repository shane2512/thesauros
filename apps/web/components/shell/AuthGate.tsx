'use client';
// Session gate for every authenticated screen. It reads GET /api/me; a 401 sends the visitor to
// /connect. This is navigation, not security: every API route re-checks the session itself.
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { ErrorPanel, LoadBar, RowSkeleton, Skeleton } from '@/components/primitives';
import { zMe } from '@/lib/contracts';
import { useApi } from '@/lib/useApi';

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useApi('/api/me', zMe);
  const unauthorized = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthorized) router.replace('/connect');
  }, [unauthorized, router]);

  if (me.data) return <>{children}</>;
  if (me.error && !unauthorized)
    return (
      <div className="mx-auto max-w-[440px] pt-20">
        <ErrorPanel
          title="Thesauros could not load your account"
          body="Nothing moved. Check your connection and try again."
          onRetry={me.refetch}
        />
      </div>
    );
  return (
    <div className="mx-auto max-w-[440px] px-4 pt-20" aria-busy="true">
      <LoadBar active />
      <Skeleton className="h-[132px] w-full rounded-lg" />
      <div className="pt-4">
        <RowSkeleton />
        <RowSkeleton />
      </div>
      <p className="sr-only" role="status">
        Checking your session
      </p>
    </div>
  );
}
