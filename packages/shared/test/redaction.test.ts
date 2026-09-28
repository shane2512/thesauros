// 8.3 / SECURITY §6 / I9 — secrets never appear in a log line or a serialized object.
//
// `packages/wallet/test/secrets.test.ts` already proves this for the CDP credentials inside that
// package. This suite is the whole-env version: every secret in `parseEnv`'s schema, plus the
// secret-shaped keys this codebase actually builds (the AgentKit config object, a session cookie,
// the DATABASE_URL's password), logged through the real logger and asserted absent from the bytes
// that reach the sink.
//
// Each fake value is a distinct, high-entropy string, so a leak cannot hide behind another one's
// assertion.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/canonical';
import { createLogger, REDACT_PATHS } from '../src/logger';
import { parseEnv, Secret } from '../src/env';

const FAKE = {
  session: 'SESSION-3f9c1a7e4b2d8065-aaaaaaaaaaaaaaaa',
  hmac: 'HMAC-8172635445362718-bbbbbbbbbbbbbbbb',
  cdpApiKey: 'CDPKEY-5a4b3c2d1e0f9887-cccccccccccccccc',
  cdpWallet: 'CDPWALLET-9182736455647382-dddddddddddddddd',
  serv: 'sk-serv-0a1b2c3d4e5f6071-eeeeeeeeeeeeeeee',
  dbPassword: 'DBPASS-1a2b3c4d5e6f7080-ffffffffffffffff',
};
const ALL = Object.values(FAKE);

const env = () => ({
  DATABASE_URL: `postgres://thesauros:${FAKE.dbPassword}@localhost:5433/thesauros`,
  SESSION_SECRET: FAKE.session,
  RECEIPT_HMAC_SECRET: FAKE.hmac,
  CDP_API_KEY_ID: 'not-a-secret-id',
  CDP_API_KEY_SECRET: FAKE.cdpApiKey,
  CDP_WALLET_SECRET: FAKE.cdpWallet,
  SERV_API_KEY: FAKE.serv,
});

/** Capture everything the logger writes, as raw bytes-as-text. */
function captured(fn: (log: ReturnType<typeof createLogger>) => void): string {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  fn(createLogger('redaction-test', sink));
  return chunks.join('');
}

describe('parseEnv wraps every secret', () => {
  it('returns each secret as a Secret, never a bare string', () => {
    const parsed = parseEnv(env());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const key of [
      'SESSION_SECRET',
      'RECEIPT_HMAC_SECRET',
      'CDP_API_KEY_SECRET',
      'CDP_WALLET_SECRET',
      'SERV_API_KEY',
    ] as const) {
      expect(parsed.value[key], key).toBeInstanceOf(Secret);
    }
  });

  it('serializing the whole parsed env leaks nothing but the DB password', () => {
    const parsed = parseEnv(env());
    if (!parsed.ok) throw new Error('env should parse');
    const asJson = JSON.stringify(parsed.value);
    for (const v of [FAKE.session, FAKE.hmac, FAKE.cdpApiKey, FAKE.cdpWallet, FAKE.serv])
      expect(asJson).not.toContain(v);
    expect(canonicalJson(parsed.value)).not.toContain(FAKE.serv);
    // DATABASE_URL is deliberately NOT a Secret (every createDb call needs the raw string), so its
    // password survives `JSON.stringify`. The logger is what must never emit it — see below (D-103).
    expect(asJson).toContain(FAKE.dbPassword);
  });
});

describe('static: the Secret wrapper is the only way in (8.3)', () => {
  // Every secret must reach the app through `parseEnv`/`getEnv`, so that what the app holds is a
  // `Secret` and `.reveal()` marks the single point of use. A raw `process.env` read of a secret
  // anywhere under apps/ or packages/ defeats that, so this fails the build.
  //
  // `scripts/live/*` is excluded on purpose: those are manual, THESAUROS_LIVE-gated developer scripts
  // that are never deployed, and each reads its one credential straight into the SDK config that
  // needs it (recorded in PROGRESS as part of the 8.3 audit).
  const SECRET_ENV_NAMES = [
    'SESSION_SECRET',
    'RECEIPT_HMAC_SECRET',
    'CDP_API_KEY_SECRET',
    'CDP_WALLET_SECRET',
    'SERV_API_KEY',
  ];

  it('no file under apps/ or packages/ reads a secret env var directly', () => {
    const root = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.next') continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        const text = readFileSync(full, 'utf8');
        for (const name of SECRET_ENV_NAMES) {
          // A direct env read: `process.env.X` or `process.env['X']`. Mentioning the name in a
          // string, a comment or a zod schema key is fine — the schema is how it is meant to arrive.
          const direct = new RegExp(`process\\.env(?:\\.${name}\\b|\\[\\s*['"\`]${name}['"\`])`);
          if (direct.test(text)) offenders.push(`${full}: ${name}`);
        }
      }
    };
    for (const pkg of ['apps', 'packages']) walk(join(root, pkg));
    expect(offenders).toEqual([]);
  });
});

describe('the logger redacts', () => {
  it('a Secret logged directly, at the top level and nested', () => {
    const parsed = parseEnv(env());
    if (!parsed.ok) throw new Error('env should parse');
    const out = captured((log) => {
      log.info({ env: parsed.value }, 'boot');
      log.error({ servKey: parsed.value.SERV_API_KEY }, 'serv failed');
    });
    for (const v of [FAKE.session, FAKE.hmac, FAKE.cdpApiKey, FAKE.cdpWallet, FAKE.serv])
      expect(out).not.toContain(v);
    // A Secret redacts itself, so the line is still written — just with [REDACTED] in it.
    expect(out).toContain('[REDACTED]');
  });

  it('the raw strings, by key name, even when the Secret wrapper was stripped first', () => {
    // The realistic accident: someone logs the object they built for the CDP SDK, or a request's
    // headers, after having already called `.reveal()`.
    const out = captured((log) => {
      log.info(
        {
          apiKeyId: 'not-a-secret-id',
          apiKeySecret: FAKE.cdpApiKey,
          walletSecret: FAKE.cdpWallet,
          sessionSecret: FAKE.session,
          apiKey: FAKE.serv,
          receiptKey: new Uint8Array(32).fill(9),
        },
        'agentkit config',
      );
      log.info({ DATABASE_URL: env().DATABASE_URL }, 'connecting');
      log.info({ req: { headers: { cookie: `thesauros_session=${FAKE.session}` } } }, 'request');
      log.info({ password: FAKE.dbPassword, secret: FAKE.hmac }, 'nested');
    });
    for (const v of ALL) expect(out, `leaked ${v}`).not.toContain(v);
    expect(out).toContain('[REDACTED]');
    // The non-secret half of the same object still gets logged, or the log line is useless.
    expect(out).toContain('not-a-secret-id');
  });

  it('every key it claims to redact really is redacted', () => {
    // Guards the list itself: add a key to REDACT_PATHS and this proves pino honours it.
    const marker = 'LEAK-CANARY-7766554433221100';
    for (const path of REDACT_PATHS) {
      if (path.includes('*') || path.includes('.')) continue;
      const out = captured((log) => log.info({ [path]: marker }, 'probe'));
      expect(out, `pino did not redact top-level "${path}"`).not.toContain(marker);
      const nested = captured((log) => log.info({ outer: { [path]: marker } }, 'probe'));
      expect(nested, `pino did not redact "*.${path}"`).not.toContain(marker);
    }
  });

  it('does not redact `token`, which in Thesauros is a public ERC-20 address', () => {
    const usdc = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
    expect(captured((log) => log.info({ token: usdc }, 'execution'))).toContain(usdc);
  });
});
