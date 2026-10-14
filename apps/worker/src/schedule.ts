// Turns the schedules a signed policy already carries ("pay Samuel 95 USDC on the 15th") into the
// obligations the loop actually pays. Until this existed nothing created the FIRST obligation of a
// recipient: the hourly scan only rolls existing ones forward, so a scheduled payment never came due.
import { appendAudit, ensureNextOccurrence, getActivePolicy, type Db } from '@thesauros/db';
import { zPolicy, type Policy } from '@thesauros/shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The next time a monthly payment on `dayOfMonth` falls due: today if that is today's day, else the
 * next time that day comes round. Never a date already in the past, so signing a policy on the 20th
 * does not trigger a catch-up payment for the 15th. Days are capped at 28 (as the policy caps them).
 */
export function nextScheduledDate(today: string, dayOfMonth: number): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const day = Math.min(dayOfMonth, 28);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (day >= d) return `${y}-${pad(m)}-${pad(day)}`;
  return m === 12 ? `${y + 1}-01-${pad(day)}` : `${y}-${pad(m + 1)}-${pad(day)}`;
}

export type ScheduledObligation = { recipientId: string; amount: bigint; dueDate: string };

/** What the policy's recipient schedules ask for, as of `today` (YYYY-MM-DD). Pure. */
export function scheduledObligations(policy: Policy, today: string): ScheduledObligation[] {
  const out: ScheduledObligation[] = [];
  for (const r of policy.recipients) {
    if (!r.schedule || !UUID.test(r.id)) continue;
    const amount = BigInt(r.schedule.amountMicroUsd);
    if (amount <= 0n) continue;
    out.push({
      recipientId: r.id,
      amount,
      dueDate: nextScheduledDate(today, r.schedule.dayOfMonth),
    });
  }
  return out;
}

/** Create any missing obligation for the active policy. Idempotent; returns how many were created. */
export async function materializeScheduledObligations(
  db: Db,
  walletId: string,
  now: Date,
): Promise<number> {
  const active = await getActivePolicy(db, walletId);
  if (!active) return 0;
  const parsed = zPolicy.safeParse(active.body);
  if (!parsed.success) return 0;
  let created = 0;
  for (const o of scheduledObligations(parsed.data, now.toISOString().slice(0, 10))) {
    const id = await ensureNextOccurrence(
      db,
      { walletId, recipientId: o.recipientId, amount: o.amount, recurrence: 'monthly' },
      o.dueDate,
    );
    if (!id) continue;
    created += 1;
    await appendAudit(db, {
      walletId,
      actor: 'system',
      event: 'OBLIGATION_SCHEDULED',
      entityType: 'obligation',
      entityId: id,
      payload: { from: 'policy schedule', dueDate: o.dueDate, amount: o.amount.toString() },
      createdAt: now,
    });
  }
  return created;
}
