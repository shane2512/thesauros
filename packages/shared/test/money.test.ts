import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatUnits, parseBaseUnits, parseUnits, toMicroUsd } from '../src/money';

describe('money', () => {
  it('parses and formats exactly', () => {
    expect(parseUnits('12.5', 6)).toEqual({ ok: true, value: 12_500_000n });
    expect(parseUnits('0.000001', 6)).toEqual({ ok: true, value: 1n });
    expect(formatUnits(12_500_000n, 6)).toBe('12.5');
    expect(formatUnits(1n, 6)).toBe('0.000001');
    expect(formatUnits(0n, 6)).toBe('0');
    expect(formatUnits(-1_500_000n, 6)).toBe('-1.5');
  });

  it('rejects floats, signs, exponents, excess precision', () => {
    for (const bad of ['', '-1', '1e6', '1.', '.5', '1.0000001', 'abc', ' 1']) {
      expect(parseUnits(bad, 6).ok).toBe(false);
    }
    expect(parseBaseUnits('1.5').ok).toBe(false);
    expect(parseBaseUnits('15')).toEqual({ ok: true, value: 15n });
  });

  it('property: format/parse roundtrip for any bigint >= 0', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 30n }),
        fc.integer({ min: 0, max: 18 }),
        (v, d) => {
          expect(parseUnits(formatUnits(v, d), d)).toEqual({ ok: true, value: v });
        },
      ),
    );
  });

  it('property: micro-USD at $1 price equals base units for 6-dec tokens; monotonic in amount', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 24n }),
        fc.bigInt({ min: 0n, max: 10n ** 24n }),
        (a, b) => {
          expect(toMicroUsd(a, 6, 1_000_000n)).toBe(a);
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(toMicroUsd(lo, 6, 999_000n)).toBeLessThanOrEqual(toMicroUsd(hi, 6, 999_000n));
        },
      ),
    );
  });
});
