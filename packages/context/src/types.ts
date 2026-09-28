import type { ProposalKind } from '@thesauros/shared';

/**
 * Everything the decision loop gathers before reasoning starts. Phase 6 fills this from db / wallet
 * read models / risk; `buildContext` is a pure function of it, so the whole context layer is
 * testable without a database, an RPC or a clock.
 *
 * Money is bigint base units (I12). No addresses appear anywhere in this type by design (I4): the
 * model only ever sees ids.
 */
export type ContextInput = {
  now: Date;
  /** Token decimals for the display formatting of every USDC amount below. */
  decimals: number;
  /** `renderPolicyAsSentences(policy)` — passed in so `packages/context` stays dependency-free. */
  policySummary: readonly string[];
  /** Kinds the proposer is allowed to choose from this iteration. */
  allowedKinds: readonly ProposalKind[];
  balances: {
    treasuryUsdc: bigint;
    agentUsdc: bigint;
    allowanceRemaining: bigint;
    allowancePeriodEnds?: Date;
  };
  vaults: readonly {
    id: string;
    /** Third-party string: sanitized before it reaches a prompt (vault-name injection). */
    name: string;
    /** Asset-denominated position of the agent wallet, base units. */
    positionBaseUnits: bigint;
    /** Display-only, e.g. "4.10"; `source` says where it came from. */
    apyPct?: string;
    apySource?: string;
    flagged?: boolean;
  }[];
  recipients: readonly {
    id: string;
    /** Owner-authored, but sanitized anyway — it is rendered into a prompt. */
    label: string;
    scheduleDayOfMonth?: number;
  }[];
  /** Obligations due in the next 30 days. */
  obligations: readonly {
    id: string;
    recipientId: string;
    dueDate: Date;
    amountBaseUnits: bigint;
  }[];
  priceUsdc: { microUsd: bigint; publishedAt: Date };
  outflowsLast24hBaseUnits: bigint;
  riskTriggers: readonly { vaultId: string; trigger: string; observed: string }[];
  /** Anything written by someone who is not the owner. Always sanitized and fenced. */
  untrusted: readonly { id: string; source: string; text: string }[];
};

/**
 * A fact the model may cite. `baseUnits` is deliberately NOT part of the prompt payload (the prompt
 * builder's allowlist drops it); it exists so the deterministic grounding check can compare a
 * proposal's numeric params against the facts it claims to be based on.
 */
export type Fact = {
  id: string;
  value: string;
  unit?: string;
  source?: string;
  ageSec?: number;
  periodEnds?: string;
  items?: string[];
  baseUnits?: bigint;
};

export type UntrustedItem = {
  id: string;
  source: string;
  text: string;
  /** What the sanitizer had to remove — evidence for the screen. */
  signals: string[];
};

export type Context = {
  snapshotHash: `0x${string}`;
  now: string;
  facts: Fact[];
  policySummary: string[];
  allowedKinds: ProposalKind[];
  vaults: { id: string; name: string }[];
  recipients: { id: string; label: string }[];
  untrusted: UntrustedItem[];
  screen: { injectionSuspected: boolean; signals: string[] };
};
