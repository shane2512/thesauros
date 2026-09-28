// Canonical JSON: sorted keys, no whitespace, bigint as decimal string, Date as ISO. Shared by proposal
// hashes, receipts and the audit hash chain. undefined-valued keys are dropped (as JSON.stringify does).
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

function norm(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('canonical: non-finite number');
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => norm(x ?? null));
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = norm(x);
    }
    return out;
  }
  return v;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(norm(value));
}

/** sha256 of canonical JSON, 0x-prefixed lowercase hex. */
export function hashCanonical(value: unknown): `0x${string}` {
  return `0x${bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value))))}`;
}
