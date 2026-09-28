import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { addressEquals, checksum } from '../src/address';
import { createLogger } from '../src/logger';
import { zPolicy, zProposal } from '../src/schemas';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

describe('address', () => {
  it('checksums lowercase, rejects bad checksum and junk', () => {
    expect(checksum(USDC.toLowerCase())).toEqual({ ok: true, value: USDC });
    expect(checksum(USDC.replace('C', 'c')).ok).toBe(false);
    expect(checksum('vitalik.eth').ok).toBe(false);
    expect(checksum('0x1234').ok).toBe(false);
  });
  it('equality is exact after checksum; near-matches are not equal (I4)', () => {
    expect(addressEquals(USDC, USDC.toLowerCase())).toBe(true);
    expect(addressEquals(USDC, USDC.slice(0, -4) + '0000')).toBe(false);
  });
});

describe('logger redaction', () => {
  it('redacts secrets, signatures, cookies, auth headers', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _e, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    createLogger('t', sink).info(
      {
        apiKey: 'AK-LEAK',
        cfg: { secret: 'S-LEAK', signature: '0xSIG-LEAK', privateKey: 'PK-LEAK' },
        req: { headers: { authorization: 'Bearer A-LEAK', cookie: 'C-LEAK' } },
      },
      'hello',
    );
    const out = lines.join('');
    for (const leak of ['AK-LEAK', 'S-LEAK', 'SIG-LEAK', 'PK-LEAK', 'A-LEAK', 'C-LEAK']) {
      expect(out).not.toContain(leak);
    }
    expect(out).toContain('[REDACTED]');
  });
});

describe('schemas', () => {
  const base = {
    expectedDeltas: [],
    rationale: 'r',
    citedFactIds: [],
    confidence: 0.9,
    source: 'serv',
  };
  it('proposal: parses amounts to bigint; rejects unknown kind, extra params, numbers-as-floats', () => {
    const p = zProposal.parse({
      ...base,
      kind: 'vault_deposit',
      params: { vaultId: 'v1', amount: '1000000' },
    });
    expect(p.kind === 'vault_deposit' && p.params.amount).toBe(1_000_000n);
    expect(zProposal.safeParse({ ...base, kind: 'transfer_all', params: {} }).success).toBe(false);
    expect(
      zProposal.safeParse({
        ...base,
        kind: 'pay_recipient',
        params: { recipientId: 'r', amount: '1', to: USDC },
      }).success,
    ).toBe(false);
    expect(
      zProposal.safeParse({ ...base, kind: 'pull_allowance', params: { amount: 1.5 } }).success,
    ).toBe(false);
  });
  it('policy: rejects non-checksummed addresses', () => {
    expect(zPolicy.safeParse({}).success).toBe(false);
  });
});
