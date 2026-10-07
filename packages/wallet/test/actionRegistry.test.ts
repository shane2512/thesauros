// buildCalls (Phase 2): every kind resolves addresses from the POLICY only, never the proposal
// (I4), and callsHash is a pure, deterministic function of the built calls (I10).
import { describe, expect, it } from 'vitest';
import { encodeFunctionData } from 'viem';
import type { Proposal } from '@thesauros/shared';
import { ERC20_ABI, ERC4626_ABI, buildCalls, callsHash } from '../src';
import { ctx, policy, proposals, RECIPIENT, TREASURY, USDC, VAULT } from './fixtures';

describe('buildCalls', () => {
  it('noop builds no calls', () => {
    const r = buildCalls(proposals.noop, policy, ctx);
    expect(r.ok && r.value).toEqual([]);
  });

  it('pull_allowance is NOT_IMPLEMENTED (Base Spend-Permission-specific, no Circle equivalent)', () => {
    const r = buildCalls(proposals.pull, policy, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('sweep_home transfers the whole agent balance to the policy treasury', () => {
    const r = buildCalls(proposals.sweep, policy, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([
      {
        to: USDC,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [TREASURY, ctx.agentUsdcBalance],
        }),
        value: 0n,
      },
    ]);
  });

  it('pay_recipient transfers to the address resolved from the policy allowlist', () => {
    const r = buildCalls(proposals.pay, policy, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([
      {
        to: USDC,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [RECIPIENT, 1_000_000n],
        }),
        value: 0n,
      },
    ]);
  });

  it('pay_recipient denies an id that is not on the policy allowlist (I4)', () => {
    const bad: Proposal = {
      ...proposals.pay,
      kind: 'pay_recipient',
      params: { recipientId: 'ghost', amount: 1_000_000n },
    };
    const r = buildCalls(bad, policy, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNKNOWN_RECIPIENT');
  });

  it('vault_deposit approves then deposits into the resolved vault', () => {
    const r = buildCalls(proposals.deposit, policy, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([
      {
        to: USDC,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [VAULT, 1_000_000n],
        }),
        value: 0n,
      },
      {
        to: VAULT,
        data: encodeFunctionData({
          abi: ERC4626_ABI,
          functionName: 'deposit',
          args: [1_000_000n, ctx.agentWalletAddress],
        }),
        value: 0n,
      },
    ]);
  });

  it('vault_deposit denies an unknown vault id', () => {
    const bad: Proposal = {
      ...proposals.deposit,
      kind: 'vault_deposit',
      params: { vaultId: 'ghost', amount: 1_000_000n },
    };
    const r = buildCalls(bad, policy, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNKNOWN_VAULT');
  });

  it('vault_withdraw calls ERC4626 withdraw for the requested asset amount', () => {
    const r = buildCalls(proposals.withdraw, policy, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([
      {
        to: VAULT,
        data: encodeFunctionData({
          abi: ERC4626_ABI,
          functionName: 'withdraw',
          args: [1_000_000n, ctx.agentWalletAddress, ctx.agentWalletAddress],
        }),
        value: 0n,
      },
    ]);
  });

  describe('vault_withdraw on a USYC Teller vault', () => {
    const tellerPolicy = {
      ...policy,
      vaults: policy.vaults.map((v) => ({ ...v, kind: 'usyc_teller' as const })),
    };
    const redeemData = (shares: bigint) =>
      encodeFunctionData({
        abi: ERC4626_ABI,
        functionName: 'redeem',
        args: [shares, ctx.agentWalletAddress, ctx.agentWalletAddress],
      });

    it('redeems the shares worth the amount, rounded up, from the on-chain position', () => {
      // 2_000_000 shares are worth 2_200_000 assets, so 1_000_000 assets is 909_090.9 -> 909_091 shares.
      const r = buildCalls(proposals.withdraw, tellerPolicy, ctx);
      expect(r.ok && r.value).toEqual([{ to: VAULT, data: redeemData(909_091n), value: 0n }]);
    });

    it('never redeems more shares than the agent holds', () => {
      const greedy: Proposal = {
        ...proposals.withdraw,
        kind: 'vault_withdraw',
        params: { vaultId: 'v1', amount: 9_000_000n },
      };
      const r = buildCalls(greedy, tellerPolicy, ctx);
      expect(r.ok && r.value).toEqual([{ to: VAULT, data: redeemData(2_000_000n), value: 0n }]);
    });

    it('fails closed when there is no position to withdraw from', () => {
      const r = buildCalls(proposals.withdraw, tellerPolicy, { ...ctx, vaultPositions: {} });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('NO_POSITION');
    });
  });

  it('risk_exit redeems the WHOLE position, never a proposal-supplied amount', () => {
    const r = buildCalls(proposals.riskExit, policy, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const shares = ctx.vaultPositions['v1']?.shares ?? 0n;
    expect(r.value).toEqual([
      {
        to: VAULT,
        data: encodeFunctionData({
          abi: ERC4626_ABI,
          functionName: 'redeem',
          args: [shares, ctx.agentWalletAddress, ctx.agentWalletAddress],
        }),
        value: 0n,
      },
    ]);
  });

  it('risk_exit refuses to build when there is no position to exit', () => {
    const emptyCtx = { ...ctx, vaultPositions: {} };
    const r = buildCalls(proposals.riskExit, policy, emptyCtx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NO_POSITION');
  });

  it('denies when the policy has no USDC token', () => {
    const noToken = { ...policy, tokens: [] };
    const r = buildCalls(proposals.sweep, noToken, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NO_USDC_TOKEN');
  });
});

describe('callsHash', () => {
  it('is deterministic for the same calls', () => {
    const built = buildCalls(proposals.pay, policy, ctx);
    if (!built.ok) throw new Error('expected calls');
    expect(callsHash(built.value)).toBe(callsHash(built.value));
  });

  it('differs when the amount differs', () => {
    const a = buildCalls(proposals.pay, policy, ctx);
    const b = buildCalls(
      {
        ...proposals.pay,
        kind: 'pay_recipient',
        params: { recipientId: 'r1', amount: 2_000_000n },
      },
      policy,
      ctx,
    );
    if (!a.ok || !b.ok) throw new Error('expected calls');
    expect(callsHash(a.value)).not.toBe(callsHash(b.value));
  });

  it('is empty-array-safe', () => {
    expect(callsHash([])).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
