import { describe, expect, it } from 'vitest';
import type { Policy } from '@thesauros/shared';
import { nextScheduledDate, scheduledObligations } from '../src/schedule';

const ONE = 1_000_000n;
const RID = '11111111-2222-3333-4444-555555555555';

const policyWith = (recipients: unknown[]): Policy => ({ recipients }) as unknown as Policy;

describe('nextScheduledDate', () => {
  it('is today when the payment day is today', () => {
    expect(nextScheduledDate('2026-10-15', 15)).toBe('2026-10-15');
  });
  it('is later this month when the day has not come yet', () => {
    expect(nextScheduledDate('2026-10-15', 20)).toBe('2026-10-20');
  });
  it('rolls to next month when the day has already passed (no catch-up payment)', () => {
    expect(nextScheduledDate('2026-10-15', 1)).toBe('2026-11-01');
  });
  it('rolls over the year', () => {
    expect(nextScheduledDate('2026-12-20', 5)).toBe('2027-01-05');
  });
  it('caps the day at 28', () => {
    expect(nextScheduledDate('2026-02-10', 31)).toBe('2026-02-28');
  });
});

describe('scheduledObligations', () => {
  it('creates one obligation per scheduled recipient, with the scheduled amount', () => {
    const out = scheduledObligations(
      policyWith([
        { id: RID, schedule: { dayOfMonth: 15, amountMicroUsd: 95n * ONE } },
        { id: '22222222-2222-3333-4444-555555555555', schedule: undefined },
      ]),
      '2026-10-15',
    );
    expect(out).toEqual([{ recipientId: RID, amount: 95n * ONE, dueDate: '2026-10-15' }]);
  });

  it('skips recipients with no schedule, a zero amount, or a non-uuid id', () => {
    const out = scheduledObligations(
      policyWith([
        { id: RID, schedule: { dayOfMonth: 15, amountMicroUsd: 0n } },
        { id: 'not-a-uuid', schedule: { dayOfMonth: 15, amountMicroUsd: 5n * ONE } },
      ]),
      '2026-10-15',
    );
    expect(out).toEqual([]);
  });
});
