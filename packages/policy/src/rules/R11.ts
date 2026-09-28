// R11 — simulation parity (SECURITY §3 L4): the simulated balance deltas must match what the
// proposal said it would do. Exact for transfers, ±50 bps for vault share math.
//
// Both directions are checked. A movement the proposal did not declare is a DENY too — that is the
// case where the calldata does something extra nobody asked for (T4).
import { VAULT_KINDS, deny, pass, type Rule } from './kit';
import type { Delta } from '@thesauros/shared';

const VAULT_TOLERANCE_BPS = 50n;

const key = (d: Delta) => `${d.token}|${d.holder}`;
const abs = (v: bigint) => (v < 0n ? -v : v);

function sum(deltas: readonly Delta[]): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const d of deltas) m.set(key(d), (m.get(key(d)) ?? 0n) + d.delta);
  return m;
}

export const R11: Rule = (input) => {
  if (input.proposal.kind === 'noop') return pass('R11', 'noop performs no calls');

  const sim = input.simulation;
  if (!sim) return deny('R11', 'no simulation was supplied');
  if (!sim.ok) return deny('R11', `simulation failed: ${sim.error ?? 'unknown error'}`);

  const tolerance = VAULT_KINDS.includes(input.proposal.kind) ? VAULT_TOLERANCE_BPS : 0n;
  const expected = sum(input.proposal.expectedDeltas);
  const actual = sum(sim.deltas);

  for (const k of new Set([...expected.keys(), ...actual.keys()])) {
    const e = expected.get(k) ?? 0n;
    const a = actual.get(k) ?? 0n;
    if (e === 0n || a === 0n) {
      if (e !== a) return deny('R11', `undeclared balance change on ${k}: expected ${e}, got ${a}`);
      continue;
    }
    if (e < 0n !== a < 0n)
      return deny('R11', `simulated delta on ${k} moves the other way: expected ${e}, got ${a}`);
    if (abs(a - e) * 10_000n > abs(e) * tolerance)
      return deny(
        'R11',
        `simulated delta on ${k} is ${a}, expected ${e} (tolerance ${tolerance} bps)`,
      );
  }
  return pass('R11', `simulation matches all ${expected.size} declared deltas`);
};
