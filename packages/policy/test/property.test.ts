// Property tests P1–P6 (POLICY_ENGINE §9) plus monotonicity and total-function behaviour.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson, type EvaluationInput, type Policy, type Verdict } from '@thesauros/shared';
import { SYSTEM_CEILINGS } from '@thesauros/shared';
import { evaluate } from '../src/evaluate';
import { hashProposal } from '../src/hash';
import { signReceipt, verifyReceipt } from '../src/receipt';
import {
  ADDR,
  HASH_ZERO,
  NOW,
  depositProposal,
  input,
  noopProposal,
  payProposal,
  pullProposal,
  riskExitProposal,
  simulationFor,
  sweepProposal,
  usdc,
  withdrawProposal,
} from './fixtures';

const RUNS = { numRuns: 300 };
const amount = fc.bigInt({ min: 1n, max: usdc(400_000) });
const kindPicker = fc.constantFrom(
  'pay_recipient',
  'vault_deposit',
  'pull_allowance',
  'vault_withdraw',
);

/** Builds a realistic input for a generated kind + amount, with a matching simulation. */
function scenario(kind: string, value: bigint): EvaluationInput {
  const proposal =
    kind === 'pay_recipient'
      ? payProposal(value)
      : kind === 'vault_deposit'
        ? depositProposal(value)
        : kind === 'pull_allowance'
          ? pullProposal(value)
          : withdrawProposal(value);
  return input({ proposal, simulation: simulationFor(proposal) });
}

const severity = (v: Verdict): number => ({ ALLOW: 0, ESCALATE: 1, DENY: 2 })[v.decision];

describe('P1 — an address that is not in the policy can never produce an ALLOW', () => {
  it('holds for arbitrary recipient ids', () => {
    fc.assert(
      fc.property(fc.string(), amount, (recipientId, value) => {
        const proposal = payProposal(value, { params: { recipientId, amount: value } });
        const verdict = evaluate(input({ proposal, simulation: simulationFor(proposal) }));
        const known = ['alex', 'priya'].includes(recipientId);
        return known || verdict.decision !== 'ALLOW';
      }),
      RUNS,
    );
  });

  it('holds for arbitrary vault ids', () => {
    fc.assert(
      fc.property(fc.string(), amount, (vaultId, value) => {
        const proposal = depositProposal(value, { params: { vaultId, amount: value } });
        const verdict = evaluate(input({ proposal, simulation: simulationFor(proposal) }));
        return vaultId === 'v1' || verdict.decision !== 'ALLOW';
      }),
      RUNS,
    );
  });

  it('holds when a poisoned lookalike is present in state and simulation', () => {
    fc.assert(
      fc.property(fc.constantFrom(ADDR.alexLookalike, ADDR.attacker), (poison) => {
        const proposal = payProposal(usdc(3_000), {
          expectedDeltas: [
            { token: ADDR.usdc, holder: 'agent', delta: -usdc(3_000) },
            { token: ADDR.usdc, holder: 'recipient', delta: usdc(3_000) },
          ],
        });
        const verdict = evaluate(
          input({
            proposal,
            state: {
              prices: {
                [ADDR.usdc]: { microUsd: 1_000_000n, publishedAt: new Date(NOW.getTime() - 1_000) },
                [poison]: { microUsd: 1_000_000n, publishedAt: NOW },
              },
              contractHasCode: { [ADDR.vault]: true, [poison]: true },
            },
          }),
        );
        // The poisoned address is simply never consulted: the payment is to Alex, from the Policy.
        return verdict.decision === 'ALLOW';
      }),
      RUNS,
    );
  });
});

describe('P2 — a frozen wallet never allows anything but an owner sweep', () => {
  it('holds across kinds and freeze/breaker combinations', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'pay_recipient',
          'vault_deposit',
          'pull_allowance',
          'vault_withdraw',
          'sweep_home',
          'risk_exit',
          'noop',
        ),
        fc.boolean(),
        fc.boolean(),
        (kind, frozen, breakerOpen) => {
          const proposal =
            kind === 'sweep_home'
              ? sweepProposal()
              : kind === 'risk_exit'
                ? riskExitProposal()
                : kind === 'noop'
                  ? noopProposal()
                  : scenario(kind, usdc(1_000)).proposal;
          const verdict = evaluate(
            input({
              proposal,
              simulation: simulationFor(proposal),
              state: {
                frozen,
                breakerOpen,
                riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown', observed: '-300bps' }],
              },
            }),
          );
          if (!frozen && !breakerOpen) return true;
          const ownerSweep = proposal.kind === 'sweep_home' && proposal.source === 'owner';
          return ownerSweep || verdict.decision !== 'ALLOW';
        },
      ),
      RUNS,
    );
  });
});

describe('P3 — an ALLOW is always inside every size limit', () => {
  it('holds for generated amounts and 24h windows', () => {
    fc.assert(
      fc.property(
        kindPicker,
        amount,
        fc.bigInt({ min: 0n, max: usdc(60_000) }),
        (kind, value, spent) => {
          const base = scenario(kind, value);
          const verdict = evaluate(
            input({
              proposal: base.proposal,
              simulation: base.simulation,
              ledger: { outflowsLast24hMicroUsd: spent },
            }),
          );
          if (verdict.decision !== 'ALLOW') return true;
          const policy = base.policy;
          const withinPerTx =
            value <= policy.limits.perTxMicroUsd && value <= SYSTEM_CEILINGS.MAX_PER_TX_MICRO_USD;
          const isOutflow = kind === 'pay_recipient' || kind === 'vault_deposit';
          const withinDaily = !isOutflow || spent + value <= policy.limits.dailyMicroUsd;
          return withinPerTx && withinDaily && value > 0n;
        },
      ),
      RUNS,
    );
  });
});

describe('P4 — evaluate is deterministic and pure', () => {
  it('produces byte-identical verdicts for the same input, 1000 times', () => {
    const scenarios = [
      input(),
      input({ proposal: withdrawProposal(usdc(20_000)) }),
      input({ state: { frozen: true } }),
      input({ proposal: sweepProposal() }),
      input({ proposal: riskExitProposal() }),
    ];
    for (const s of scenarios) {
      const first = canonicalJson(evaluate(s));
      for (let i = 0; i < 200; i++) expect(canonicalJson(evaluate(s))).toBe(first);
    }
  });

  it('does not mutate its input', () => {
    const s = input();
    const before = canonicalJson(s);
    evaluate(s);
    expect(canonicalJson(s)).toBe(before);
  });

  it('never throws, whatever it is given', () => {
    fc.assert(
      fc.property(fc.anything(), (garbage) => {
        const verdict = evaluate(garbage as EvaluationInput);
        return (
          verdict.decision === 'DENY' ||
          verdict.decision === 'ESCALATE' ||
          verdict.decision === 'ALLOW'
        );
      }),
      { numRuns: 1_000 },
    );
  });

  it('never ALLOWs arbitrary garbage', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        (garbage) => evaluate(garbage as EvaluationInput).decision === 'DENY',
      ),
      { numRuns: 1_000 },
    );
  });

  it('never throws on a structurally valid input with arbitrary state numbers', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 255n }),
        fc.bigInt({ min: 0n, max: 2n ** 255n }),
        fc.integer({ min: 0, max: 10_000 }),
        (agentUsdc, treasuryUsdc, actionsLastHour) => {
          const verdict = evaluate(
            input({ state: { agentUsdc, treasuryUsdc }, ledger: { actionsLastHour } }),
          );
          return typeof verdict.decision === 'string';
        },
      ),
      RUNS,
    );
  });
});

describe('P5 — an owner approval never flips a DENY', () => {
  it('holds for every rule that can deny', () => {
    const denyingPatches = [
      { state: { frozen: true } },
      { simulation: null },
      { state: { prices: {} } },
      { ledger: { actionsLastHour: 99 } },
      { verifier: { verdict: 'DISAGREE' as const, reasons: [] } },
      { screen: { injectionSuspected: true, signals: ['x'] } },
      { proposal: payProposal(usdc(500_000)) },
    ];
    for (const patch of denyingPatches) {
      const base = input(patch);
      const denied = evaluate(base);
      expect(denied.decision).toBe('DENY');
      const approved = evaluate({
        ...base,
        ownerApproval: {
          signer: ADDR.owner,
          proposalHash: hashProposal(base.proposal),
          expiresAt: new Date(NOW.getTime() + 600_000),
        },
      });
      expect(approved.decision).toBe('DENY');
      const deniedCodes = denied.results.filter((r) => r.result === 'DENY').map((r) => r.code);
      const approvedCodes = approved.results.filter((r) => r.result === 'DENY').map((r) => r.code);
      expect(approvedCodes).toEqual(deniedCodes);
    }
  });

  it('holds for arbitrary approval signers and expiries', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(ADDR.owner, ADDR.attacker, ADDR.alex),
        fc.integer({ min: -10_000, max: 10_000 }),
        (signer, offsetMs) => {
          const base = input({ state: { frozen: true } });
          const verdict = evaluate({
            ...base,
            ownerApproval: {
              signer,
              proposalHash: hashProposal(base.proposal),
              expiresAt: new Date(NOW.getTime() + offsetMs),
            },
          });
          return verdict.decision === 'DENY';
        },
      ),
      RUNS,
    );
  });
});

describe('P6 — tampering any receipt field breaks verification', () => {
  const KEY = new Uint8Array(32).fill(3);
  const NONCE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  it('holds for arbitrary edits to every field', () => {
    const signed = signReceipt(evaluate(input()), KEY, NOW, NONCE, { callsHash: HASH_ZERO });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const receipt = signed.value;
    const expectation = { proposalHash: receipt.proposalHash };

    fc.assert(
      fc.property(
        fc.constantFrom(
          'proposalHash',
          'policyVersion',
          'walletId',
          'nonce',
          'issuedAt',
          'expiresAt',
          'callsHash',
          'mac',
        ),
        fc.string({ minLength: 1, maxLength: 20 }),
        (field, junk) => {
          const tampered = {
            ...receipt,
            [field]: field === 'policyVersion' ? receipt.policyVersion + 1 : junk,
          };
          return verifyReceipt(tampered, expectation, KEY, NOW).ok === false;
        },
      ),
      RUNS,
    );
  });

  it('holds for arbitrary wrong keys', () => {
    const signed = signReceipt(evaluate(input()), KEY, NOW, NONCE);
    if (!signed.ok) throw new Error('expected a receipt');
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }).filter((b) => b !== 3),
        (fill) => {
          const key = new Uint8Array(32).fill(fill);
          return (
            verifyReceipt(signed.value, { proposalHash: signed.value.proposalHash }, key, NOW)
              .ok === false
          );
        },
      ),
      RUNS,
    );
  });
});

describe('monotonicity — a stricter policy never turns a DENY into an ALLOW', () => {
  const tighten = (p: Policy, factorBps: bigint): Partial<Policy> => ({
    limits: {
      perTxMicroUsd: (p.limits.perTxMicroUsd * factorBps) / 10_000n,
      dailyMicroUsd: (p.limits.dailyMicroUsd * factorBps) / 10_000n,
      maxActionsPerHour: Math.max(
        1,
        Math.floor((p.limits.maxActionsPerHour * Number(factorBps)) / 10_000),
      ),
    },
    runwayBufferMicroUsd: p.runwayBufferMicroUsd + usdc(10_000),
    approvalThresholdMicroUsd: (p.approvalThresholdMicroUsd * factorBps) / 10_000n,
    approvalThresholdByKind: {},
    autonomousKinds: ['noop'],
    vaults: p.vaults.map((v) => ({ ...v, maxAllocationBps: Math.floor(v.maxAllocationBps / 2) })),
  });

  it('severity never decreases when every limit is tightened', () => {
    fc.assert(
      fc.property(
        kindPicker,
        amount,
        fc.bigInt({ min: 1n, max: 9_999n }),
        (kind, value, factorBps) => {
          const loose = scenario(kind, value);
          const strict = {
            ...loose,
            policy: { ...loose.policy, ...tighten(loose.policy, factorBps) } as Policy,
          };
          return severity(evaluate(strict)) >= severity(evaluate(loose));
        },
      ),
      RUNS,
    );
  });
});
