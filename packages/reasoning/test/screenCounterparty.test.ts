import { describe, expect, it } from 'vitest';
import { FixtureServClient, screenCounterparty } from '../src/index';

const MODEL = 'gpt-5.4-mini';
const base = {
  model: MODEL,
  label: 'Alex (contractor)',
  address: '0x1111111111111111111111111111111111111111',
  chainId: 5042002,
  signals: ['on the allowlist since 2026-01-01'],
} as const;

describe('screenCounterparty', () => {
  it('returns the tier and reasons the model gives', async () => {
    const client = new FixtureServClient([], {
      counterparty: '{"tier":"medium","reasons":["unusual recent activity pattern"]}',
    });
    const r = await screenCounterparty({ ...base, client });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tier).toBe('medium');
      expect(r.reasons).toEqual(['unusual recent activity pattern']);
    }
  });

  it('is ok:false (no verdict), never a guessed tier, when SERV is unavailable', async () => {
    const r = await screenCounterparty({ ...base, client: new FixtureServClient() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('SERV_ERROR');
  });

  it('is ok:false rather than inventing a tier on a malformed answer', async () => {
    const client = new FixtureServClient([], { counterparty: 'not json' });
    const r = await screenCounterparty({ ...base, client });
    expect(r.ok).toBe(false);
  });

  it('carries call metadata through on both outcomes', async () => {
    const ok = await screenCounterparty({
      ...base,
      client: new FixtureServClient([], { counterparty: '{"tier":"low","reasons":[]}' }),
    });
    expect(ok.meta?.requestIds).toHaveLength(1);
    const failed = await screenCounterparty({ ...base, client: new FixtureServClient() });
    expect(failed.meta).toBeDefined();
  });
});
