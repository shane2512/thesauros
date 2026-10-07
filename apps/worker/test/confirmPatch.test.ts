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

describe('zConfirmJob', () => {
  it('accepts the payload the pipeline and the boot resume actually enqueue (no providerTxId)', async () => {
    const { zConfirmJob } = await import('../src/jobs/confirm');
    const payload = {
      executionId: '0eee5d74-009a-4a69-a45f-31ab3eb88e42',
      token: '0x3600000000000000000000000000000000000000',
      holders: {
        agent: '0xD277832fE0b169aed51cB0DF826e0bcEa6bd23e2',
        treasury: '0xda4626FcE97748B7A78b613c754419c5e3FDAdCA',
      },
      expectedDeltas: [
        { delta: '-9000000', token: '0x3600000000000000000000000000000000000000', holder: 'agent' },
      ],
    };
    expect(zConfirmJob.safeParse(payload).success).toBe(true);
  });
});
