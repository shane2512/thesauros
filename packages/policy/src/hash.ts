// Task 3.6 (part) — the proposal hash: the idempotency key (I10), the replay key (R17) and the
// value an AllowReceipt is bound to.
import { hashCanonical, type Hex, type Proposal } from '@thesauros/shared';

export const ZERO_HASH = `0x${'0'.repeat(64)}` as const;

/**
 * sha256 over the canonical JSON of the *action* a proposal describes.
 *
 * Deliberately excludes `rationale`, `citedFactIds` and `confidence`: those are the model's prose,
 * and including them would let an attacker replay the identical transfer past R17 by rewording the
 * rationale. `expectedDeltas` IS included — it is the only thing that distinguishes two
 * `sweep_home` proposals, which carry no params at all.
 */
export function hashProposal(p: Proposal): Hex {
  return hashCanonical({
    kind: p.kind,
    params: p.params,
    expectedDeltas: p.expectedDeltas,
    source: p.source,
  });
}

/** Never throws, whatever it is handed (I5). Used on the fail-closed path in `evaluate`. */
export function hashProposalSafe(p: unknown): Hex {
  try {
    return hashProposal(p as Proposal);
  } catch {
    return ZERO_HASH;
  }
}
