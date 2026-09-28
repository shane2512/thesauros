// I9 / SECURITY §6 / Opus review gate Q3 — CDP secrets are never logged or serialized.
// Two complementary checks: a static grep over the package source, and a runtime check that the
// values actually survive only inside `Secret` and never reach a log line, an audit payload or JSON.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { canonicalJson, createLogger, parseEnv, Secret } from '@thesauros/shared';
import { serializeSpendPermission } from '../src/spendPermission';
import { permission } from './fixtures';

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : e.name.endsWith('.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

const files = sourceFiles(SRC).map((f) => ({ path: f, text: readFileSync(f, 'utf8') }));

describe('static: packages/wallet source', () => {
  it('has source files to scan', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never calls .reveal() on a secret outside the AgentKit config object', () => {
    // buildAgentKit takes already-revealed strings from its caller, so no reveal() belongs in here.
    for (const f of files) expect(f.text, f.path).not.toMatch(/\.reveal\(\)/);
  });

  it('never logs, stringifies or hashes a CDP credential', () => {
    const forbidden =
      /(log|console)\.[a-z]+\([^)]*\b(apiKeySecret|walletSecret|apiKeyId|privateKey|CDP_[A-Z_]+)\b/;
    const stringified = /JSON\.stringify\([^)]*\b(apiKeySecret|walletSecret|privateKey)\b/;
    for (const f of files) {
      expect(f.text, f.path).not.toMatch(forbidden);
      expect(f.text, f.path).not.toMatch(stringified);
    }
  });

  it('never reads process.env directly (env goes through the shared zod schema)', () => {
    for (const f of files) expect(f.text, f.path).not.toMatch(/process\.env\[/);
  });

  it('does not import an LLM tool-calling framework (I3)', () => {
    // Only real import/require specifiers — prose in a comment about what we must not import is fine.
    const llmImport =
      /(?:from|import|require\()\s*['"][^'"]*(agentkit-langchain|agentkit-vercel-ai-sdk|@langchain|openai|ai-sdk)/;
    for (const f of files) expect(f.text, f.path).not.toMatch(llmImport);
  });
});

describe('runtime: Secret never leaks', () => {
  const VALUE = 'cdp-super-secret-value-0123456789';

  it('Secret redacts through toString, JSON and canonicalJson', () => {
    const s = new Secret(VALUE);
    expect(String(s)).toBe('[REDACTED]');
    expect(JSON.stringify({ apiKeySecret: s })).not.toContain(VALUE);
    expect(canonicalJson({ walletSecret: s })).not.toContain(VALUE);
  });

  it('the parsed env exposes CDP credentials only as Secret', () => {
    const parsed = parseEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5433/db',
      SESSION_SECRET: 'x'.repeat(32),
      CDP_API_KEY_SECRET: VALUE,
      CDP_WALLET_SECRET: VALUE,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.CDP_API_KEY_SECRET).toBeInstanceOf(Secret);
    expect(JSON.stringify(parsed.value)).not.toContain(VALUE);
    expect(parsed.value.CDP_API_KEY_SECRET?.reveal()).toBe(VALUE);
  });

  it('pino redacts secret-shaped fields that reach a log line', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = createLogger('wallet-test', sink);
    log.info({ apiKey: VALUE, secret: VALUE, signature: '0xsig', cdp: { secret: VALUE } }, 'boot');
    const all = lines.join('');
    expect(all).not.toContain(VALUE);
    expect(all).not.toContain('0xsig');
    expect(all).toContain('[REDACTED]');
  });

  it('a serialized spend permission carries no signature and no secret', () => {
    const json = JSON.stringify(serializeSpendPermission(permission));
    expect(json).not.toMatch(/signature/i);
    expect(json).not.toContain(VALUE);
  });
});
