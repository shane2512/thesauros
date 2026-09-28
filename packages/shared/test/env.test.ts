import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseEnv, Secret } from '../src/env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5433/thesauros',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('env', () => {
  it('parses minimal valid env with defaults', () => {
    const r = parseEnv(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.CHAIN_ID).toBe(84532);
      expect(r.value.DEMO_MODE).toBe(false);
      expect(r.value.SESSION_SECRET.reveal()).toBe('x'.repeat(32));
    }
  });

  it('fails on missing/short/invalid vars', () => {
    expect(parseEnv({}).ok).toBe(false);
    expect(parseEnv({ ...base, SESSION_SECRET: 'short' }).ok).toBe(false);
    expect(parseEnv({ ...base, DATABASE_URL: 'nope' }).ok).toBe(false);
    expect(parseEnv({ ...base, CHAIN_ID: '1' }).ok).toBe(false);
  });

  it('I8: refuses mainnet without the flag; allows with it', () => {
    expect(parseEnv({ ...base, CHAIN_ID: '8453' }).ok).toBe(false);
    expect(parseEnv({ ...base, CHAIN_ID: '8453', THESAUROS_ALLOW_MAINNET: 'true' }).ok).toBe(true);
  });

  it('I11: DEMO_MODE only on 84532', () => {
    expect(parseEnv({ ...base, DEMO_MODE: 'true' }).ok).toBe(true);
    expect(
      parseEnv({ ...base, DEMO_MODE: 'true', CHAIN_ID: '8453', THESAUROS_ALLOW_MAINNET: 'true' }).ok,
    ).toBe(false);
  });

  it('treats empty strings as unset', () => {
    expect(parseEnv({ ...base, SERV_API_KEY: '', CHAIN_ID: '' }).ok).toBe(true);
  });

  it('Secret never leaks through string/JSON/inspect', () => {
    const s = new Secret('super-secret-value');
    for (const out of [String(s), `${s}`, JSON.stringify({ s }), inspect(s), inspect({ s })]) {
      expect(out).not.toContain('super-secret-value');
      expect(out).toContain('[REDACTED]');
    }
  });

  it('error messages do not echo secret values', () => {
    const r = parseEnv({ ...base, SESSION_SECRET: 'tooshort-secret' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain('tooshort-secret');
  });
});
