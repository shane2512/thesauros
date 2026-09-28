// Task 3.5 — the conversion helpers, bigint only. Every limit in the engine is denominated in
// micro-USD, so these are load-bearing.
import { describe, expect, it } from 'vitest';
import {
  ONE_USD_MICRO,
  baseUnitsToMicroUsd,
  byAddress,
  depegBps,
  microUsdToBaseUnits,
  priceOf,
  proposalAmountBaseUnits,
  quoteAgeSeconds,
  usdcToken,
  valueInput,
} from '../src/units';
import {
  ADDR,
  ALL_KINDS,
  NOW,
  parsedInput,
  proposalForKind,
  depositProposal,
  usdc,
} from './fixtures';

const quote = (microUsd: bigint) => ({ microUsd, publishedAt: NOW });

describe('token lookup', () => {
  it('finds the policy USDC token', () => {
    expect(usdcToken(parsedInput().policy)?.address).toBe(ADDR.usdc);
  });
  it('returns undefined when the policy has none', () => {
    const p = parsedInput().policy;
    expect(usdcToken({ ...p, tokens: [] })).toBeUndefined();
  });
  it('looks up records by address regardless of casing', () => {
    const record = { [ADDR.usdc.toLowerCase()]: 'yes' };
    expect(byAddress(record, ADDR.usdc)).toBe('yes');
    expect(byAddress(record, ADDR.attacker)).toBeUndefined();
    expect(byAddress({ 'not-an-address': 'x' }, ADDR.usdc)).toBeUndefined();
  });
});

describe('priceOf', () => {
  it('returns the oracle quote', () => {
    const r = priceOf(parsedInput(), ADDR.usdc);
    expect(r.ok && r.value.quote.microUsd).toBe(ONE_USD_MICRO);
    expect(r.ok && r.value.demoFallback).toBe(false);
  });
  it('fails when there is no quote', () => {
    expect(priceOf(parsedInput({ state: { prices: {} } }), ADDR.usdc).ok).toBe(false);
  });
  it('uses the fenced DEMO parity fallback only on Base Sepolia', () => {
    const onTestnet = priceOf(
      parsedInput({ demoStableParity: true, state: { prices: {} } }),
      ADDR.usdc,
    );
    expect(onTestnet.ok && onTestnet.value.demoFallback).toBe(true);
    const onMainnet = priceOf(
      parsedInput({
        demoStableParity: true,
        chainId: 8453,
        policy: { chainId: 8453 },
        state: { prices: {} },
      }),
      ADDR.usdc,
    );
    expect(onMainnet.ok).toBe(false);
  });
  it('never overrides a real quote with the fallback', () => {
    const r = priceOf(
      parsedInput({ demoStableParity: true, state: { prices: { [ADDR.usdc]: quote(990_000n) } } }),
      ADDR.usdc,
    );
    expect(r.ok && r.value.quote.microUsd).toBe(990_000n);
  });
});

describe('base units <-> micro-USD', () => {
  it('converts at the oracle price, flooring', () => {
    expect(baseUnitsToMicroUsd(usdc(3_000), 6, quote(ONE_USD_MICRO))).toEqual({
      ok: true,
      value: usdc(3_000),
    });
    expect(baseUnitsToMicroUsd(usdc(100), 6, quote(999_000n))).toEqual({
      ok: true,
      value: 99_900_000n,
    });
    expect(baseUnitsToMicroUsd(1n, 6, quote(1n))).toEqual({ ok: true, value: 0n });
  });
  it('refuses a zero or negative price', () => {
    expect(baseUnitsToMicroUsd(1n, 6, quote(0n)).ok).toBe(false);
    expect(microUsdToBaseUnits(1n, 6, quote(0n)).ok).toBe(false);
  });
  it('converts back, flooring', () => {
    expect(microUsdToBaseUnits(usdc(3_000), 6, quote(ONE_USD_MICRO))).toEqual({
      ok: true,
      value: usdc(3_000),
    });
    expect(microUsdToBaseUnits(99_900_000n, 6, quote(999_000n))).toEqual({
      ok: true,
      value: usdc(100),
    });
  });
  it('round-trips without inflating value', () => {
    for (const price of [ONE_USD_MICRO, 999_000n, 1_010_000n]) {
      const micro = baseUnitsToMicroUsd(usdc(12_345), 6, quote(price));
      expect(micro.ok).toBe(true);
      if (!micro.ok) return;
      const back = microUsdToBaseUnits(micro.value, 6, quote(price));
      expect(back.ok && back.value <= usdc(12_345)).toBe(true);
    }
  });
});

describe('proposalAmountBaseUnits', () => {
  it.each(ALL_KINDS)('%s', (kind) => {
    const amount = proposalAmountBaseUnits(proposalForKind(kind));
    const carriesAmount = [
      'pull_allowance',
      'vault_deposit',
      'vault_withdraw',
      'pay_recipient',
    ].includes(kind);
    expect(amount === null).toBe(!carriesAmount);
  });
});

describe('valueInput', () => {
  it('values the amount, the liquid balance and the managed total at one quote', () => {
    const v = valueInput(
      parsedInput({
        proposal: depositProposal(usdc(44_000)),
        state: { vaultPositions: { v1: usdc(10_000) } },
      }),
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.amountMicroUsd).toBe(usdc(44_000));
    expect(v.value.liquidMicroUsd).toBe(usdc(200_000));
    expect(v.value.managedMicroUsd).toBe(usdc(210_000));
    expect(v.value.vaultPositionMicroUsd('v1')).toBe(usdc(10_000));
    expect(v.value.vaultPositionMicroUsd('nope')).toBe(0n);
  });
  it('is 0 for a kind that carries no amount', () => {
    const v = valueInput(parsedInput({ proposal: proposalForKind('sweep_home') }));
    expect(v.ok && v.value.amountMicroUsd).toBe(0n);
  });
  it('ignores positions in vaults the policy does not allowlist', () => {
    const v = valueInput(parsedInput({ state: { vaultPositions: { ghost: usdc(1_000_000) } } }));
    expect(v.ok && v.value.managedMicroUsd).toBe(usdc(200_000));
  });
  it('fails without a token, without a price, and at a zero price', () => {
    const base = parsedInput();
    expect(valueInput({ ...base, policy: { ...base.policy, tokens: [] } }).ok).toBe(false);
    expect(valueInput(parsedInput({ state: { prices: {} } })).ok).toBe(false);
    expect(valueInput(parsedInput({ state: { prices: { [ADDR.usdc]: quote(0n) } } })).ok).toBe(
      false,
    );
  });
});

describe('depeg and freshness maths', () => {
  it('measures deviation from $1.00 in both directions', () => {
    expect(depegBps(quote(ONE_USD_MICRO))).toBe(0n);
    expect(depegBps(quote(995_000n))).toBe(50n);
    expect(depegBps(quote(1_005_000n))).toBe(50n);
    expect(depegBps(quote(1n))).toBe(9_999n);
  });
  it('measures quote age in whole seconds, negative in the future', () => {
    expect(quoteAgeSeconds(quote(ONE_USD_MICRO), NOW)).toBe(0);
    expect(
      quoteAgeSeconds(
        { microUsd: ONE_USD_MICRO, publishedAt: new Date(NOW.getTime() - 1_500) },
        NOW,
      ),
    ).toBe(1);
    expect(
      quoteAgeSeconds(
        { microUsd: ONE_USD_MICRO, publishedAt: new Date(NOW.getTime() + 5_000) },
        NOW,
      ),
    ).toBe(-5);
  });
});
