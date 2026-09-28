// 6.2 — PreChecks are pure, so they are tested pure: no database, no RPC, no network, no clock.
// Every case here is a shape the live loop will actually hit.
import { describe, expect, it } from 'vitest';
import { hashProposal } from '@thesauros/policy';
import type { Policy, Proposal } from '@thesauros/shared';
import {
  MIN_ACTION_BASE_UNITS,
  PAYROLL_FLOAT_DAYS,
  preChecks,
  type PreCheckInput,
} from '../src/prechecks';

const ONE = 1_000_000n;
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const VAULT = '0x3741f0da6dFFfFD8Be2353e326a49E41a3396485';
const ALEX = '0x1111111111111111111111111111111111111111';
const NOW = new Date('2026-09-21T10:00:00.000Z');

const policy = (over: Partial<Policy> = {}): Policy =>
  ({
    version: 1,
    walletId: 'w1',
    chainId: 5042002,
    treasuryAddress: '0x00000000000000000000000000000000000f1a7f',
    tokens: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
    vaults: [
      {
        id: 'v1',
        name: 'Demo Vault',
        address: VAULT,
        asset: USDC,
        kind: 'erc4626',
        maxAllocationBps: 10_000,
      },
    ],
    recipients: [{ id: 'alex', label: 'Alex', address: ALEX, maxPerTxMicroUsd: 10_000n * ONE }],
    limits: { perTxMicroUsd: 50_000n * ONE, dailyMicroUsd: 60_000n * ONE, maxActionsPerHour: 10 },
    runwayBufferMicroUsd: 120_000n * ONE,
    approvalThresholdMicroUsd: 15_000n * ONE,
    depegThresholdBps: 50,
    vaultDrawdownBps: 100,
    autonomousKinds: [
      'pull_allowance',
      'vault_deposit',
      'vault_withdraw',
      'pay_recipient',
      'risk_exit',
      'noop',
    ],
    createdAt: NOW.toISOString(),
    signedBy: '0x00000000000000000000000000000000000f1a7f',
    signature: '0xdeadbeef',
    ...over,
  }) as Policy;

const input = (over: Partial<PreCheckInput> = {}): PreCheckInput => ({
  now: NOW,
  policy: policy(),
  decimals: 6,
  frozen: false,
  breakerOpen: false,
  agentUsdc: 0n,
  treasuryUsdc: 0n,
  allowanceRemaining: 0n,
  vaults: [
    {
      id: 'v1',
      positionAssets: 0n,
      redeemableAssets: 0n,
      shares: 0n,
      maxAllocationBps: 10_000,
      flagged: false,
    },
  ],
  obligations: [],
  riskTriggers: [],
  runwayBufferBaseUnits: 120_000n * ONE,
  perTxBaseUnits: 50_000n * ONE,
  degraded: false,
  ...over,
});

/** Narrow the union so a test can read the proposal without a cast. */
function deterministic(result: ReturnType<typeof preChecks>): Proposal {
  expect(result.kind).toBe('deterministic');
  if (result.kind !== 'deterministic') throw new Error('unreachable');
  return result.proposal;
}

describe('preChecks — the owner always wins', () => {
  it('skips a frozen wallet before anything else is considered', () => {
    const result = preChecks(
      input({
        frozen: true,
        riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown', observed: 'x' }],
      }),
    );
    expect(result).toEqual({ kind: 'skip', reason: 'wallet is frozen' });
  });

  it('skips an open circuit breaker', () => {
    expect(preChecks(input({ breakerOpen: true }))).toEqual({
      kind: 'skip',
      reason: 'circuit breaker is open',
    });
  });
});

describe('preChecks — (a) risk exits', () => {
  it('proposes risk_exit for a drawdown, ahead of payroll and yield', () => {
    const result = preChecks(
      input({
        agentUsdc: 500_000n * ONE, // plenty idle; the exit must still win
        treasuryUsdc: 500_000n * ONE,
        allowanceRemaining: 50_000n * ONE,
        vaults: [
          {
            id: 'v1',
            positionAssets: 40_000n * ONE,
            redeemableAssets: 39_900n * ONE,
            shares: 40_000n * ONE,
            maxAllocationBps: 10_000,
            flagged: true,
          },
        ],
        obligations: [{ id: 'o1', policyRecipientId: 'alex', amount: 3_000n * ONE, dueDate: NOW }],
        riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown', observed: '-300 bps' }],
      }),
    );
    const proposal = deterministic(result);
    expect(proposal.kind).toBe('risk_exit');
    expect(proposal.source).toBe('deterministic');
    // R20: funds move vault -> agent ONLY, and nothing may decrease.
    expect(proposal.expectedDeltas).toEqual([
      { token: USDC, holder: 'agent', delta: 39_900n * ONE },
    ]);
  });

  it('does not propose a risk exit for a vault with no shares', () => {
    const result = preChecks(
      input({ riskTriggers: [{ vaultId: 'v1', trigger: 'asset_depeg', observed: 'off peg' }] }),
    );
    expect(result.kind).toBe('noop');
  });

  it('proposes the exit even when risk_exit is not in autonomousKinds (R20 pre-authorises it)', () => {
    const result = preChecks(
      input({
        policy: policy({ autonomousKinds: ['noop'] }),
        vaults: [
          {
            id: 'v1',
            positionAssets: 10n * ONE,
            redeemableAssets: 10n * ONE,
            shares: 10n * ONE,
            maxAllocationBps: 10_000,
            flagged: false,
          },
        ],
        riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown', observed: '-200 bps' }],
      }),
    );
    expect(deterministic(result).kind).toBe('risk_exit');
  });
});

describe('preChecks — (b) obligations due', () => {
  it('pays a due obligation the agent can already cover', () => {
    const result = preChecks(
      input({
        agentUsdc: 6_000n * ONE,
        obligations: [{ id: 'o1', policyRecipientId: 'alex', amount: 3_000n * ONE, dueDate: NOW }],
      }),
    );
    const proposal = deterministic(result);
    expect(proposal.kind).toBe('pay_recipient');
    expect(proposal.params).toEqual({
      recipientId: 'alex',
      amount: 3_000n * ONE,
      obligationId: 'o1',
    });
    expect(proposal.expectedDeltas).toEqual([
      { token: USDC, holder: 'agent', delta: -3_000n * ONE },
      { token: USDC, holder: 'recipient', delta: 3_000n * ONE },
    ]);
  });

  it('pulls the shortfall from the allowance first', () => {
    const result = preChecks(
      input({
        agentUsdc: 1_000n * ONE,
        treasuryUsdc: 200_000n * ONE,
        allowanceRemaining: 50_000n * ONE,
        obligations: [{ id: 'o1', policyRecipientId: 'alex', amount: 3_000n * ONE, dueDate: NOW }],
      }),
    );
    const proposal = deterministic(result);
    expect(proposal.kind).toBe('pull_allowance');
    expect(proposal.params).toEqual({ amount: 2_000n * ONE });
  });

  it('withdraws from a vault when there is no allowance left', () => {
    const result = preChecks(
      input({
        agentUsdc: 0n,
        treasuryUsdc: 0n,
        allowanceRemaining: 0n,
        vaults: [
          {
            id: 'v1',
            positionAssets: 50_000n * ONE,
            redeemableAssets: 50_000n * ONE,
            shares: 50_000n * ONE,
            maxAllocationBps: 10_000,
            flagged: false,
          },
        ],
        obligations: [{ id: 'o1', policyRecipientId: 'alex', amount: 3_000n * ONE, dueDate: NOW }],
      }),
    );
    const proposal = deterministic(result);
    expect(proposal.kind).toBe('vault_withdraw');
    expect(proposal.params).toEqual({ vaultId: 'v1', amount: 3_000n * ONE });
  });

  it('NOOPs (never half-pays) when an obligation cannot be funded at all', () => {
    const result = preChecks(
      input({
        obligations: [{ id: 'o1', policyRecipientId: 'alex', amount: 3_000n * ONE, dueDate: NOW }],
      }),
    );
    expect(result.kind).toBe('noop');
    expect(result.kind === 'noop' && result.reason).toContain('no way to fund it');
  });

  it('ignores an obligation whose recipient is not in the Policy (I4)', () => {
    const result = preChecks(
      input({
        agentUsdc: 6_000n * ONE,
        obligations: [{ id: 'o1', policyRecipientId: null, amount: 3_000n * ONE, dueDate: NOW }],
      }),
    );
    expect(result.kind).not.toBe('deterministic');
  });

  it('ignores obligations that are not due yet', () => {
    const later = new Date(NOW.getTime() + 3 * 86_400_000);
    const result = preChecks(
      input({
        agentUsdc: 6_000n * ONE,
        obligations: [
          { id: 'o1', policyRecipientId: 'alex', amount: 3_000n * ONE, dueDate: later },
        ],
      }),
    );
    expect(result.kind).not.toBe('deterministic');
  });
});

describe('preChecks — (c) idle cash (D-37: the model will not do this reliably)', () => {
  it('pulls within the allowance when the treasury holds the idle cash', () => {
    const result = preChecks(
      input({
        treasuryUsdc: 200_000n * ONE,
        agentUsdc: 0n,
        allowanceRemaining: 50_000n * ONE,
      }),
    );
    const proposal = deterministic(result);
    expect(proposal.kind).toBe('pull_allowance');
    // 200k liquid - 120k buffer = 80k deployable, capped by the 50k allowance.
    expect(proposal.params).toEqual({ amount: 50_000n * ONE });
    // Treasury -> agent: both liquid, so R08 is untouched.
    expect(proposal.expectedDeltas).toEqual([
      { token: USDC, holder: 'agent', delta: 50_000n * ONE },
      { token: USDC, holder: 'treasury', delta: -50_000n * ONE },
    ]);
  });

  it('never pulls more than the treasury actually holds', () => {
    const result = preChecks(
      input({ treasuryUsdc: 130_000n * ONE, allowanceRemaining: 50_000n * ONE }),
    );
    expect(deterministic(result).params).toEqual({ amount: 10_000n * ONE });
  });

  it('deposits what the agent holds, keeping the buffer and the payroll float', () => {
    const soon = new Date(NOW.getTime() + 2 * 86_400_000);
    const result = preChecks(
      input({
        treasuryUsdc: 150_000n * ONE,
        agentUsdc: 50_000n * ONE,
        allowanceRemaining: 0n,
        obligations: [{ id: 'o1', policyRecipientId: 'alex', amount: 5_500n * ONE, dueDate: soon }],
      }),
    );
    const proposal = deterministic(result);
    expect(proposal.kind).toBe('vault_deposit');
    // liquid 200k - buffer 120k - obligations 5.5k = 74.5k deployable;
    // the agent holds 50k and must keep 5.5k liquid for the payment due in 2 days.
    expect(proposal.params).toEqual({ vaultId: 'v1', amount: 44_500n * ONE });
    expect(proposal.expectedDeltas).toEqual([
      { token: USDC, holder: 'agent', delta: -44_500n * ONE },
    ]);
  });

  it('respects the vault allocation cap (R09 head-room)', () => {
    const result = preChecks(
      input({
        treasuryUsdc: 100_000n * ONE,
        agentUsdc: 100_000n * ONE,
        vaults: [
          {
            id: 'v1',
            positionAssets: 0n,
            redeemableAssets: 0n,
            shares: 0n,
            maxAllocationBps: 1_000, // 10% of 200k managed = 20k
            flagged: false,
          },
        ],
      }),
    );
    expect(deterministic(result).params).toEqual({ vaultId: 'v1', amount: 20_000n * ONE });
  });

  it('never deposits into a flagged vault', () => {
    const result = preChecks(
      input({
        treasuryUsdc: 100_000n * ONE,
        agentUsdc: 100_000n * ONE,
        vaults: [
          {
            id: 'v1',
            positionAssets: 0n,
            redeemableAssets: 0n,
            shares: 0n,
            maxAllocationBps: 10_000,
            flagged: true,
          },
        ],
      }),
    );
    expect(result.kind).not.toBe('deterministic');
  });

  it('does nothing when everything is inside the buffer', () => {
    const result = preChecks(input({ treasuryUsdc: 100_000n * ONE }));
    expect(result).toEqual({
      kind: 'noop',
      reason: 'nothing idle above the buffer, nothing due, no risk events, allocations within caps',
    });
  });

  it('ignores dust below the minimum action size', () => {
    const result = preChecks(
      input({
        treasuryUsdc: 120_000n * ONE + MIN_ACTION_BASE_UNITS - 1n,
        allowanceRemaining: 50_000n * ONE,
      }),
    );
    expect(result.kind).toBe('noop');
  });

  it('never proposes a kind the policy does not allow autonomously', () => {
    const result = preChecks(
      input({
        policy: policy({ autonomousKinds: ['noop'] }),
        treasuryUsdc: 200_000n * ONE,
        agentUsdc: 50_000n * ONE,
        allowanceRemaining: 50_000n * ONE,
      }),
    );
    expect(result.kind).not.toBe('deterministic');
  });
});

describe('preChecks — when SERV is asked, and when it is not (SERV §7)', () => {
  it('hands over to SERV when payroll would break the buffer (Example C)', () => {
    const result = preChecks(
      input({
        treasuryUsdc: 140_000n * ONE,
        agentUsdc: 0n,
        vaults: [
          {
            id: 'v1',
            positionAssets: 50_000n * ONE,
            redeemableAssets: 50_000n * ONE,
            shares: 50_000n * ONE,
            maxAllocationBps: 10_000,
            flagged: false,
          },
        ],
        obligations: [
          {
            id: 'o1',
            policyRecipientId: 'alex',
            amount: 36_000n * ONE,
            dueDate: new Date(NOW.getTime() + 2 * 86_400_000),
          },
        ],
      }),
    );
    expect(result.kind).toBe('discretionary');
  });

  it('hands over to SERV when a vault is above its allocation cap', () => {
    const result = preChecks(
      input({
        treasuryUsdc: 100_000n * ONE,
        vaults: [
          {
            id: 'v1',
            positionAssets: 80_000n * ONE,
            redeemableAssets: 80_000n * ONE,
            shares: 80_000n * ONE,
            maxAllocationBps: 1_000,
            flagged: false,
          },
        ],
      }),
    );
    expect(result.kind).toBe('discretionary');
  });

  it('6.7 — degraded mode never reaches the discretionary path', () => {
    const result = preChecks(
      input({
        degraded: true,
        treasuryUsdc: 140_000n * ONE,
        obligations: [
          {
            id: 'o1',
            policyRecipientId: 'alex',
            amount: 36_000n * ONE,
            dueDate: new Date(NOW.getTime() + 2 * 86_400_000),
          },
        ],
      }),
    );
    expect(result.kind).toBe('noop');
    expect(result.kind === 'noop' && result.reason).toContain('SERV is unavailable');
  });

  it('6.7 — degraded mode still pays an obligation that is due', () => {
    const result = preChecks(
      input({
        degraded: true,
        agentUsdc: 6_000n * ONE,
        obligations: [{ id: 'o1', policyRecipientId: 'alex', amount: 3_000n * ONE, dueDate: NOW }],
      }),
    );
    expect(deterministic(result).kind).toBe('pay_recipient');
  });

  it('6.7 — degraded mode still exits a vault under a risk trigger', () => {
    const result = preChecks(
      input({
        degraded: true,
        vaults: [
          {
            id: 'v1',
            positionAssets: 10n * ONE,
            redeemableAssets: 10n * ONE,
            shares: 10n * ONE,
            maxAllocationBps: 10_000,
            flagged: true,
          },
        ],
        riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown', observed: '-300 bps' }],
      }),
    );
    expect(deterministic(result).kind).toBe('risk_exit');
  });
});

describe('preChecks — never re-asks a question the engine already refused (RR-14)', () => {
  const idle = () => input({ treasuryUsdc: 200_000n * ONE, allowanceRemaining: 50_000n * ONE });

  it('stays quiet when the only available action is already inside the R17 window', () => {
    const first = preChecks(idle());
    const proposal = deterministic(first);
    const hash = hashProposal(proposal);

    const again = preChecks({ ...idle(), recentProposalHashes: [hash] });
    expect(again.kind).toBe('noop');
    expect(again.kind === 'noop' && again.reason).toContain('already decided in the last 24h');
  });

  it('an UNRELATED hash in the window changes nothing', () => {
    const again = preChecks({ ...idle(), recentProposalHashes: [`0x${'ab'.repeat(32)}`] });
    expect(deterministic(again).kind).toBe('pull_allowance');
  });

  it('an empty window changes nothing', () => {
    expect(deterministic(preChecks({ ...idle(), recentProposalHashes: [] })).kind).toBe(
      'pull_allowance',
    );
  });

  it('a repeatedly-refused payroll parks the wallet instead of looping', () => {
    // The live case: R07's daily cap refuses the payment, so the same proposal would be rebuilt on
    // every tick. Parking is also the RIGHT answer — if payroll cannot be met, idle cash should not
    // be locked into a vault either.
    const due = input({
      agentUsdc: 6_000n * ONE,
      treasuryUsdc: 200_000n * ONE,
      allowanceRemaining: 50_000n * ONE,
      obligations: [{ id: 'o1', policyRecipientId: 'alex', amount: 3_000n * ONE, dueDate: NOW }],
    });
    const payment = deterministic(preChecks(due));
    expect(payment.kind).toBe('pay_recipient');

    const parked = preChecks({ ...due, recentProposalHashes: [hashProposal(payment)] });
    expect(parked.kind).toBe('noop');
  });
});

describe('preChecks — determinism (what makes replay meaningful)', () => {
  it('is a pure function: 200 runs of the same input give the identical answer', () => {
    const shape = input({
      treasuryUsdc: 200_000n * ONE,
      agentUsdc: 50_000n * ONE,
      allowanceRemaining: 50_000n * ONE,
      obligations: [
        {
          id: 'o1',
          policyRecipientId: 'alex',
          amount: 3_000n * ONE,
          dueDate: new Date(NOW.getTime() + PAYROLL_FLOAT_DAYS * 86_400_000 - 1),
        },
      ],
    });
    const first = JSON.stringify(preChecks(shape), (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    for (let i = 0; i < 200; i++) {
      const again = JSON.stringify(preChecks(shape), (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      expect(again).toBe(first);
    }
  });

  it('every deterministic proposal is stamped source=deterministic in code (RR-3)', () => {
    const cases: PreCheckInput[] = [
      input({ treasuryUsdc: 200_000n * ONE, allowanceRemaining: 50_000n * ONE }),
      input({ treasuryUsdc: 150_000n * ONE, agentUsdc: 50_000n * ONE }),
      input({
        agentUsdc: 6_000n * ONE,
        obligations: [{ id: 'o1', policyRecipientId: 'alex', amount: 3_000n * ONE, dueDate: NOW }],
      }),
      input({
        vaults: [
          {
            id: 'v1',
            positionAssets: 10n * ONE,
            redeemableAssets: 10n * ONE,
            shares: 10n * ONE,
            maxAllocationBps: 10_000,
            flagged: false,
          },
        ],
        riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown', observed: 'x' }],
      }),
    ];
    for (const c of cases) expect(deterministic(preChecks(c)).source).toBe('deterministic');
  });
});
