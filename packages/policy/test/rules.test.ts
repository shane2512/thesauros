// One positive and one negative case for every rule R00–R21 (POLICY_ENGINE §9), plus the
// branches each rule takes for the kinds it does not apply to.
import { describe, expect, it } from 'vitest';
import { zEvaluationInput } from '@thesauros/shared';
import * as R from '../src/rules';
import { hashProposal } from '../src/hash';
import {
  ADDR,
  NOW,
  depositProposal,
  noopProposal,
  parsedInput,
  payProposal,
  pullProposal,
  riskExitProposal,
  simulationFor,
  sweepProposal,
  usdc,
  withdrawProposal,
} from './fixtures';

const freshPrice = (over: Record<string, unknown> = {}) => ({
  [ADDR.usdc]: { microUsd: 1_000_000n, publishedAt: new Date(NOW.getTime() - 10_000), ...over },
});

describe('R00 — schema', () => {
  it('passes a well-formed proposal', () => {
    expect(R.R00(parsedInput()).result).toBe('PASS');
  });
  it('denies an unknown kind', () => {
    const bad = parsedInput();
    const input = { ...bad, proposal: { ...bad.proposal, kind: 'drain_everything' } as never };
    expect(R.R00(input)).toMatchObject({ result: 'DENY' });
  });
  it('denies a proposal whose params do not match its kind', () => {
    const bad = parsedInput();
    const input = { ...bad, proposal: { ...bad.proposal, params: {} } as never };
    expect(R.R00(input).result).toBe('DENY');
  });
});

describe('R01 — frozen / breaker', () => {
  it('passes an active wallet', () => {
    expect(R.R01(parsedInput()).result).toBe('PASS');
  });
  it('denies while frozen', () => {
    expect(R.R01(parsedInput({ state: { frozen: true } }))).toMatchObject({ result: 'DENY' });
  });
  it('denies while the breaker is open', () => {
    expect(R.R01(parsedInput({ state: { breakerOpen: true } })).result).toBe('DENY');
  });
  it('lets the owner sweep home while frozen (I7)', () => {
    const r = R.R01(parsedInput({ proposal: sweepProposal(), state: { frozen: true } }));
    expect(r.result).toBe('PASS');
  });
});

describe('R02 — autonomous kinds', () => {
  it('passes a kind the mandate allows', () => {
    expect(R.R02(parsedInput()).result).toBe('PASS');
  });
  it('escalates a kind the mandate does not allow', () => {
    const r = R.R02(parsedInput({ policy: { autonomousKinds: ['noop'] } }));
    expect(r).toMatchObject({ result: 'ESCALATE' });
  });
  it('never escalates noop or sweep_home', () => {
    const empty = { autonomousKinds: [] as never[] };
    expect(R.R02(parsedInput({ proposal: noopProposal(), policy: empty })).result).toBe('PASS');
    expect(R.R02(parsedInput({ proposal: sweepProposal(), policy: empty })).result).toBe('PASS');
  });
});

describe('R03 — sweep is owner-only', () => {
  it('passes an owner sweep', () => {
    expect(R.R03(parsedInput({ proposal: sweepProposal() })).result).toBe('PASS');
  });
  it('denies a sweep proposed by the model', () => {
    const r = R.R03(parsedInput({ proposal: sweepProposal({ source: 'serv' }) }));
    expect(r).toMatchObject({ result: 'DENY' });
  });
  it('ignores other kinds', () => {
    expect(R.R03(parsedInput()).result).toBe('PASS');
  });
});

describe('R04 — vault allowlist', () => {
  it('passes an allowlisted vault with code', () => {
    expect(R.R04(parsedInput({ proposal: depositProposal() })).result).toBe('PASS');
  });
  it('denies a vault that is not in the policy', () => {
    const p = depositProposal(usdc(1_000), { params: { vaultId: 'evil', amount: usdc(1_000) } });
    expect(R.R04(parsedInput({ proposal: p })).result).toBe('DENY');
  });
  it('denies a vault address with no contract code', () => {
    const r = R.R04(parsedInput({ proposal: depositProposal(), state: { contractHasCode: {} } }));
    expect(r).toMatchObject({ result: 'DENY' });
  });
  it('denies a vault whose asset is not a policy token', () => {
    const r = R.R04(
      parsedInput({
        proposal: depositProposal(),
        policy: {
          vaults: [
            {
              id: 'v1',
              name: 'Wrong asset',
              address: ADDR.vault,
              asset: ADDR.attacker,
              kind: 'erc4626',
              maxAllocationBps: 5_000,
            },
          ],
        },
      }),
    );
    expect(r.result).toBe('DENY');
  });
  it('denies a deposit into a flagged vault', () => {
    const r = R.R04(
      parsedInput({
        proposal: depositProposal(),
        state: {
          riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown', observed: '-300bps' }],
        },
      }),
    );
    expect(r.result).toBe('DENY');
  });
  it('still allows exiting a flagged vault', () => {
    const r = R.R04(
      parsedInput({
        proposal: riskExitProposal(),
        state: {
          riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown', observed: '-300bps' }],
        },
      }),
    );
    expect(r.result).toBe('PASS');
  });
  it('ignores proposals that name no vault', () => {
    expect(R.R04(parsedInput()).result).toBe('PASS');
  });
});

describe('R05 — recipient allowlist', () => {
  it('passes an allowlisted recipient', () => {
    expect(R.R05(parsedInput()).result).toBe('PASS');
  });
  it('denies an unknown recipient id', () => {
    const p = payProposal(usdc(10), { params: { recipientId: 'ceo-urgent', amount: usdc(10) } });
    expect(R.R05(parsedInput({ proposal: p }))).toMatchObject({ result: 'DENY' });
  });
  it('ignores non-payment kinds', () => {
    expect(R.R05(parsedInput({ proposal: noopProposal() })).result).toBe('PASS');
  });
});

describe('R06 — per-transaction size', () => {
  it('passes an amount inside every cap', () => {
    expect(R.R06(parsedInput()).result).toBe('PASS');
  });
  it('denies a zero amount', () => {
    expect(R.R06(parsedInput({ proposal: payProposal(0n) })).result).toBe('DENY');
  });
  it('denies above the policy per-tx limit', () => {
    const r = R.R06(parsedInput({ proposal: pullProposal(usdc(60_000)) }));
    expect(r).toMatchObject({ result: 'DENY' });
  });
  it('denies above the system ceiling even if the policy allowed it', () => {
    const r = R.R06(
      parsedInput({
        proposal: pullProposal(usdc(300_000)),
        policy: {
          limits: {
            perTxMicroUsd: usdc(400_000),
            dailyMicroUsd: usdc(900_000),
            maxActionsPerHour: 10,
          },
        },
      }),
    );
    expect(r.message).toContain('system per-tx ceiling');
  });
  it("denies above the recipient's own cap", () => {
    const r = R.R06(parsedInput({ proposal: payProposal(usdc(6_000)) }));
    expect(r.message).toContain("alex's per-tx cap");
  });
  it('denies when the amount cannot be valued', () => {
    expect(R.R06(parsedInput({ state: { prices: {} } })).result).toBe('DENY');
  });
  it('denies dust worth 0 micro-USD', () => {
    const r = R.R06(
      parsedInput({ proposal: payProposal(1n), state: { prices: freshPrice({ microUsd: 1n }) } }),
    );
    expect(r.message).toContain('worth 0 micro-USD');
  });
  it('ignores kinds with no amount', () => {
    expect(R.R06(parsedInput({ proposal: sweepProposal() })).result).toBe('PASS');
  });
});

describe('R07 — rolling 24h cap', () => {
  it('passes inside the window', () => {
    expect(R.R07(parsedInput()).result).toBe('PASS');
  });
  it('denies when the window would be exceeded', () => {
    const r = R.R07(parsedInput({ ledger: { outflowsLast24hMicroUsd: usdc(59_000) } }));
    expect(r).toMatchObject({ result: 'DENY' });
  });
  it('denies above the system daily ceiling', () => {
    const r = R.R07(
      parsedInput({
        proposal: depositProposal(usdc(50_000)),
        // A policy the validator would have rejected: the ceiling is the backstop (I5).
        policy: {
          limits: {
            perTxMicroUsd: usdc(250_000),
            dailyMicroUsd: usdc(2_000_000),
            maxActionsPerHour: 10,
          },
        },
        ledger: { outflowsLast24hMicroUsd: usdc(999_000) },
      }),
    );
    expect(r.message).toContain('system daily ceiling');
  });
  it('does not count pulls or exits as outflows', () => {
    expect(R.R07(parsedInput({ proposal: pullProposal() })).result).toBe('PASS');
  });
  it('denies when the amount cannot be valued', () => {
    expect(R.R07(parsedInput({ state: { prices: {} } })).result).toBe('DENY');
  });
});

describe('R08 — runway buffer', () => {
  it('passes when the buffer survives', () => {
    expect(R.R08(parsedInput()).result).toBe('PASS');
  });
  it('escalates a payment that eats into the buffer', () => {
    const r = R.R08(
      parsedInput({
        proposal: payProposal(usdc(4_000)),
        state: { agentUsdc: usdc(0), treasuryUsdc: usdc(123_000) },
      }),
    );
    expect(r).toMatchObject({ result: 'ESCALATE' });
  });
  it('denies a deposit that eats into the buffer', () => {
    const r = R.R08(
      parsedInput({
        proposal: depositProposal(usdc(44_000)),
        state: { agentUsdc: usdc(50_000), treasuryUsdc: usdc(80_000) },
      }),
    );
    expect(r.result).toBe('DENY');
  });
  it('ignores kinds that do not reduce liquid USDC', () => {
    expect(R.R08(parsedInput({ proposal: pullProposal() })).result).toBe('PASS');
  });
  it('denies when balances cannot be valued', () => {
    expect(R.R08(parsedInput({ state: { prices: {} } })).result).toBe('DENY');
  });
  it('denies when the amount cannot be valued but balances can', () => {
    const input = parsedInput({ proposal: payProposal(usdc(1)) });
    const broken = { ...input, policy: { ...input.policy, tokens: [] } };
    expect(R.R08(broken).result).toBe('DENY');
  });
});

describe('R09 — concentration', () => {
  it('passes a deposit inside the allocation', () => {
    expect(R.R09(parsedInput({ proposal: depositProposal(usdc(44_000)) })).result).toBe('PASS');
  });
  it('escalates a deposit over the allocation', () => {
    const r = R.R09(
      parsedInput({
        proposal: depositProposal(usdc(44_000)),
        policy: {
          vaults: [
            {
              id: 'v1',
              name: 'v',
              address: ADDR.vault,
              asset: ADDR.usdc,
              kind: 'erc4626',
              maxAllocationBps: 1_000,
            },
          ],
        },
      }),
    );
    expect(r).toMatchObject({ result: 'ESCALATE' });
  });
  it('escalates when there are no managed funds to compare against', () => {
    const r = R.R09(
      parsedInput({
        proposal: depositProposal(usdc(1)),
        state: { agentUsdc: 0n, treasuryUsdc: 0n, vaultPositions: {} },
      }),
    );
    expect(r.message).toContain('unverifiable');
  });
  it('escalates a deposit into a vault that is not in the policy (0 bps)', () => {
    const p = depositProposal(usdc(10), { params: { vaultId: 'ghost', amount: usdc(10) } });
    expect(R.R09(parsedInput({ proposal: p })).result).toBe('ESCALATE');
  });
  it('denies when positions cannot be valued', () => {
    expect(R.R09(parsedInput({ proposal: depositProposal(), state: { prices: {} } })).result).toBe(
      'DENY',
    );
  });
  it('denies when the policy has no USDC token', () => {
    const i = parsedInput({ proposal: depositProposal() });
    expect(R.R09({ ...i, policy: { ...i.policy, tokens: [] } }).result).toBe('DENY');
  });
  it('ignores non-deposits', () => {
    expect(R.R09(parsedInput()).result).toBe('PASS');
  });
});

describe('R10 — approval threshold', () => {
  it('passes below the threshold', () => {
    expect(R.R10(parsedInput()).result).toBe('PASS');
  });
  it('escalates at or above the threshold', () => {
    expect(R.R10(parsedInput({ proposal: withdrawProposal(usdc(20_000)) }))).toMatchObject({
      result: 'ESCALATE',
    });
  });
  it('uses the per-kind override when present', () => {
    expect(R.R10(parsedInput({ proposal: depositProposal(usdc(44_000)) })).result).toBe('PASS');
  });
  it('ignores kinds with no amount', () => {
    expect(R.R10(parsedInput({ proposal: sweepProposal() })).result).toBe('PASS');
  });
  it('denies when the amount cannot be valued', () => {
    expect(R.R10(parsedInput({ state: { prices: {} } })).result).toBe('DENY');
  });
});

describe('R11 — simulation parity', () => {
  it('passes when the simulation matches', () => {
    expect(R.R11(parsedInput()).result).toBe('PASS');
  });
  it('denies without a simulation', () => {
    expect(R.R11(parsedInput({ simulation: null }))).toMatchObject({ result: 'DENY' });
  });
  it('denies a failed simulation', () => {
    const r = R.R11(
      parsedInput({ simulation: { ok: false, deltas: [], approvals: [], error: 'reverted' } }),
    );
    expect(r.message).toContain('reverted');
  });
  it('denies a failed simulation with no error text', () => {
    const r = R.R11(parsedInput({ simulation: { ok: false, deltas: [], approvals: [] } }));
    expect(r.message).toContain('unknown error');
  });
  it('denies an undeclared balance change', () => {
    const proposal = payProposal();
    const r = R.R11(
      parsedInput({
        proposal,
        simulation: {
          ok: true,
          deltas: [
            ...proposal.expectedDeltas,
            { token: ADDR.usdc, holder: 'treasury', delta: -usdc(1_000) },
          ],
          approvals: [],
        },
      }),
    );
    expect(r.message).toContain('undeclared');
  });
  it('denies a delta that moves the other way', () => {
    const proposal = payProposal();
    const r = R.R11(
      parsedInput({
        proposal,
        simulation: {
          ok: true,
          deltas: [
            { token: ADDR.usdc, holder: 'agent', delta: usdc(3_000) },
            { token: ADDR.usdc, holder: 'recipient', delta: -usdc(3_000) },
          ],
          approvals: [],
        },
      }),
    );
    expect(r.message).toContain('the other way');
  });
  it('denies a transfer that is off by a single base unit (exact match)', () => {
    const proposal = payProposal();
    const r = R.R11(
      parsedInput({
        proposal,
        simulation: {
          ok: true,
          deltas: [
            { token: ADDR.usdc, holder: 'agent', delta: -usdc(3_000) },
            { token: ADDR.usdc, holder: 'recipient', delta: usdc(3_000) - 1n },
          ],
          approvals: [],
        },
      }),
    );
    expect(r.result).toBe('DENY');
  });
  it('tolerates 50 bps of share-price drift on vault operations', () => {
    const proposal = withdrawProposal(usdc(20_000));
    const r = R.R11(
      parsedInput({
        proposal,
        simulation: {
          ok: true,
          deltas: [
            { token: ADDR.usdc, holder: 'agent', delta: usdc(20_000) - usdc(20_000) / 1_000n },
          ],
          approvals: [],
        },
      }),
    );
    expect(r.result).toBe('PASS');
  });
  it('denies drift beyond the vault tolerance', () => {
    const proposal = withdrawProposal(usdc(20_000));
    const r = R.R11(
      parsedInput({
        proposal,
        simulation: {
          ok: true,
          deltas: [{ token: ADDR.usdc, holder: 'agent', delta: usdc(19_000) }],
          approvals: [],
        },
      }),
    );
    expect(r.result).toBe('DENY');
  });
  it('needs no simulation for a noop', () => {
    expect(R.R11(parsedInput({ proposal: noopProposal(), simulation: null })).result).toBe('PASS');
  });
});

describe('R12 — price freshness and depeg', () => {
  it('passes a fresh, pegged quote', () => {
    expect(R.R12(parsedInput()).result).toBe('PASS');
  });
  it('denies a stale quote', () => {
    const r = R.R12(
      parsedInput({
        state: { prices: freshPrice({ publishedAt: new Date(NOW.getTime() - 61_000) }) },
      }),
    );
    expect(r).toMatchObject({ result: 'DENY' });
  });
  it('passes a quote exactly at the age ceiling', () => {
    const r = R.R12(
      parsedInput({
        state: { prices: freshPrice({ publishedAt: new Date(NOW.getTime() - 60_000) }) },
      }),
    );
    expect(r.result).toBe('PASS');
  });
  it('denies a quote stamped in the future', () => {
    const r = R.R12(
      parsedInput({
        state: { prices: freshPrice({ publishedAt: new Date(NOW.getTime() + 5_000) }) },
      }),
    );
    expect(r.message).toContain('future');
  });
  it('denies a missing quote', () => {
    expect(R.R12(parsedInput({ state: { prices: {} } })).result).toBe('DENY');
  });
  it('denies taking on a depegged stable', () => {
    const r = R.R12(
      parsedInput({
        proposal: pullProposal(),
        state: { prices: freshPrice({ microUsd: 985_000n }) },
      }),
    );
    expect(r.message).toContain('off $1.00');
  });
  it('denies a payment sized from a broken quote (the micro-USD caps would be meaningless)', () => {
    const r = R.R12(
      parsedInput({
        proposal: payProposal(usdc(50_000)),
        state: { prices: freshPrice({ microUsd: 1n }) },
      }),
    );
    expect(r.message).toContain('off $1.00');
  });
  it('denies a vault withdraw during a depeg but not a risk exit', () => {
    const depegged = { prices: freshPrice({ microUsd: 900_000n }) };
    expect(R.R12(parsedInput({ proposal: withdrawProposal(), state: depegged })).result).toBe(
      'DENY',
    );
  });
  it('still lets an owner sweep run during a depeg', () => {
    const r = R.R12(
      parsedInput({
        proposal: sweepProposal(),
        state: { prices: freshPrice({ microUsd: 900_000n }) },
      }),
    );
    expect(r.result).toBe('PASS');
  });
  it('still lets a risk exit run during a depeg', () => {
    const r = R.R12(
      parsedInput({
        proposal: riskExitProposal(),
        state: { prices: freshPrice({ microUsd: 900_000n }) },
      }),
    );
    expect(r.result).toBe('PASS');
  });
  it('accepts the fenced DEMO parity fallback on testnet', () => {
    const r = R.R12(parsedInput({ demoStableParity: true, state: { prices: {} } }));
    expect(r.message).toContain('DEMO parity fallback');
  });
  it('ignores the DEMO fallback on mainnet', () => {
    const r = R.R12(
      parsedInput({
        demoStableParity: true,
        chainId: 5042,
        policy: { chainId: 5042 },
        state: { prices: {} },
      }),
    );
    expect(r.result).toBe('DENY');
  });
  it('needs no price for a noop', () => {
    expect(R.R12(parsedInput({ proposal: noopProposal(), state: { prices: {} } })).result).toBe(
      'PASS',
    );
  });
  it('denies when the policy has no USDC token', () => {
    const i = parsedInput();
    expect(R.R12({ ...i, policy: { ...i.policy, tokens: [] } }).result).toBe('DENY');
  });
});

describe('R13 — on-chain allowance', () => {
  it('passes a pull within the allowance', () => {
    expect(R.R13(parsedInput({ proposal: pullProposal() })).result).toBe('PASS');
  });
  it('denies a pull above the allowance', () => {
    const r = R.R13(parsedInput({ proposal: pullProposal(usdc(50_001)) }));
    expect(r).toMatchObject({ result: 'DENY' });
  });
  it('ignores other kinds', () => {
    expect(R.R13(parsedInput()).result).toBe('PASS');
  });
});

describe('R14 — rate limit', () => {
  it('passes below the limit', () => {
    expect(R.R14(parsedInput()).result).toBe('PASS');
  });
  it('denies at the policy limit', () => {
    expect(R.R14(parsedInput({ ledger: { actionsLastHour: 10 } }))).toMatchObject({
      result: 'DENY',
    });
  });
  it('denies at the system ceiling even if the policy asked for more', () => {
    const r = R.R14(
      parsedInput({
        policy: {
          limits: {
            perTxMicroUsd: usdc(50_000),
            dailyMicroUsd: usdc(60_000),
            maxActionsPerHour: 999,
          },
        },
        ledger: { actionsLastHour: 20 },
      }),
    );
    expect(r.result).toBe('DENY');
  });
});

describe('R15 — shadow verifier', () => {
  it('passes on AGREE', () => {
    expect(R.R15(parsedInput()).result).toBe('PASS');
  });
  it('denies on DISAGREE', () => {
    const r = R.R15(
      parsedInput({ verifier: { verdict: 'DISAGREE', reasons: ['not in mandate'] } }),
    );
    expect(r).toMatchObject({ result: 'DENY' });
    expect(r.message).toContain('not in mandate');
  });
  it('escalates on UNSURE', () => {
    expect(R.R15(parsedInput({ verifier: { verdict: 'UNSURE', reasons: [] } })).result).toBe(
      'ESCALATE',
    );
  });
  it('escalates when no verifier ran', () => {
    expect(R.R15(parsedInput({ verifier: null })).result).toBe('ESCALATE');
  });
  it('is skipped for deterministic and owner proposals', () => {
    expect(R.R15(parsedInput({ proposal: riskExitProposal(), verifier: null })).result).toBe(
      'PASS',
    );
  });
  it('is skipped for a noop', () => {
    expect(R.R15(parsedInput({ proposal: noopProposal(), verifier: null })).result).toBe('PASS');
  });
  it('reports a missing reason', () => {
    const r = R.R15(parsedInput({ verifier: { verdict: 'DISAGREE', reasons: [] } }));
    expect(r.message).toContain('no reason given');
  });
});

describe('R16 — injection screen', () => {
  const flagged = { injectionSuspected: true, signals: ['imperative: send all'] };
  it('passes when nothing was flagged', () => {
    expect(R.R16(parsedInput()).result).toBe('PASS');
  });
  it('denies a value-moving proposal when injection is suspected', () => {
    expect(R.R16(parsedInput({ screen: flagged }))).toMatchObject({ result: 'DENY' });
  });
  it('escalates a sweep home when injection is suspected', () => {
    expect(R.R16(parsedInput({ proposal: sweepProposal(), screen: flagged })).result).toBe(
      'ESCALATE',
    );
  });
  it('never blocks the safety actions', () => {
    expect(R.R16(parsedInput({ proposal: riskExitProposal(), screen: flagged })).result).toBe(
      'PASS',
    );
    expect(R.R16(parsedInput({ proposal: noopProposal(), screen: flagged })).result).toBe('PASS');
  });
  it('reports unspecified signals', () => {
    const r = R.R16(parsedInput({ screen: { injectionSuspected: true, signals: [] } }));
    expect(r.message).toContain('unspecified');
  });
});

describe('R17 — replay', () => {
  it('passes a proposal that was not seen before', () => {
    expect(R.R17(parsedInput()).result).toBe('PASS');
  });
  it('denies a proposal hash already in the 24h window', () => {
    const proposal = payProposal();
    const r = R.R17(
      parsedInput({ proposal, ledger: { recentProposalHashes: [hashProposal(proposal)] } }),
    );
    expect(r).toMatchObject({ result: 'DENY' });
  });
  it('ignores noops', () => {
    const proposal = noopProposal();
    const r = R.R17(
      parsedInput({ proposal, ledger: { recentProposalHashes: [hashProposal(proposal)] } }),
    );
    expect(r.result).toBe('PASS');
  });
});

describe('R18 — approvals', () => {
  it('passes one exact-amount approval to the deposit vault', () => {
    const proposal = depositProposal();
    expect(R.R18(parsedInput({ proposal })).result).toBe('PASS');
  });
  it('passes when there are no approvals at all', () => {
    expect(R.R18(parsedInput()).result).toBe('PASS');
  });
  it('denies an approval on a kind that should never approve', () => {
    const r = R.R18(
      parsedInput({
        simulation: {
          ok: true,
          deltas: payProposal().expectedDeltas,
          approvals: [{ token: ADDR.usdc, spender: ADDR.vault, amount: usdc(1) }],
        },
      }),
    );
    expect(r).toMatchObject({ result: 'DENY' });
  });
  it('denies two approvals in one deposit', () => {
    const proposal = depositProposal();
    const one = { token: ADDR.usdc, spender: ADDR.vault, amount: proposal.params.amount };
    const r = R.R18(
      parsedInput({
        proposal,
        simulation: { ok: true, deltas: proposal.expectedDeltas, approvals: [one, one] },
      }),
    );
    expect(r.message).toContain('2 approvals');
  });
  it('denies an approval to something that is not the deposit vault', () => {
    const proposal = depositProposal();
    const r = R.R18(
      parsedInput({
        proposal,
        simulation: {
          ok: true,
          deltas: proposal.expectedDeltas,
          approvals: [{ token: ADDR.usdc, spender: ADDR.attacker, amount: proposal.params.amount }],
        },
      }),
    );
    expect(r.message).toContain('is not vault');
  });
  it('denies an approval on a token that is not a policy token', () => {
    const proposal = depositProposal();
    const r = R.R18(
      parsedInput({
        proposal,
        simulation: {
          ok: true,
          deltas: proposal.expectedDeltas,
          approvals: [
            { token: ADDR.attacker, spender: ADDR.vault, amount: proposal.params.amount },
          ],
        },
      }),
    );
    expect(r.message).toContain('not a policy token');
  });
  it('denies an unlimited approval', () => {
    const proposal = depositProposal();
    const r = R.R18(
      parsedInput({
        proposal,
        simulation: {
          ok: true,
          deltas: proposal.expectedDeltas,
          approvals: [{ token: ADDR.usdc, spender: ADDR.vault, amount: 2n ** 256n - 1n }],
        },
      }),
    );
    expect(r.message).toContain('not the exact deposit');
  });
  it('denies an approval for a deposit into a vault that is not in the policy', () => {
    const proposal = depositProposal(usdc(10), { params: { vaultId: 'ghost', amount: usdc(10) } });
    const r = R.R18(
      parsedInput({
        proposal,
        simulation: {
          ok: true,
          deltas: proposal.expectedDeltas,
          approvals: [{ token: ADDR.usdc, spender: ADDR.vault, amount: usdc(10) }],
        },
      }),
    );
    expect(r.message).toContain('not in the policy');
  });
});

describe('R19 — grounding', () => {
  it('passes cited facts that exist', () => {
    expect(R.R19(parsedInput()).result).toBe('PASS');
  });
  it('denies an invented fact id', () => {
    const r = R.R19(
      parsedInput({ proposal: payProposal(usdc(10), { citedFactIds: ['F_MADE_UP'] }) }),
    );
    expect(r).toMatchObject({ result: 'DENY' });
  });
  it('escalates low confidence', () => {
    const r = R.R19(parsedInput({ proposal: payProposal(usdc(10), { confidence: 0.4 }) }));
    expect(r.result).toBe('ESCALATE');
  });
});

describe('R20 — risk exit override', () => {
  const triggered = {
    riskTriggers: [{ vaultId: 'v1', trigger: 'vault_drawdown' as const, observed: '-300 bps' }],
  };
  it('passes when the trigger is real and funds only come home', () => {
    expect(R.R20(parsedInput({ proposal: riskExitProposal(), state: triggered })).result).toBe(
      'PASS',
    );
  });
  it('escalates when no trigger was observed', () => {
    expect(R.R20(parsedInput({ proposal: riskExitProposal() }))).toMatchObject({
      result: 'ESCALATE',
    });
  });
  it('escalates when the observed trigger is of another type', () => {
    const r = R.R20(
      parsedInput({
        proposal: riskExitProposal(),
        state: { riskTriggers: [{ vaultId: 'v1', trigger: 'asset_depeg', observed: 'x' }] },
      }),
    );
    expect(r.result).toBe('ESCALATE');
  });
  it('denies an exit that would move funds to anyone but the agent', () => {
    const proposal = riskExitProposal({
      expectedDeltas: [{ token: ADDR.usdc, holder: 'recipient', delta: usdc(1_000) }],
    });
    expect(R.R20(parsedInput({ proposal, state: triggered })).result).toBe('DENY');
  });
  it('denies an exit that reduces a balance', () => {
    const proposal = riskExitProposal({
      expectedDeltas: [{ token: ADDR.usdc, holder: 'agent', delta: -usdc(1_000) }],
    });
    expect(R.R20(parsedInput({ proposal, state: triggered })).result).toBe('DENY');
  });
  it('ignores other kinds', () => {
    expect(R.R20(parsedInput()).result).toBe('PASS');
  });
});

describe('R21 — chain guard', () => {
  it('passes matching testnet chains', () => {
    expect(R.R21(parsedInput()).result).toBe('PASS');
  });
  it('denies a policy for another chain', () => {
    expect(R.R21(parsedInput({ chainId: 5042 }))).toMatchObject({ result: 'DENY' });
  });
  it('denies mainnet without the flag', () => {
    const r = R.R21(parsedInput({ chainId: 5042, policy: { chainId: 5042 } }));
    expect(r.message).toContain('allowMainnet');
  });
  it('allows mainnet with the flag', () => {
    const r = R.R21(parsedInput({ chainId: 5042, policy: { chainId: 5042 }, allowMainnet: true }));
    expect(r.result).toBe('PASS');
  });
});

describe('R22 — continuous compliance screening', () => {
  it('passes a non-payment kind', () => {
    expect(R.R22(parsedInput({ proposal: depositProposal() })).result).toBe('PASS');
  });
  it('passes when the recipient has no screen on record', () => {
    expect(R.R22(parsedInput({ proposal: payProposal() })).result).toBe('PASS');
  });
  it('passes an unresolved recipient (R05 already denies it)', () => {
    const amount = usdc(100);
    const r = R.R22(
      parsedInput({ proposal: payProposal(amount, { params: { recipientId: 'ghost', amount } }) }),
    );
    expect(r.result).toBe('PASS');
  });
  it('passes a "low" tier screen', () => {
    const r = R.R22(
      parsedInput({
        proposal: payProposal(),
        state: { recipientScreens: { alex: { tier: 'low', screenedAt: NOW } } },
      }),
    );
    expect(r.result).toBe('PASS');
  });
  it('passes a "medium" tier payment within the tier cap', () => {
    const r = R.R22(
      parsedInput({
        proposal: payProposal(usdc(5_000)),
        state: { recipientScreens: { alex: { tier: 'medium', screenedAt: NOW } } },
      }),
    );
    expect(r.result).toBe('PASS');
  });
  it('escalates a "medium" tier payment over the tier cap', () => {
    const r = R.R22(
      parsedInput({
        proposal: payProposal(usdc(20_000)),
        state: { recipientScreens: { alex: { tier: 'medium', screenedAt: NOW } } },
      }),
    );
    expect(r.result).toBe('ESCALATE');
    expect(r.message).toContain('medium-risk tier cap');
  });
  it('escalates any "high" tier payment (cap is zero)', () => {
    const r = R.R22(
      parsedInput({
        proposal: payProposal(usdc(1)),
        state: { recipientScreens: { alex: { tier: 'high', screenedAt: NOW } } },
      }),
    );
    expect(r.result).toBe('ESCALATE');
    expect(r.message).toContain('high-risk tier cap');
  });
  it('escalates rather than denying when the amount cannot be valued', () => {
    const r = R.R22(
      parsedInput({
        proposal: payProposal(),
        state: {
          recipientScreens: { alex: { tier: 'high', screenedAt: NOW } },
          prices: {},
        },
      }),
    );
    expect(r.result).toBe('ESCALATE');
  });
});

describe('the catalogue', () => {
  it('holds all 23 rules in order and every rule returns its own code', () => {
    expect(R.RULES).toHaveLength(23);
    const input = zEvaluationInput.parse(parsedInput());
    const codes = R.RULES.map((rule) => rule(input).code);
    expect(codes).toEqual(Array.from({ length: 23 }, (_, i) => `R${String(i).padStart(2, '0')}`));
  });
  it('simulationFor builds an approval only for deposits', () => {
    expect(simulationFor(depositProposal()).approvals).toHaveLength(1);
    expect(simulationFor(payProposal()).approvals).toHaveLength(0);
  });
});
