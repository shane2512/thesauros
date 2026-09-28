// Task 3.6 — AllowReceipts (POLICY_ENGINE §7). The Policy Engine is the only issuer; the executor
// refuses to send anything without one that verifies.
//
// HMAC-SHA256 over the canonical JSON of every field except the MAC itself, via @noble/hashes.
// Comparison is constant-time so a wrong MAC leaks nothing through timing.
import {
  SYSTEM_CEILINGS,
  canonicalJson,
  err,
  ok,
  zAllowReceipt,
  type AllowReceipt,
  type Hex,
  type Result,
  type Verdict,
} from '@thesauros/shared';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export type ReceiptErrorCode =
  | 'NOT_ALLOW'
  | 'WEAK_KEY'
  | 'MALFORMED'
  | 'BAD_MAC'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'TTL_TOO_LONG'
  | 'PROPOSAL_MISMATCH'
  | 'POLICY_VERSION_MISMATCH'
  | 'WALLET_MISMATCH'
  | 'CALLS_MISMATCH';
export type ReceiptError = { code: ReceiptErrorCode; message: string };

/** HMAC keys shorter than 32 bytes are refused: the receipt is the executor's only gate. */
const MIN_KEY_BYTES = 32;

export type SignReceiptOptions = {
  /** Hash of the exact `Call[]` this receipt authorises (`callsHash` from `@thesauros/wallet`). */
  callsHash?: Hex;
  /** Receipt lifetime; defaults to the system ceiling and may never exceed it. */
  ttlSeconds?: number;
};

const body = (r: AllowReceipt) => ({
  proposalHash: r.proposalHash,
  policyVersion: r.policyVersion,
  walletId: r.walletId,
  nonce: r.nonce,
  issuedAt: r.issuedAt,
  expiresAt: r.expiresAt,
  callsHash: r.callsHash,
});

function mac(receipt: AllowReceipt, key: Uint8Array): Hex {
  return `0x${bytesToHex(hmac(sha256, key, utf8ToBytes(canonicalJson(body(receipt)))))}`;
}

/**
 * Constant-time string comparison. Both sides are hashed first (the standard digest-compare
 * trick), so the loop always runs over 32 bytes: neither the content nor the LENGTH of a MAC
 * changes how long this takes, and there is no early return to time.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = sha256(utf8ToBytes(a));
  const hb = sha256(utf8ToBytes(b));
  const va = new DataView(ha.buffer, ha.byteOffset, ha.byteLength);
  const vb = new DataView(hb.buffer, hb.byteOffset, hb.byteLength);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= va.getUint8(i) ^ vb.getUint8(i);
  return diff === 0;
}

/**
 * Issue a receipt for an ALLOW verdict. Nonce and clock are supplied by the caller — the engine
 * has neither randomness nor a clock (I2). The nonce is made single-use by a unique DB insert in
 * Phase 5 (I10).
 */
export function signReceipt(
  verdict: Verdict,
  key: Uint8Array,
  now: Date,
  nonce: string,
  options: SignReceiptOptions = {},
): Result<AllowReceipt, ReceiptError> {
  if (verdict.decision !== 'ALLOW')
    return err({ code: 'NOT_ALLOW', message: `cannot sign a ${verdict.decision} verdict` });
  if (key.length < MIN_KEY_BYTES)
    return err({ code: 'WEAK_KEY', message: `receipt key must be >= ${MIN_KEY_BYTES} bytes` });

  const ttl = options.ttlSeconds ?? SYSTEM_CEILINGS.RECEIPT_TTL_SEC;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > SYSTEM_CEILINGS.RECEIPT_TTL_SEC)
    return err({
      code: 'TTL_TOO_LONG',
      message: `ttl must be 1..${SYSTEM_CEILINGS.RECEIPT_TTL_SEC}s`,
    });

  const draft: AllowReceipt = {
    proposalHash: verdict.proposalHash,
    policyVersion: verdict.policyVersion,
    walletId: verdict.walletId,
    nonce,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    ...(options.callsHash === undefined ? {} : { callsHash: options.callsHash }),
    mac: '0x',
  };
  const parsed = zAllowReceipt.safeParse(draft);
  if (!parsed.success)
    return err({
      code: 'MALFORMED',
      message: `cannot sign: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    });
  return ok({ ...draft, mac: mac(draft, key) });
}

export type ReceiptExpectation = {
  proposalHash: Hex;
  /** The wallet's ACTIVE policy version. A receipt from an older policy must not execute. */
  policyVersion?: number;
  walletId?: string;
  /** The calls the executor is about to send; required to match when supplied. */
  callsHash?: Hex;
};

/**
 * Verify a receipt against what the executor is actually about to do. Everything is checked:
 * shape, MAC, validity window, and each supplied expectation. Any mismatch is a refusal.
 */
export function verifyReceipt(
  receipt: unknown,
  expected: ReceiptExpectation,
  key: Uint8Array,
  now: Date,
): Result<true, ReceiptError> {
  const parsed = zAllowReceipt.safeParse(receipt);
  if (!parsed.success)
    return err({
      code: 'MALFORMED',
      message: `receipt does not parse: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    });
  const r = parsed.data;

  if (key.length < MIN_KEY_BYTES)
    return err({ code: 'WEAK_KEY', message: `receipt key must be >= ${MIN_KEY_BYTES} bytes` });
  if (!constantTimeEqual(mac(r, key), r.mac))
    return err({ code: 'BAD_MAC', message: 'receipt MAC does not verify' });

  const issued = Date.parse(r.issuedAt);
  const expires = Date.parse(r.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires))
    return err({ code: 'MALFORMED', message: 'receipt timestamps are not ISO dates' });
  if (expires - issued > SYSTEM_CEILINGS.RECEIPT_TTL_SEC * 1000)
    return err({ code: 'TTL_TOO_LONG', message: 'receipt lifetime exceeds the system ceiling' });
  if (now.getTime() < issued)
    return err({ code: 'NOT_YET_VALID', message: 'receipt is issued in the future' });
  if (now.getTime() > expires) return err({ code: 'EXPIRED', message: 'receipt has expired' });

  if (r.proposalHash !== expected.proposalHash)
    return err({ code: 'PROPOSAL_MISMATCH', message: 'receipt is for a different proposal' });
  if (expected.policyVersion !== undefined && r.policyVersion !== expected.policyVersion)
    return err({
      code: 'POLICY_VERSION_MISMATCH',
      message: `receipt is for policy v${r.policyVersion}, active is v${expected.policyVersion}`,
    });
  if (expected.walletId !== undefined && r.walletId !== expected.walletId)
    return err({ code: 'WALLET_MISMATCH', message: 'receipt is for a different wallet' });
  if (expected.callsHash !== undefined && r.callsHash !== expected.callsHash)
    return err({
      code: 'CALLS_MISMATCH',
      message: 'receipt does not authorise these exact calls',
    });
  return ok(true);
}
