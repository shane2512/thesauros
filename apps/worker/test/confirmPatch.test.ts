import { describe, expect, it } from 'vitest';
import { confirmPatch } from '../src/jobs/confirm';

const now = new Date('2026-10-06T00:00:00Z');
const txHash = `0x${'ab'.repeat(32)}` as const;

describe('confirmPatch', () => {
  it('marks a landed transaction confirmed with its hash and time', () => {
    expect(confirmPatch({ ok: true, value: { status: 'confirmed', txHash } }, now)).toEqual({
      status: 'confirmed',
      txHash,
      confirmedAt: now,
    });
  });

  it('marks a reverted transaction failed and keeps the reason and hash', () => {
    expect(
      confirmPatch({ ok: true, value: { status: 'failed', reason: 'reverted', txHash } }, now),
    ).toEqual({ status: 'failed', error: 'reverted', txHash });
  });

  it('marks a failure with no hash failed without inventing one', () => {
    expect(confirmPatch({ ok: true, value: { status: 'failed' } }, now)).toEqual({
      status: 'failed',
      error: 'the transaction did not confirm on chain',
    });
  });

  it('records a confirmer error as timeout so the row is not left submitted', () => {
    expect(confirmPatch({ ok: false, error: 'rpc down' }, now)).toEqual({
      status: 'timeout',
      error: 'rpc down',
    });
  });
});
