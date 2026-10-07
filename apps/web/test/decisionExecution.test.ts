import { describe, expect, it } from 'vitest';
import { toDecisionDetail } from '../lib/decisions';

const row = {
  id: '7781b91b-f549-409c-b8f0-ff97cb563677',
  walletId: 'w',
  trigger: 'schedule',
  status: 'allowed',
  proposal: { kind: 'vault_deposit', params: { amount: '9000000', vaultId: 'v1' }, rationale: 'r' },
  proposalSource: 'deterministic',
  createdAt: new Date('2026-10-07T11:23:07.161Z'),
} as never;

describe('toDecisionDetail execution', () => {
  it('shows the transaction the decision produced', () => {
    const detail = toDecisionDetail(row, undefined, undefined, {
      status: 'confirmed',
      txHash: '0xac7b',
      error: null,
      confirmedAt: new Date('2026-10-07T13:39:44.299Z'),
    } as never);
    expect(detail.execution).toEqual({
      status: 'confirmed',
      txHash: '0xac7b',
      error: null,
      confirmedAt: '2026-10-07T13:39:44.299Z',
    });
  });

  it('has no execution when nothing was sent', () => {
    expect(toDecisionDetail(row, undefined, undefined, undefined).execution).toBeNull();
  });
});
