import { describe, expect, it } from 'vitest';
import {
  compareShadowWeek,
  renderLiveTransactions,
  renderShadowReport,
  type PaidRow,
  type ProposalRow,
} from '../src/shadowReport';

const ONE = 1_000_000n;
const d = (s: string) => new Date(`${s}T10:00:00Z`);

const proposal = (over: Partial<ProposalRow>): ProposalRow => ({
  decisionId: 'x',
  at: d('2026-10-14'),
  kind: 'pay_recipient',
  status: 'allowed',
  recipient: 'Asha',
  obligationId: 'o1',
  amount: 500n * ONE,
  codes: [],
  ...over,
});
const paid = (over: Partial<PaidRow>): PaidRow => ({
  date: d('2026-10-15'),
  recipient: 'Asha',
  amount: 500n * ONE,
  ...over,
});

describe('compareShadowWeek', () => {
  it('matches a payment to the same recipient, near the same day and amount', () => {
    const r = compareShadowWeek([proposal({})], [paid({})]);
    expect(r.matched).toHaveLength(1);
    expect(r.proposedNotPaid).toHaveLength(0);
    expect(r.paidNotProposed).toHaveLength(0);
  });

  it('reports a proposed payment the team missed', () => {
    const r = compareShadowWeek([proposal({})], []);
    expect(r.proposedNotPaid).toHaveLength(1);
  });

  it('reports a payment the team made that Thesauros never proposed', () => {
    const r = compareShadowWeek([], [paid({ recipient: 'Stranger' })]);
    expect(r.paidNotProposed).toHaveLength(1);
  });

  it('does not match a different amount or a payment too many days away', () => {
    const wrongAmount = compareShadowWeek([proposal({})], [paid({ amount: 400n * ONE })]);
    expect(wrongAmount.matched).toHaveLength(0);
    const late = compareShadowWeek([proposal({})], [paid({ date: d('2026-10-25') })]);
    expect(late.matched).toHaveLength(0);
  });

  it('counts a re-proposed obligation once, not once per day', () => {
    const daily = [14, 15, 16].map((n) => proposal({ at: d(`2026-10-${n}`) }));
    const r = compareShadowWeek(daily, []);
    expect(r.proposedNotPaid).toHaveLength(1);
  });

  it('flags the same amount paid twice to one recipient within a week', () => {
    const r = compareShadowWeek([], [paid({}), paid({ date: d('2026-10-17') })]);
    expect(r.possibleDuplicates).toHaveLength(1);
  });

  it('lists denied proposals with the rules that blocked them', () => {
    const r = compareShadowWeek(
      [proposal({ status: 'denied', recipient: 'Unknown', codes: ['R05'], amount: 1n * ONE })],
      [],
    );
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0]!.codes).toEqual(['R05']);
  });

  it('sizes idle cash from the largest deposit and estimates yield over the window', () => {
    const deposits = [
      proposal({ kind: 'vault_deposit', amount: 100n * ONE, recipient: undefined }),
      proposal({ kind: 'vault_deposit', amount: 300n * ONE, recipient: undefined }),
    ];
    const r = compareShadowWeek(deposits, [], { apyBps: 400n, windowDays: 365 });
    expect(r.idle.amount).toBe(300n * ONE);
    expect(r.idle.estimatedYield).toBe(12n * ONE);
  });

  it('renders a readable markdown report', () => {
    const md = renderShadowReport('Test team', compareShadowWeek([proposal({})], [paid({})]));
    expect(md).toContain('# Thesauros shadow week: Test team');
    expect(md).toContain('Matched what the team actually paid: **1**');
  });
});

describe('renderLiveTransactions', () => {
  it('lists confirmed transactions with explorer links and totals', () => {
    const md = renderLiveTransactions(
      [
        {
          at: d('2026-10-14'),
          kind: 'pay_recipient',
          amount: 25n * ONE,
          txHash: `0x${'ab'.repeat(32)}`,
        },
        {
          at: d('2026-10-15'),
          kind: 'vault_deposit',
          amount: 100n * ONE,
          txHash: `0x${'cd'.repeat(32)}`,
        },
      ],
      'https://explorer.testnet.arc.io',
    );
    expect(md).toContain('**2** confirmed on-chain transactions moving **125.00 USDC**');
    expect(md).toContain(`https://explorer.testnet.arc.io/tx/0x${'ab'.repeat(32)}`);
    expect(md).toContain('- pay_recipient: 1 (25.00 USDC)');
  });

  it('says so plainly when there are none', () => {
    expect(renderLiveTransactions([], 'https://x')).toContain('No confirmed on-chain transactions');
  });
});
