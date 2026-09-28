// Proves the packages/policy purity lint rules actually fire (I2, Phase 3).
// The fixture lives under scripts/fixtures/lint/packages/policy/src so the eslint `files` pattern
// matches it; `--no-ignore` is needed because scripts/fixtures/** is ignored by the normal lint run.
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const file = fileURLToPath(
  new URL('./fixtures/lint/packages/policy/src/impure.ts', import.meta.url),
);
const bin = fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url));
const r = spawnSync(process.execPath, [bin, '--no-ignore', '--format', 'json', file], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  encoding: 'utf8',
});

const messages = JSON.parse(r.stdout || '[]').flatMap((f) => f.messages);
const rules = new Set(messages.map((m) => m.ruleId));
const required = ['no-restricted-syntax', 'no-restricted-globals'];
const missing = required.filter((rule) => !rules.has(rule));

if (r.status === 0 || missing.length > 0) {
  console.error(r.stdout, r.stderr);
  console.error(`FAIL: eslint did not flag the deliberate purity violations (missing: ${missing})`);
  process.exit(1);
}
const counts = {};
for (const m of messages) counts[m.ruleId] = (counts[m.ruleId] ?? 0) + 1;
console.log(`OK: purity violations detected (${messages.length} problems)`, counts);
