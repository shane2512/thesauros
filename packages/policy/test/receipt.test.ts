// AllowReceipts: signing, verification, every tamper case, and the constant-time compare.
import { describe, expect, it } from 'vitest';
import { canonicalJson, type AllowReceipt, type Verdict } from '@thesauros/shared';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { constantTimeEqual, signReceipt, verifyReceipt } from '../src/receipt';
import { evaluate } from '../src/evaluate';
import { hashProposal } from '../src/hash';
import { HASH_ZERO, NOW, input, payProposal, usdc, withdrawProposal } from './fixtures';

const KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(8);
const NONCE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const allowVerdict = (): Verdict => evaluate(input());
const sign = (over: Parameters<typeof signReceipt>[4] = {}) =>
  signReceipt(allowVerdict(), KEY, NOW, NONCE, over);

/** Re-MACs a receipt body with the real key, to build receipts `signReceipt` would never issue. */
const forge = (r: AllowReceipt): AllowReceipt => {
  const body = {
    proposalHash: r.proposalHash,
    policyVersion: r.policyVersion,
    walletId: r.walletId,
    nonce: r.nonce,
    issuedAt: r.issuedAt,
    expiresAt: r.expiresAt,
    callsHash: r.callsHash,
  };
  return { ...r, mac: `0x${bytesToHex(hmac(sha256, KEY, utf8ToBytes(canonicalJson(body))))}` };
};

const unwrap = (r: ReturnType<typeof signReceipt>): AllowReceipt => {
  if (!r.ok) throw new Error(`expected a receipt, got ${r.error.code}`);
  return r.value;
};

describe('signReceipt', () => {
  it('signs an ALLOW verdict', () => {
    const receipt = unwrap(sign());
    expect(receipt.proposalHash).toBe(hashProposal(payProposal()));
    expect(receipt.policyVersion).toBe(3);
    expect(receipt.walletId).toBe('wallet-1');
    expect(receipt.nonce).toBe(NONCE);
    expect(receipt.issuedAt).toBe(NOW.toISOString());
    expect(receipt.expiresAt).toBe(new Date(NOW.getTime() + 120_000).toISOString());
    expect(receipt.mac).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('refuses to sign anything but an ALLOW (I5)', () => {
    const escalate = evaluate(input({ proposal: withdrawProposal(usdc(20_000)) }));
    const r = signReceipt(escalate, KEY, NOW, NONCE);
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_ALLOW' } });
  });

  it('refuses a weak key', () => {
    const r = signReceipt(allowVerdict(), new Uint8Array(16), NOW, NONCE);
    expect(r).toMatchObject({ ok: false, error: { code: 'WEAK_KEY' } });
  });

  it.each([0, -1, 121, 1.5])('refuses a ttl of %s seconds', (ttlSeconds) => {
    expect(sign({ ttlSeconds })).toMatchObject({ ok: false, error: { code: 'TTL_TOO_LONG' } });
  });

  it('accepts a shorter ttl', () => {
    const receipt = unwrap(sign({ ttlSeconds: 30 }));
    expect(receipt.expiresAt).toBe(new Date(NOW.getTime() + 30_000).toISOString());
  });

  it('refuses to sign a malformed verdict', () => {
    const broken = { ...allowVerdict(), nonce: NONCE, walletId: '' };
    expect(signReceipt(broken, KEY, NOW, NONCE)).toMatchObject({
      ok: false,
      error: { code: 'MALFORMED' },
    });
  });

  it('binds the receipt to the exact calls when asked', () => {
    const callsHash = `0x${'ab'.repeat(32)}` as const;
    const receipt = unwrap(sign({ callsHash }));
    expect(receipt.callsHash).toBe(callsHash);
    // A receipt with a callsHash does not verify against different calls.
    expect(
      verifyReceipt(
        receipt,
        { proposalHash: receipt.proposalHash, callsHash: HASH_ZERO },
        KEY,
        NOW,
      ),
    ).toMatchObject({ ok: false, error: { code: 'CALLS_MISMATCH' } });
  });

  it('is deterministic: the same inputs produce the same MAC', () => {
    expect(unwrap(sign()).mac).toBe(unwrap(sign()).mac);
  });
});

describe('verifyReceipt', () => {
  const expected = () => ({
    proposalHash: hashProposal(payProposal()),
    policyVersion: 3,
    walletId: 'wallet-1',
  });

  it('accepts a fresh, untampered receipt', () => {
    expect(verifyReceipt(unwrap(sign()), expected(), KEY, NOW)).toEqual({ ok: true, value: true });
  });

  it('accepts it right up to the expiry instant', () => {
    const receipt = unwrap(sign());
    const atExpiry = new Date(Date.parse(receipt.expiresAt));
    expect(verifyReceipt(receipt, expected(), KEY, atExpiry).ok).toBe(true);
    expect(verifyReceipt(receipt, expected(), KEY, new Date(atExpiry.getTime() + 1))).toMatchObject(
      { ok: false, error: { code: 'EXPIRED' } },
    );
  });

  it('refuses a receipt from the future', () => {
    const receipt = unwrap(sign());
    const r = verifyReceipt(receipt, expected(), KEY, new Date(NOW.getTime() - 1));
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_YET_VALID' } });
  });

  it('refuses a different secret', () => {
    expect(verifyReceipt(unwrap(sign()), expected(), OTHER_KEY, NOW)).toMatchObject({
      ok: false,
      error: { code: 'BAD_MAC' },
    });
  });

  it('refuses a weak key', () => {
    expect(verifyReceipt(unwrap(sign()), expected(), new Uint8Array(8), NOW)).toMatchObject({
      ok: false,
      error: { code: 'WEAK_KEY' },
    });
  });

  it('refuses a receipt for another proposal', () => {
    expect(
      verifyReceipt(unwrap(sign()), { ...expected(), proposalHash: HASH_ZERO }, KEY, NOW),
    ).toMatchObject({ ok: false, error: { code: 'PROPOSAL_MISMATCH' } });
  });

  it('refuses a receipt from a superseded policy version', () => {
    expect(
      verifyReceipt(unwrap(sign()), { ...expected(), policyVersion: 4 }, KEY, NOW),
    ).toMatchObject({ ok: false, error: { code: 'POLICY_VERSION_MISMATCH' } });
  });

  it('refuses a receipt issued for another wallet', () => {
    expect(
      verifyReceipt(unwrap(sign()), { ...expected(), walletId: 'wallet-2' }, KEY, NOW),
    ).toMatchObject({ ok: false, error: { code: 'WALLET_MISMATCH' } });
  });

  it('refuses a receipt that does not parse', () => {
    expect(verifyReceipt({ nope: true }, expected(), KEY, NOW)).toMatchObject({
      ok: false,
      error: { code: 'MALFORMED' },
    });
  });

  // These two refusals need a receipt this engine would never issue, so the test forges the MAC
  // with the same key: they prove the checks are real and not a side effect of how we sign.
  it('refuses timestamps that are not ISO dates', () => {
    const forged = forge({ ...unwrap(sign()), issuedAt: 'yesterday', expiresAt: 'soon' });
    expect(verifyReceipt(forged, expected(), KEY, NOW)).toMatchObject({
      ok: false,
      error: { code: 'MALFORMED' },
    });
  });

  it('refuses a lifetime longer than the system ceiling', () => {
    const receipt = unwrap(sign());
    const forged = forge({
      ...receipt,
      expiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
    });
    expect(verifyReceipt(forged, expected(), KEY, NOW)).toMatchObject({
      ok: false,
      error: { code: 'TTL_TOO_LONG' },
    });
  });

  // P6: tampering ANY field must fail.
  const tampering: [string, (r: AllowReceipt) => AllowReceipt][] = [
    ['proposalHash', (r) => ({ ...r, proposalHash: HASH_ZERO })],
    ['policyVersion', (r) => ({ ...r, policyVersion: r.policyVersion + 1 })],
    ['walletId', (r) => ({ ...r, walletId: 'wallet-evil' })],
    ['nonce', (r) => ({ ...r, nonce: '00000000-0000-4000-8000-000000000000' })],
    ['issuedAt', (r) => ({ ...r, issuedAt: new Date(NOW.getTime() - 1_000).toISOString() })],
    ['expiresAt', (r) => ({ ...r, expiresAt: new Date(NOW.getTime() + 119_000).toISOString() })],
    ['callsHash', (r) => ({ ...r, callsHash: HASH_ZERO })],
    ['mac', (r) => ({ ...r, mac: `0x${'0'.repeat(64)}` })],
  ];

  it.each(tampering)('refuses a receipt with a tampered %s', (_field, tamper) => {
    const receipt = tamper(unwrap(sign()));
    const r = verifyReceipt(receipt, { proposalHash: hashProposal(payProposal()) }, KEY, NOW);
    expect(r.ok).toBe(false);
  });

  it('notices tampering that keeps the canonical JSON the same length', () => {
    const receipt = unwrap(sign());
    const swapped = { ...receipt, walletId: 'wallet-2' };
    expect(canonicalJson(swapped).length).toBe(canonicalJson(receipt).length);
    expect(verifyReceipt(swapped, { proposalHash: receipt.proposalHash }, KEY, NOW).ok).toBe(false);
  });
});

describe('constantTimeEqual', () => {
  it('is true only for identical strings', () => {
    expect(constantTimeEqual('0xabc', '0xabc')).toBe(true);
    expect(constantTimeEqual('0xabc', '0xabd')).toBe(false);
    expect(constantTimeEqual('0xabc', '0xabcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
    expect(constantTimeEqual('', '0x')).toBe(false);
  });
});
