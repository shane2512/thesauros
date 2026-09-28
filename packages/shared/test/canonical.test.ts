import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson, hashCanonical } from '../src/canonical';

describe('canonical json', () => {
  it('sorts keys, drops undefined, serializes bigint as decimal string', () => {
    expect(canonicalJson({ b: 1, a: { d: 2n, c: undefined } })).toBe('{"a":{"d":"2"},"b":1}');
    expect(canonicalJson(new Date('2026-01-01T00:00:00Z'))).toBe('"2026-01-01T00:00:00.000Z"');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ a: NaN })).toThrow();
  });

  it('sha256 known vector', () => {
    // sha256('{}')
    expect(hashCanonical({})).toBe(
      '0x44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
  });

  const json: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
    v: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer(),
      fc.string(),
      fc.bigInt(),
      fc.array(tie('v'), { maxLength: 4 }),
      fc.dictionary(fc.string(), tie('v'), { maxKeys: 4 }),
    ),
  })).v;

  it('property: key order never changes the output/hash', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), json, { maxKeys: 6 }), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        expect(canonicalJson(reversed)).toBe(canonicalJson(obj));
        expect(hashCanonical(reversed)).toBe(hashCanonical(obj));
      }),
    );
  });

  it('property: output is valid JSON and idempotent under re-canonicalization', () => {
    fc.assert(
      fc.property(json, (v) => {
        const s = canonicalJson(v);
        expect(canonicalJson(JSON.parse(s))).toBe(s);
      }),
    );
  });
});
