'use client';
import { useEffect, useState } from 'react';

/** Wall-clock ms that re-renders every `every` ms: drives "as of" / stale indicators. */
export function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}
