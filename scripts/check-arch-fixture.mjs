// Proves dependency-cruiser actually fails on a boundary violation (Phase 1 task 1.3).
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const cwd = fileURLToPath(new URL('./fixtures/arch', import.meta.url));
const config = fileURLToPath(new URL('../.dependency-cruiser.cjs', import.meta.url));
const bin = fileURLToPath(
  new URL('../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs', import.meta.url),
);
// `apps` is cruised too since 7.8: the owner-path rule covers API routes, and the fixture under
// apps/web/app/api/freeze proves a route importing reasoning is caught, not just `sweepHome`.
const r = spawnSync(process.execPath, [bin, 'packages', 'apps', '--config', config, '--no-cache'], {
  cwd,
  encoding: 'utf8',
});
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
const expected = [
  'policy-only-shared',
  'reasoning-no-wallet-db',
  'owner-path-no-reasoning',
  'cdp-only-in-wallet-bootstrap',
];
const missing = expected.filter((rule) => !r.stdout.includes(rule));
if (r.status === 0 || missing.length > 0) {
  console.error(`FAIL: dependency-cruiser did NOT flag: ${missing.join(', ') || '(exit 0)'}`);
  process.exit(1);
}
console.log(`OK: violations detected (${expected.join(', ')}; depcruise exit ${r.status})`);
