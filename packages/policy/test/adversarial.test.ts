// Phase 3 Opus review gate — "try to break the engine".
//
// Each case below is an attack I tried to get past `evaluate()`; the assertion is the verdict it
// must produce. Two of them (A11 price-scaling, A13 concentration denominator) found real holes and
// changed R12 and R09 — see PROGRESS Decisions D-29 and D-30.
import { describe, expect, it } from 'vitest';
import { SYSTEM_CEILINGS, type Verdict } from '@thesauros/shared';
import { evaluate } from '../src/evaluate';
import { hashProposal } from '../src/hash';
import { signReceipt, verifyReceipt } from '../src/receipt';
import {
  ADDR,
  NOW,
  depositProposal,
  input,
  payProposal,
  pullProposal,
  riskExitProposal,
  simulationFor,
  sweepProposal,
  usdc,
  withdrawProposal,
} from './fixtures';

const denied = (v: Verdict, code: string) =>
  v.decision === 'DENY' && v.results.some((r) => r.code === code && r.result === 'DENY');

describe('A01 — dust splitting: many payments that each dodge the per-tx cap', () => {
  it('still hits the rolling 24h cap, payment by payment', () => {
    // 5,000 USDC a time is inside every per-tx cap; the window is what stops the 13th.
    let spent = 0n;
    const results: string[] = [];
    for (let i = 0; i < 14; i++) {
      const proposal = payProposal(usdc(5_000), {
        params: { recipientId: 'alex', amount: usdc(5_000) },
        rationale: `slice ${i}`,
      });
      const verdict = evaluate(
        input({
          proposal,
          simulation: simulationFor(proposal),
          state: { agentUsdc: usdc(200_000), treasuryUsdc: usdc(200_000) },
          ledger: { outflowsLast24hMicroUsd: spent },
        }),
      );
      results.push(verdict.decision);
      if (verdict.decision === 'ALLOW') spent += usdc(5_000);
    }
    // The mandate's daily limit is 60,000 USDC: exactly 12 slices fit, the rest are denied.
    expect(results.filter((d) => d === 'ALLOW')).toHaveLength(12);
    expect(spent).toBe(usdc(60_000));
    expect(results.at(-1)).toBe('DENY');
  });

  it('cannot be dodged with sub-cent dust either', () => {
    const proposal = payProposal(1n);
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        ledger: { outflowsLast24hMicroUsd: usdc(60_000) },
      }),
    );
    expect(denied(verdict, 'R07')).toBe(true);
  });
});

describe('A02 — rounding: an amount that floors to zero micro-USD', () => {
  it('is denied rather than treated as a free action', () => {
    const proposal = payProposal(999n); // 0.000999 USDC
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        state: {
          prices: {
            [ADDR.usdc]: { microUsd: 1n, publishedAt: new Date(NOW.getTime() - 1_000) },
          },
        },
      }),
    );
    expect(verdict.decision).toBe('DENY');
  });
});

describe('A03 — recipient lookalike (T3)', () => {
  it('cannot be paid: ids resolve through the Policy, never through an address', () => {
    for (const recipientId of ['alex ', 'Alex', 'alex​', 'alеx', ADDR.alexLookalike, ADDR.alex]) {
      const proposal = payProposal(usdc(100), { params: { recipientId, amount: usdc(100) } });
      const verdict = evaluate(input({ proposal, simulation: simulationFor(proposal) }));
      expect(denied(verdict, 'R05')).toBe(true);
    }
  });
});

describe('A04 — decimals mismatch: 18-decimal thinking on a 6-decimal token', () => {
  it('is caught by the per-tx cap, not silently paid', () => {
    const proposal = payProposal(usdc(3_000) * 10n ** 12n);
    const verdict = evaluate(input({ proposal, simulation: simulationFor(proposal) }));
    expect(denied(verdict, 'R06')).toBe(true);
  });

  it('cannot be smuggled through a policy token that claims other decimals', () => {
    // `decimals` is a literal 6 in the schema: a policy claiming 18 does not parse at all.
    const base = input();
    const verdict = evaluate({
      ...base,
      policy: { ...base.policy, tokens: [{ ...base.policy.tokens[0]!, decimals: 18 as 6 }] },
    });
    expect(verdict.decision).toBe('DENY');
    expect(verdict.results[0]?.code).toBe('R00');
  });
});

describe('A05 — stale price at the boundary', () => {
  it.each([
    [SYSTEM_CEILINGS.PRICE_MAX_AGE_SEC - 1, 'ALLOW'],
    [SYSTEM_CEILINGS.PRICE_MAX_AGE_SEC, 'ALLOW'],
    [SYSTEM_CEILINGS.PRICE_MAX_AGE_SEC + 1, 'DENY'],
  ])('a %ss old quote => %s', (ageSec, expected) => {
    const verdict = evaluate(
      input({
        state: {
          prices: {
            [ADDR.usdc]: {
              microUsd: 1_000_000n,
              publishedAt: new Date(NOW.getTime() - ageSec * 1_000),
            },
          },
        },
      }),
    );
    expect(verdict.decision).toBe(expected);
  });

  it('refuses a quote from the future (a rewound clock is not freshness)', () => {
    const verdict = evaluate(
      input({
        state: {
          prices: {
            [ADDR.usdc]: { microUsd: 1_000_000n, publishedAt: new Date(NOW.getTime() + 1_000) },
          },
        },
      }),
    );
    expect(denied(verdict, 'R12')).toBe(true);
  });
});

describe('A06 — negative and zero amounts', () => {
  it('a negative amount does not parse, so the verdict is DENY', () => {
    const base = input();
    const proposal = { ...base.proposal, params: { recipientId: 'alex', amount: -usdc(1_000) } };
    const verdict = evaluate({ ...base, proposal } as typeof base);
    expect(verdict.decision).toBe('DENY');
    expect(verdict.results[0]?.code).toBe('R00');
  });

  it('a zero amount is denied by R06', () => {
    const proposal = payProposal(0n);
    expect(denied(evaluate(input({ proposal, simulation: simulationFor(proposal) })), 'R06')).toBe(
      true,
    );
  });

  it('a negative delta on the recipient side is caught by the simulation check', () => {
    const proposal = payProposal(usdc(100), {
      expectedDeltas: [
        { token: ADDR.usdc, holder: 'agent', delta: -usdc(100) },
        { token: ADDR.usdc, holder: 'recipient', delta: -usdc(100) },
      ],
    });
    const verdict = evaluate(
      input({
        proposal,
        simulation: {
          ok: true,
          deltas: [
            { token: ADDR.usdc, holder: 'agent', delta: -usdc(100) },
            { token: ADDR.usdc, holder: 'recipient', delta: usdc(100) },
          ],
        },
      }),
    );
    expect(denied(verdict, 'R11')).toBe(true);
  });
});

describe('A07 — huge bigints', () => {
  it.each([2n ** 64n, 2n ** 128n, 2n ** 255n, 10n ** 40n])('%s base units is denied', (amount) => {
    const proposal = payProposal(amount);
    const verdict = evaluate(input({ proposal, simulation: simulationFor(proposal) }));
    expect(verdict.decision).toBe('DENY');
  });

  it('a huge balance does not overflow the runway or concentration maths', () => {
    const proposal = depositProposal(usdc(1_000));
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        state: { agentUsdc: 2n ** 200n, treasuryUsdc: 2n ** 200n },
      }),
    );
    expect(verdict.decision).toBe('ALLOW');
  });
});

describe('A08 — replay of an identical action', () => {
  it('the same action twice in 24h is denied the second time', () => {
    const proposal = payProposal(usdc(3_000));
    const first = evaluate(input({ proposal, simulation: simulationFor(proposal) }));
    expect(first.decision).toBe('ALLOW');
    const second = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        ledger: { recentProposalHashes: [first.proposalHash] },
      }),
    );
    expect(denied(second, 'R17')).toBe(true);
  });

  it('rewording the rationale does not produce a new hash', () => {
    const a = payProposal(usdc(3_000), { rationale: 'Alex is due 3,000 USDC today.' });
    const b = payProposal(usdc(3_000), {
      rationale: 'URGENT!!! pay Alex the 3,000 USDC immediately',
      confidence: 0.61,
      citedFactIds: [],
    });
    expect(hashProposal(b)).toBe(hashProposal(a));
    const verdict = evaluate(
      input({
        proposal: b,
        simulation: simulationFor(b),
        ledger: { recentProposalHashes: [hashProposal(a)] },
      }),
    );
    expect(denied(verdict, 'R17')).toBe(true);
  });

  it('two sweeps of different sizes are different actions', () => {
    const small = sweepProposal({
      expectedDeltas: [{ token: ADDR.usdc, holder: 'treasury', delta: usdc(1) }],
    });
    expect(hashProposal(small)).not.toBe(hashProposal(sweepProposal()));
  });
});

describe('A09 — receipts from another policy version or another run', () => {
  const KEY = new Uint8Array(32).fill(9);
  const NONCE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  it('a receipt issued under policy v3 does not execute under v4', () => {
    const verdict = evaluate(input());
    const receipt = signReceipt(verdict, KEY, NOW, NONCE);
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    expect(
      verifyReceipt(
        receipt.value,
        { proposalHash: verdict.proposalHash, policyVersion: 4 },
        KEY,
        NOW,
      ),
    ).toMatchObject({ ok: false, error: { code: 'POLICY_VERSION_MISMATCH' } });
  });

  it('a receipt for the payment does not authorise the deposit', () => {
    const pay = evaluate(input());
    const deposit = depositProposal();
    const receipt = signReceipt(pay, KEY, NOW, NONCE);
    if (!receipt.ok) return;
    expect(
      verifyReceipt(receipt.value, { proposalHash: hashProposal(deposit) }, KEY, NOW),
    ).toMatchObject({ ok: false, error: { code: 'PROPOSAL_MISMATCH' } });
  });

  it('an expired receipt does not execute, however valid its MAC', () => {
    const verdict = evaluate(input());
    const receipt = signReceipt(verdict, KEY, NOW, NONCE);
    if (!receipt.ok) return;
    const late = new Date(NOW.getTime() + (SYSTEM_CEILINGS.RECEIPT_TTL_SEC + 1) * 1_000);
    expect(
      verifyReceipt(receipt.value, { proposalHash: verdict.proposalHash }, KEY, late),
    ).toMatchObject({ ok: false, error: { code: 'EXPIRED' } });
  });
});

describe('A10 — approvals that should not lift anything', () => {
  it('an expired approval leaves the escalation standing', () => {
    const proposal = withdrawProposal(usdc(20_000));
    const base = input({ proposal, simulation: simulationFor(proposal) });
    const verdict = evaluate({
      ...base,
      ownerApproval: {
        signer: ADDR.owner,
        proposalHash: hashProposal(proposal),
        expiresAt: NOW, // expiry is exclusive: "expires now" is expired
      },
    });
    expect(verdict.decision).toBe('ESCALATE');
  });

  it("an approval for yesterday's identical payment does not pre-authorise today's", () => {
    // Same action => same hash => the approval WOULD apply; R17 is what stops the replay.
    const proposal = payProposal(usdc(20_000));
    const base = input({
      proposal,
      simulation: simulationFor(proposal),
      ledger: { recentProposalHashes: [hashProposal(proposal)] },
    });
    const verdict = evaluate({
      ...base,
      ownerApproval: {
        signer: ADDR.owner,
        proposalHash: hashProposal(proposal),
        expiresAt: new Date(NOW.getTime() + 3_600_000),
      },
    });
    expect(denied(verdict, 'R17')).toBe(true);
  });

  it('an approval signed by a recipient is not an owner approval', () => {
    const proposal = withdrawProposal(usdc(20_000));
    const base = input({ proposal, simulation: simulationFor(proposal) });
    const verdict = evaluate({
      ...base,
      ownerApproval: {
        signer: ADDR.alex,
        proposalHash: hashProposal(proposal),
        expiresAt: new Date(NOW.getTime() + 3_600_000),
      },
    });
    expect(verdict.decision).toBe('ESCALATE');
  });
});

describe('A11 — price scaling: make a big transfer look small (found a hole)', () => {
  it('a 1 micro-USD quote cannot shrink 50,000 USDC under the caps', () => {
    const proposal = payProposal(usdc(50_000));
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        state: {
          agentUsdc: usdc(200_000),
          prices: { [ADDR.usdc]: { microUsd: 1n, publishedAt: new Date(NOW.getTime() - 1_000) } },
        },
      }),
    );
    expect(denied(verdict, 'R12')).toBe(true);
  });

  it('an inflated quote cannot shrink the runway buffer either', () => {
    const proposal = depositProposal(usdc(44_000));
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        state: {
          prices: {
            [ADDR.usdc]: { microUsd: 100_000_000n, publishedAt: new Date(NOW.getTime() - 1_000) },
          },
        },
      }),
    );
    expect(denied(verdict, 'R12')).toBe(true);
  });
});

describe('A12 — frozen, breaker-open and not-allowed kinds', () => {
  it('a frozen wallet denies even a proposal the owner personally asked for', () => {
    const proposal = payProposal(usdc(100), { source: 'owner' });
    const verdict = evaluate(
      input({ proposal, simulation: simulationFor(proposal), state: { frozen: true } }),
    );
    expect(denied(verdict, 'R01')).toBe(true);
  });

  it('a kind outside autonomousKinds escalates instead of executing', () => {
    const proposal = payProposal(usdc(100));
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        policy: { autonomousKinds: ['noop', 'vault_deposit'] },
      }),
    );
    expect(verdict.decision).toBe('ESCALATE');
  });

  it('an empty autonomousKinds list cannot be bypassed by claiming source=owner', () => {
    const proposal = payProposal(usdc(100), { source: 'owner' });
    const verdict = evaluate(
      input({ proposal, simulation: simulationFor(proposal), policy: { autonomousKinds: [] } }),
    );
    expect(verdict.decision).toBe('ESCALATE');
  });
});

describe('A13 — concentration and vault allowlist', () => {
  it('a vault that is not in the policy is denied even with a perfect simulation', () => {
    const proposal = depositProposal(usdc(1_000), {
      params: { vaultId: 'v1-yield-plus', amount: usdc(1_000) },
    });
    const verdict = evaluate(input({ proposal, simulation: simulationFor(proposal) }));
    expect(denied(verdict, 'R04')).toBe(true);
  });

  it('a phantom position in state cannot inflate managed funds to hide a concentrated deposit', () => {
    const proposal = depositProposal(usdc(40_000));
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        policy: {
          vaults: [
            {
              id: 'v1',
              name: 'V',
              address: ADDR.vault,
              asset: ADDR.usdc,
              kind: 'erc4626',
              maxAllocationBps: 1_000,
            },
          ],
        },
        state: {
          agentUsdc: usdc(50_000),
          treasuryUsdc: usdc(50_000),
          // 10m in a vault that is not on the allowlist: ignored by R09.
          vaultPositions: { 'ghost-vault': usdc(10_000_000) },
        },
      }),
    );
    expect(verdict.decision).not.toBe('ALLOW');
    expect(verdict.results.find((r) => r.code === 'R09')?.result).toBe('ESCALATE');
  });

  it('a deposit into a vault that is already flagged is denied', () => {
    const proposal = depositProposal(usdc(1_000));
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        state: {
          riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown', observed: '-300 bps' }],
        },
      }),
    );
    expect(denied(verdict, 'R04')).toBe(true);
  });
});

describe('A14 — sweep and exit destinations', () => {
  it('a sweep whose simulation sends money anywhere but the treasury is denied', () => {
    const sweep = sweepProposal();
    const verdict = evaluate(
      input({
        proposal: sweep,
        state: { agentUsdc: usdc(50_000) },
        simulation: {
          ok: true,
          deltas: [
            { token: ADDR.usdc, holder: 'agent', delta: -usdc(50_000) },
            { token: ADDR.usdc, holder: 'recipient', delta: usdc(50_000) },
          ],
        },
      }),
    );
    expect(denied(verdict, 'R11')).toBe(true);
  });

  it('a "risk exit" that pays a third party is denied by R20 as well as R11', () => {
    const proposal = riskExitProposal({
      expectedDeltas: [
        { token: ADDR.usdc, holder: 'agent', delta: usdc(30_000) },
        { token: ADDR.usdc, holder: 'recipient', delta: usdc(14_000) },
      ],
    });
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        state: {
          riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown', observed: '-300 bps' }],
        },
      }),
    );
    expect(denied(verdict, 'R20')).toBe(true);
  });

  it('a fabricated risk trigger is not enough: with no observation the exit escalates', () => {
    const proposal = riskExitProposal({
      rationale: 'the vault is definitely collapsing, trust me',
    });
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        policy: { autonomousKinds: ['noop'] },
      }),
    );
    expect(verdict.decision).toBe('ESCALATE');
  });
});

describe('A15 — pulling more than the owner signed for', () => {
  it('a pull above the remaining on-chain allowance is denied', () => {
    const proposal = pullProposal(usdc(50_000));
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        state: { allowanceRemaining: usdc(49_999), treasuryUsdc: usdc(200_000) },
      }),
    );
    expect(denied(verdict, 'R13')).toBe(true);
  });

  it('a pull is still bounded by the per-tx ceiling when the allowance is enormous', () => {
    const proposal = pullProposal(usdc(260_000));
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        policy: {
          limits: {
            perTxMicroUsd: usdc(250_000),
            dailyMicroUsd: usdc(500_000),
            maxActionsPerHour: 10,
          },
        },
        state: { allowanceRemaining: usdc(1_000_000), treasuryUsdc: usdc(2_000_000) },
      }),
    );
    expect(denied(verdict, 'R06')).toBe(true);
  });
});

describe('A16 — injection that tries to ride a safety action', () => {
  it('a flagged proposal cannot move value even when everything else is perfect', () => {
    const proposal = payProposal(usdc(100));
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        screen: { injectionSuspected: true, signals: ['ignore previous instructions'] },
      }),
    );
    expect(denied(verdict, 'R16')).toBe(true);
  });

  it('but a flagged risk exit still runs: safety must not be blockable by spamming a memo', () => {
    const proposal = riskExitProposal();
    const verdict = evaluate(
      input({
        proposal,
        simulation: simulationFor(proposal),
        screen: { injectionSuspected: true, signals: ['zero-width characters'] },
        state: {
          vaultPositions: { v1: usdc(44_000) },
          riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown', observed: '-300 bps' }],
        },
      }),
    );
    expect(verdict.decision).toBe('ALLOW');
  });
});

describe('A17 — a compromised proposer that lies about its own work', () => {
  it('cannot invent facts', () => {
    const proposal = payProposal(usdc(100), { citedFactIds: ['F_CEO_SAID_SO'] });
    const verdict = evaluate(input({ proposal, simulation: simulationFor(proposal) }));
    expect(denied(verdict, 'R19')).toBe(true);
  });

  it('cannot understate the deltas of its own transfer', () => {
    const proposal = payProposal(usdc(50_000), {
      expectedDeltas: [
        { token: ADDR.usdc, holder: 'agent', delta: -usdc(1) },
        { token: ADDR.usdc, holder: 'recipient', delta: usdc(1) },
      ],
    });
    const verdict = evaluate(
      input({
        proposal,
        state: { agentUsdc: usdc(200_000) },
        simulation: {
          ok: true,
          deltas: [
            { token: ADDR.usdc, holder: 'agent', delta: -usdc(50_000) },
            { token: ADDR.usdc, holder: 'recipient', delta: usdc(50_000) },
          ],
        },
      }),
    );
    expect(denied(verdict, 'R11')).toBe(true);
  });

  it('cannot smuggle an unlimited approval into a legitimate deposit', () => {
    const proposal = depositProposal(usdc(1_000));
    const verdict = evaluate(
      input({
        proposal,
        simulation: {
          ok: true,
          deltas: proposal.expectedDeltas,
          approvals: [{ token: ADDR.usdc, spender: ADDR.vault, amount: 2n ** 256n - 1n }],
        },
      }),
    );
    expect(denied(verdict, 'R18')).toBe(true);
  });

  it('cannot claim a confidence above 1 or below 0', () => {
    for (const confidence of [1.01, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const proposal = payProposal(usdc(100), { confidence });
      const verdict = evaluate(input({ proposal, simulation: simulationFor(proposal) }));
      expect(verdict.decision).toBe('DENY');
    }
  });
});

describe('A18 — the loop', () => {
  it('the rate limit denies the 11th action in an hour, before the daily cap is reached', () => {
    const proposal = payProposal(usdc(1));
    const verdict = evaluate(
      input({ proposal, simulation: simulationFor(proposal), ledger: { actionsLastHour: 10 } }),
    );
    expect(denied(verdict, 'R14')).toBe(true);
  });
});
