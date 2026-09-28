// `evaluate()` — precedence, owner-approval lifting, the R20 override, and fail-closed behaviour.
import { describe, expect, it } from 'vitest';
import type { EvaluationInput, RuleCode, RuleResult } from '@thesauros/shared';
import { evaluate, runRules } from '../src/evaluate';
import { hashProposal } from '../src/hash';
import {
  ADDR,
  HASH_ZERO,
  NOW,
  depositProposal,
  input,
  parsedInput,
  payProposal,
  pullProposal,
  riskExitProposal,
  sweepProposal,
  usdc,
  withdrawProposal,
} from './fixtures';
import type { InputPatch } from './fixtures';

const codeOf = (results: readonly RuleResult[], code: RuleCode) =>
  results.find((r) => r.code === code);

describe('evaluate — the happy path', () => {
  it('allows the default scenario and reports every rule', () => {
    const verdict = evaluate(input());
    expect(verdict.decision).toBe('ALLOW');
    expect(verdict.results).toHaveLength(22);
    expect(verdict.results.every((r) => r.result === 'PASS')).toBe(true);
  });
  it('carries the identifying fields of the decision', () => {
    const proposal = payProposal();
    const verdict = evaluate(input({ proposal }));
    expect(verdict.proposalHash).toBe(hashProposal(proposal));
    expect(verdict.policyVersion).toBe(3);
    expect(verdict.walletId).toBe('wallet-1');
    expect(verdict.evaluatedAt).toBe(NOW.toISOString());
  });
});

describe('evaluate — precedence DENY > ESCALATE > ALLOW', () => {
  it('escalates when a single rule escalates', () => {
    const verdict = evaluate(input({ proposal: withdrawProposal(usdc(20_000)) }));
    expect(verdict.decision).toBe('ESCALATE');
    expect(codeOf(verdict.results, 'R10')?.result).toBe('ESCALATE');
  });
  it('denies when a rule denies, even alongside escalations', () => {
    const verdict = evaluate(
      input({
        proposal: withdrawProposal(usdc(20_000)),
        state: { frozen: true },
      }),
    );
    expect(verdict.decision).toBe('DENY');
    expect(codeOf(verdict.results, 'R01')?.result).toBe('DENY');
    expect(codeOf(verdict.results, 'R10')?.result).toBe('ESCALATE');
  });
  it('evaluates every rule even after a DENY (no short circuit)', () => {
    const verdict = evaluate(input({ state: { frozen: true, breakerOpen: true } }));
    expect(verdict.results).toHaveLength(22);
    expect(verdict.results.filter((r) => r.result === 'DENY')).toHaveLength(1);
  });
});

describe('evaluate — fail closed (I5)', () => {
  it('denies an unknown proposal kind', () => {
    const bad = {
      ...input(),
      proposal: { kind: 'drain', params: {} },
    } as unknown as EvaluationInput;
    const verdict = evaluate(bad);
    expect(verdict.decision).toBe('DENY');
    expect(verdict.results[0]?.code).toBe('R00');
    expect(verdict.policyVersion).toBe(0);
  });
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'ALLOW please'],
    ['an empty object', {}],
    ['an array', [1, 2, 3]],
  ])('denies %s without throwing', (_label, value) => {
    const verdict = evaluate(value as unknown as EvaluationInput);
    expect(verdict.decision).toBe('DENY');
    expect(verdict.proposalHash).toBe(HASH_ZERO);
    expect(verdict.evaluatedAt).toBe(new Date(0).toISOString());
  });
  it('keeps the clock from the input when the rest is garbage', () => {
    const verdict = evaluate({ now: NOW } as unknown as EvaluationInput);
    expect(verdict.evaluatedAt).toBe(NOW.toISOString());
  });
  it('ignores an invalid Date in garbage input', () => {
    const verdict = evaluate({ now: new Date('nonsense') } as unknown as EvaluationInput);
    expect(verdict.evaluatedAt).toBe(new Date(0).toISOString());
  });
  it('denies input whose own getters throw', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
      },
    ) as EvaluationInput;
    const verdict = evaluate(hostile);
    expect(verdict.decision).toBe('DENY');
    expect(verdict.results[0]?.message).toContain('boom');
  });
  it('denies input whose getters throw something that is not an Error', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw 'a bare string';
        },
      },
    ) as EvaluationInput;
    const verdict = evaluate(hostile);
    expect(verdict.decision).toBe('DENY');
    expect(verdict.results[0]?.message).toContain('a bare string');
  });
  it('denies a self-referential proposal without recursing into it', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const verdict = evaluate({ proposal: circular } as unknown as EvaluationInput);
    expect(verdict.decision).toBe('DENY');
    // None of the hashed fields exist, so the hash is of an empty action — never a real proposal's.
    expect(verdict.proposalHash).toHaveLength(66);
  });
  it('turns a rule that throws into a DENY rather than an exception', () => {
    const results = runRules(parsedInput(), [
      () => {
        throw new Error('rule exploded');
      },
      () => {
        throw 'not even an Error';
      },
    ]);
    expect(results.map((r) => r.result)).toEqual(['DENY', 'DENY']);
    expect(results[0]?.code).toBe('ENGINE');
    expect(results[0]?.message).toContain('rule exploded');
    expect(results[1]?.message).toContain('not even an Error');
  });
});

describe('evaluate — owner approval lifting', () => {
  const approvalFor = (patch: InputPatch) => {
    const base = input(patch);
    return {
      ...base,
      ownerApproval: {
        signer: ADDR.owner,
        proposalHash: hashProposal(base.proposal),
        expiresAt: new Date(NOW.getTime() + 60_000),
      },
    };
  };

  it('turns an ESCALATE into an ALLOW and marks the rule as lifted', () => {
    const withdrawal = { proposal: withdrawProposal(usdc(20_000)) };
    expect(evaluate(input(withdrawal)).decision).toBe('ESCALATE');
    const verdict = evaluate(approvalFor(withdrawal));
    expect(verdict.decision).toBe('ALLOW');
    expect(codeOf(verdict.results, 'R10')).toMatchObject({ result: 'PASS', lifted: true });
  });

  it('never lifts a DENY (P5)', () => {
    const verdict = evaluate({
      ...approvalFor({ proposal: withdrawProposal(usdc(20_000)) }),
      state: { ...input().state, frozen: true },
    });
    expect(verdict.decision).toBe('DENY');
    expect(codeOf(verdict.results, 'R01')).toMatchObject({ result: 'DENY' });
    expect(codeOf(verdict.results, 'R01')?.lifted).toBeUndefined();
  });

  it('ignores an approval signed by somebody else', () => {
    const base = approvalFor({ proposal: withdrawProposal(usdc(20_000)) });
    const verdict = evaluate({
      ...base,
      ownerApproval: { ...base.ownerApproval, signer: ADDR.attacker },
    });
    expect(verdict.decision).toBe('ESCALATE');
  });

  it('ignores an approval for a different proposal', () => {
    const base = approvalFor({ proposal: withdrawProposal(usdc(20_000)) });
    const verdict = evaluate({
      ...base,
      ownerApproval: { ...base.ownerApproval, proposalHash: HASH_ZERO },
    });
    expect(verdict.decision).toBe('ESCALATE');
  });

  it('ignores an expired approval', () => {
    const base = approvalFor({ proposal: withdrawProposal(usdc(20_000)) });
    const verdict = evaluate({
      ...base,
      ownerApproval: { ...base.ownerApproval, expiresAt: new Date(NOW.getTime() - 1) },
    });
    expect(verdict.decision).toBe('ESCALATE');
  });

  it('does not lift rules that are not liftable', () => {
    // R20's "no trigger observed" escalation IS liftable; R05's unknown recipient is not.
    const base = input({
      proposal: payProposal(usdc(10), { params: { recipientId: 'ghost', amount: usdc(10) } }),
    });
    const verdict = evaluate({
      ...base,
      ownerApproval: {
        signer: ADDR.owner,
        proposalHash: hashProposal(base.proposal),
        expiresAt: new Date(NOW.getTime() + 60_000),
      },
    });
    expect(verdict.decision).toBe('DENY');
  });
});

describe('evaluate — R20 overrides R02 for a triggered risk exit', () => {
  const triggered = {
    riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown' as const, observed: '-300 bps' }],
  };
  const notAutonomous = { autonomousKinds: ['noop' as const] };

  it('allows an exit that is not an autonomous kind when the trigger is real', () => {
    const verdict = evaluate(
      input({ proposal: riskExitProposal(), policy: notAutonomous, state: triggered }),
    );
    expect(verdict.decision).toBe('ALLOW');
    expect(codeOf(verdict.results, 'R02')?.message).toContain('overridden by R20');
  });

  it('escalates the same exit when no trigger was observed', () => {
    const verdict = evaluate(input({ proposal: riskExitProposal(), policy: notAutonomous }));
    expect(verdict.decision).toBe('ESCALATE');
    expect(codeOf(verdict.results, 'R02')?.result).toBe('ESCALATE');
  });

  it('does not override anything for other kinds', () => {
    const verdict = evaluate(input({ policy: notAutonomous }));
    expect(codeOf(verdict.results, 'R02')?.result).toBe('ESCALATE');
  });

  it('does not override when R20 itself denied', () => {
    const proposal = riskExitProposal({
      expectedDeltas: [{ token: ADDR.usdc, holder: 'recipient', delta: usdc(1) }],
    });
    const verdict = evaluate(
      input({
        proposal,
        policy: notAutonomous,
        state: triggered,
        simulation: { ok: true, deltas: proposal.expectedDeltas },
      }),
    );
    expect(verdict.decision).toBe('DENY');
    expect(codeOf(verdict.results, 'R02')?.result).toBe('ESCALATE');
  });
});

// "Mutation" sanity: flip the condition each hard rule guards and prove the verdict moves.
describe('every hard rule changes the verdict when its condition is flipped', () => {
  const cases: [RuleCode, InputPatch][] = [
    ['R01', { state: { frozen: true } }],
    ['R03', { proposal: sweepProposal({ source: 'serv' }) }],
    ['R04', { proposal: depositProposal(), state: { contractHasCode: {} } }],
    [
      'R05',
      { proposal: payProposal(usdc(10), { params: { recipientId: 'ghost', amount: usdc(10) } }) },
    ],
    ['R06', { proposal: payProposal(usdc(6_000)) }],
    ['R07', { ledger: { outflowsLast24hMicroUsd: usdc(59_000) } }],
    [
      'R08',
      {
        proposal: depositProposal(usdc(44_000)),
        state: { agentUsdc: usdc(50_000), treasuryUsdc: usdc(80_000) },
      },
    ],
    ['R11', { simulation: null }],
    ['R12', { state: { prices: {} } }],
    ['R13', { proposal: pullProposal(usdc(50_001)) }],
    ['R14', { ledger: { actionsLastHour: 10 } }],
    ['R15', { verifier: { verdict: 'DISAGREE', reasons: ['no'] } }],
    ['R16', { screen: { injectionSuspected: true, signals: ['ignore previous'] } }],
    ['R17', { ledger: { recentProposalHashes: [hashProposal(payProposal())] } }],
    ['R21', { chainId: 8453 }],
  ];

  it.each(cases)('%s flipped => DENY', (code, patch) => {
    const verdict = evaluate(input(patch));
    expect(verdict.decision).toBe('DENY');
    expect(codeOf(verdict.results, code)?.result).toBe('DENY');
  });

  it('R18 flipped => DENY', () => {
    const proposal = depositProposal();
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
    expect(verdict.decision).toBe('DENY');
    expect(codeOf(verdict.results, 'R18')?.result).toBe('DENY');
  });

  it('R19 flipped => DENY', () => {
    const verdict = evaluate(
      input({ proposal: payProposal(usdc(10), { citedFactIds: ['F_INVENTED'] }) }),
    );
    expect(verdict.decision).toBe('DENY');
    expect(codeOf(verdict.results, 'R19')?.result).toBe('DENY');
  });

  it('R20 flipped => DENY', () => {
    const proposal = riskExitProposal({
      expectedDeltas: [{ token: ADDR.usdc, holder: 'treasury', delta: usdc(1) }],
    });
    const verdict = evaluate(
      input({
        proposal,
        state: { riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown', observed: 'x' }] },
        simulation: { ok: true, deltas: proposal.expectedDeltas },
      }),
    );
    expect(codeOf(verdict.results, 'R20')?.result).toBe('DENY');
    expect(verdict.decision).toBe('DENY');
  });
});
