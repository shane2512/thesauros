// Shared by /api/policy/recipients (list/add) and its [id] child (edit/remove) — Next.js route
// files may only export recognized handlers, so this can't live in route.ts itself.
import type { listRecipients } from '@thesauros/db';

// bigint (the `money` column) can't go through JSON.stringify as-is (I12: base units stay bigint
// everywhere until they cross an HTTP boundary, where they become decimal strings).
export function serializeRecipient(r: Awaited<ReturnType<typeof listRecipients>>[number]) {
  const schedule = r.schedule as { dayOfMonth?: number } | null;
  return {
    id: r.id,
    label: r.label,
    address: r.address,
    maxPerTx: r.maxPerTx.toString(),
    scheduleDayOfMonth: schedule?.dayOfMonth ?? null,
    riskTier: r.riskTier,
    status: r.status,
  };
}
