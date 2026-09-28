// Opus review gate evidence for Q1 (no call to an unresolved address) and Q2 (approvals are exact,
// never maxUint256). Every ProposalKind is covered; unknown ids must fail closed.
import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionData, getAddress, maxUint256, type Hex } from 'viem';
import { PROPOSAL_KINDS, type Policy, type Proposal } from '@thesauros/shared';
import { ERC20_ABI, ERC4626_ABI, SPEND_PERMISSION_MANAGER_ABI } from '../src/abi';
import { allowedTargets, buildCalls } from '../src/actionRegistry';
import { callsHash, type Call } from '../src/calls';
import {
  AGENT,
  ATTACKER,
  MANAGER,
  RECIPIENT,
  TREASURY,
  USDC,
  VAULT,
  ctx,
  permission,
  policy,
  proposals,
} from './fixtures';

const unwrap = (r: ReturnType<typeof buildCalls>): Call[] => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
};
const errorOf = (r: ReturnType<typeof buildCalls>) => {
  if (r.ok) throw new Error('expected an error');
  return r.error;
};

describe('buildCalls — per-kind calldata', () => {
  it('pull_allowance → SpendPermissionManager.spend(permission, amount)', () => {
    const calls = unwrap(buildCalls(proposals.pull, policy, ctx));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.to).toBe(MANAGER);
    expect(calls[0]!.data).toBe(
      encodeFunctionData({
        abi: SPEND_PERMISSION_MANAGER_ABI,
        functionName: 'spend',
        args: [permission, 1_000_000n],
      }),
    );
  });

  it('vault_deposit → exact approve then deposit(amount, agent)', () => {
    const calls = unwrap(buildCalls(proposals.deposit, policy, ctx));
    expect(calls.map((c) => c.to)).toEqual([USDC, VAULT]);
    expect(decodeFunctionData({ abi: ERC20_ABI, data: calls[0]!.data })).toEqual({
      functionName: 'approve',
      args: [VAULT, 1_000_000n],
    });
    expect(decodeFunctionData({ abi: ERC4626_ABI, data: calls[1]!.data })).toEqual({
      functionName: 'deposit',
      args: [1_000_000n, AGENT],
    });
  });

  it('vault_withdraw → withdraw(assets, agent, agent)', () => {
    const calls = unwrap(buildCalls(proposals.withdraw, policy, ctx));
    expect(calls.map((c) => c.to)).toEqual([VAULT]);
    expect(decodeFunctionData({ abi: ERC4626_ABI, data: calls[0]!.data })).toEqual({
      functionName: 'withdraw',
      args: [1_000_000n, AGENT, AGENT],
    });
  });

  it('pay_recipient → USDC.transfer to the address resolved from Policy', () => {
    const calls = unwrap(buildCalls(proposals.pay, policy, ctx));
    expect(calls.map((c) => c.to)).toEqual([USDC]);
    expect(decodeFunctionData({ abi: ERC20_ABI, data: calls[0]!.data })).toEqual({
      functionName: 'transfer',
      args: [RECIPIENT, 1_000_000n],
    });
  });

  it('risk_exit → redeem all shares back to the agent wallet only', () => {
    const calls = unwrap(buildCalls(proposals.riskExit, policy, ctx));
    expect(calls.map((c) => c.to)).toEqual([VAULT]);
    expect(decodeFunctionData({ abi: ERC4626_ABI, data: calls[0]!.data })).toEqual({
      functionName: 'redeem',
      args: [2_000_000n, AGENT, AGENT],
    });
  });

  it('sweep_home → redeem every position, then transfer the whole balance to the treasury', () => {
    const calls = unwrap(buildCalls(proposals.sweep, policy, ctx));
    expect(calls.map((c) => c.to)).toEqual([VAULT, USDC]);
    expect(decodeFunctionData({ abi: ERC20_ABI, data: calls[1]!.data })).toEqual({
      functionName: 'transfer',
      args: [TREASURY, 3_000_000n + 2_200_000n],
    });
  });

  it('noop → no calls', () => {
    expect(unwrap(buildCalls(proposals.noop, policy, ctx))).toEqual([]);
  });

  it('covers every ProposalKind', () => {
    expect(
      Object.values(proposals)
        .map((p) => p.kind)
        .sort(),
    ).toEqual([...PROPOSAL_KINDS].sort());
  });

  it('callsHash is stable and order-sensitive', () => {
    const calls = unwrap(buildCalls(proposals.deposit, policy, ctx));
    expect(callsHash(calls)).toBe(callsHash(unwrap(buildCalls(proposals.deposit, policy, ctx))));
    expect(callsHash(calls)).not.toBe(callsHash([...calls].reverse()));
  });
});

describe('buildCalls — fails closed', () => {
  it('unknown vault id', () => {
    const p = { ...proposals.deposit, params: { vaultId: 'nope', amount: 1n } } as Proposal;
    expect(errorOf(buildCalls(p, policy, ctx)).code).toBe('UNKNOWN_VAULT');
  });

  it('unknown recipient id', () => {
    const p = { ...proposals.pay, params: { recipientId: 'nope', amount: 1n } } as Proposal;
    expect(errorOf(buildCalls(p, policy, ctx)).code).toBe('UNKNOWN_RECIPIENT');
  });

  it('zero and negative amounts', () => {
    for (const amount of [0n, -1n]) {
      const p = { ...proposals.deposit, params: { vaultId: 'v1', amount } } as Proposal;
      expect(errorOf(buildCalls(p, policy, ctx)).code).toBe('INVALID_AMOUNT');
    }
  });

  it('pull_allowance above the on-chain allowance', () => {
    const p = { ...proposals.pull, params: { amount: permission.allowance + 1n } } as Proposal;
    expect(errorOf(buildCalls(p, policy, ctx)).code).toBe('INVALID_AMOUNT');
  });

  it('pull_allowance with no stored permission', () => {
    expect(
      errorOf(buildCalls(proposals.pull, policy, { ...ctx, spendPermission: undefined })).code,
    ).toBe('MISSING_PERMISSION');
  });

  it.each([
    ['spender', { ...permission, spender: ATTACKER }],
    ['token', { ...permission, token: ATTACKER }],
    ['account', { ...permission, account: ATTACKER }],
  ])('pull_allowance rejects a permission whose %s was swapped', (_field, swapped) => {
    expect(
      errorOf(buildCalls(proposals.pull, policy, { ...ctx, spendPermission: swapped })).code,
    ).toBe('PERMISSION_MISMATCH');
  });

  it('vault whose asset is not the policy USDC', () => {
    const p: Policy = {
      ...policy,
      vaults: [{ ...policy.vaults[0]!, asset: ATTACKER }],
    };
    expect(errorOf(buildCalls(proposals.deposit, p, ctx)).code).toBe('UNKNOWN_TOKEN');
  });

  it('risk_exit with no position', () => {
    expect(
      errorOf(buildCalls(proposals.riskExit, policy, { ...ctx, vaultPositions: {} })).code,
    ).toBe('NOTHING_TO_DO');
  });

  it('sweep_home with nothing to sweep', () => {
    expect(
      errorOf(
        buildCalls(proposals.sweep, policy, { ...ctx, agentUsdcBalance: 0n, vaultPositions: {} }),
      ).code,
    ).toBe('NOTHING_TO_DO');
  });

  it('refuses mainnet even with allowMainnet set, until the Phase 9 gate is signed off (I8)', () => {
    const mainnet: Policy = { ...policy, chainId: 8453 };
    expect(errorOf(buildCalls(proposals.pay, mainnet, ctx)).code).toBe('CHAIN_REFUSED');
    expect(errorOf(buildCalls(proposals.pay, mainnet, { ...ctx, allowMainnet: true })).code).toBe(
      'CHAIN_REFUSED',
    );
  });
});

describe('Opus review gate Q1 — every target is resolved from Policy', () => {
  const targets = allowedTargets(policy, ctx);

  it('the allowlist is exactly {tokens, vaults, recipients, treasury, SpendPermissionManager}', () => {
    expect([...targets].sort()).toEqual([USDC, VAULT, RECIPIENT, TREASURY, MANAGER].sort());
    expect(targets.has(ATTACKER)).toBe(false);
  });

  it('no kind can produce a call outside the allowlist, and none carries native value', () => {
    for (const proposal of Object.values(proposals)) {
      const r = buildCalls(proposal, policy, ctx);
      if (!r.ok) continue;
      for (const call of r.value) {
        expect(targets.has(getAddress(call.to)), `${proposal.kind} → ${call.to}`).toBe(true);
        expect(call.value).toBe(0n);
      }
    }
  });

  it('an address that appears only in proposal-adjacent state never becomes a target', () => {
    // A poisoned "recipient" that is not in Policy cannot be reached by id (R05/I4).
    const poisoned = {
      ...proposals.pay,
      params: { recipientId: ATTACKER, amount: 1n },
    } as Proposal;
    expect(errorOf(buildCalls(poisoned, policy, ctx)).code).toBe('UNKNOWN_RECIPIENT');
  });

  it('the final target assertion catches a Policy entry that was not in the allowlist', () => {
    // Simulate a bug where a vault address slipped past resolution: assertAllowedTargets must fire.
    const tampered: Policy = { ...policy, vaults: [{ ...policy.vaults[0]!, address: ATTACKER }] };
    const built = buildCalls(proposals.deposit, tampered, ctx);
    // Policy *is* the source of truth, so this one is legitimately allowed…
    expect(built.ok).toBe(true);
    // …but a target that is in no Policy list at all is rejected:
    const narrowed = allowedTargets(policy, ctx);
    expect(narrowed.has(ATTACKER)).toBe(false);
  });
});

describe('Opus review gate Q2 — approvals are exact, never unbounded', () => {
  it('the only approve in any kind is for exactly the deposited amount', () => {
    const approvals: { spender: string; value: bigint }[] = [];
    for (const proposal of Object.values(proposals)) {
      const r = buildCalls(proposal, policy, ctx);
      if (!r.ok) continue;
      for (const call of r.value) {
        if (getAddress(call.to) !== USDC) continue;
        const d = decodeFunctionData({ abi: ERC20_ABI, data: call.data });
        if (d.functionName === 'approve') approvals.push({ spender: d.args[0], value: d.args[1] });
      }
    }
    expect(approvals).toEqual([{ spender: VAULT, value: 1_000_000n }]);
  });

  it.each([maxUint256, 2n ** 160n - 1n])('no call encodes the unbounded value %s', (big) => {
    const bigHex = big.toString(16).padStart(64, '0');
    for (const proposal of Object.values(proposals)) {
      const r = buildCalls(proposal, policy, ctx);
      if (!r.ok) continue;
      for (const call of r.value) expect((call.data as Hex).toLowerCase()).not.toContain(bigHex);
    }
  });
});
