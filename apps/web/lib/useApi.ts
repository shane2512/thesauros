'use client';
// One polling data hook for the whole app: react-query around `apiGet`. `updatedAt` is the time of
// the last SUCCESSFUL read, which is what the stale indicator needs.
import { useQuery } from '@tanstack/react-query';
import type { ZodType } from 'zod';
import { apiGet, ApiError } from './api';

export const POLL_MS = 8_000;

export function useApi<T>(
  path: string,
  schema: ZodType<T>,
  opts: { refetchInterval?: number | false; enabled?: boolean } = {},
) {
  const q = useQuery<T, ApiError>({
    queryKey: [path],
    queryFn: () => apiGet(path, schema),
    refetchInterval: opts.refetchInterval ?? false,
    enabled: opts.enabled ?? true,
    // a 401 is an answer, not a blip: do not hammer it
    retry: (n, e) => e.status !== 401 && e.status !== 404 && n < 2,
  });
  return {
    data: q.data,
    error: q.error,
    isLoading: q.isPending && q.fetchStatus !== 'idle',
    isFetching: q.isFetching,
    updatedAt: q.dataUpdatedAt > 0 ? q.dataUpdatedAt : undefined,
    refetch: () => void q.refetch(),
    refreshFailed: q.isError && q.data !== undefined,
  };
}
