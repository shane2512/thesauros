// EvaluationInput per POLICY_ENGINE.md §4 — everything the pure engine is allowed to know.
// There is no clock, no RPC and no env in `packages/policy` (I2): whatever the rules need is here.
import { z } from 'zod';
import { zAddress, zChainId, zHash, zAmount, zSignedAmount } from './primitives';
import { zPolicy } from './policy';
import { zProposal } from './proposal';

export const zDelta = z.object({
  token: zAddress,
  holder: z.enum(['agent', 'treasury', 'recipient']),
  delta: zSignedAmount,
});
export type Delta = z.infer<typeof zDelta>;

export const zRiskTrigger = z.object({
  vaultId: z.string().min(1),
  trigger: z.enum(['vault_drawdown', 'asset_depeg']),
  observed: z.string(),
});
export type RiskTrigger = z.infer<typeof zRiskTrigger>;

export const zPriceQuote = z.object({ microUsd: zAmount, publishedAt: z.date() });
export type PriceQuote = z.infer<typeof zPriceQuote>;

/** An ERC-20 approval observed in the simulated calls (R18 / T5). */
export const zSimulatedApproval = z.object({
  token: zAddress,
  spender: zAddress,
  amount: zAmount,
});
export type SimulatedApproval = z.infer<typeof zSimulatedApproval>;

export const zEvaluationInput = z.object({
  policy: zPolicy,
  proposal: zProposal,
  /** Injected clock (I2). */
  now: z.date(),
  /** The chain the executor would actually use; must equal `policy.chainId` (R21). */
  chainId: zChainId,
  /** I8: mainnet needs an explicit flag from the caller. Defaults to refusing mainnet. */
  allowMainnet: z.boolean().default(false),
  /**
   * I11 demo fallback: assume $1.00 for a policy token that has no oracle quote. Honoured only on
   * Base Sepolia, and never used to override a quote that exists.
   */
  demoStableParity: z.boolean().default(false),
  state: z.object({
    frozen: z.boolean(),
    breakerOpen: z.boolean(),
    agentUsdc: zAmount,
    treasuryUsdc: zAmount,
    allowanceRemaining: zAmount,
    /** Asset-denominated position per policy vault id. */
    vaultPositions: z.record(z.string(), zAmount),
    prices: z.record(z.string(), zPriceQuote),
    contractHasCode: z.record(z.string(), z.boolean()),
    riskTriggers: z.array(zRiskTrigger),
  }),
  ledger: z.object({
    outflowsLast24hMicroUsd: zAmount,
    actionsLastHour: z.number().int().nonnegative(),
    recentProposalHashes: z.array(zHash),
  }),
  simulation: z
    .object({
      ok: z.boolean(),
      deltas: z.array(zDelta),
      approvals: z.array(zSimulatedApproval).default([]),
      error: z.string().optional(),
    })
    .nullable(),
  verifier: z
    .object({ verdict: z.enum(['AGREE', 'DISAGREE', 'UNSURE']), reasons: z.array(z.string()) })
    .nullable(),
  screen: z.object({ injectionSuspected: z.boolean(), signals: z.array(z.string()) }),
  contextFactIds: z.array(z.string()),
  ownerApproval: z
    .object({ signer: zAddress, proposalHash: zHash, expiresAt: z.date() })
    .nullable(),
});

/**
 * What callers build and what the rules see. Money is `bigint`, clocks are `Date`, addresses are
 * checksummed. The schema still accepts decimal strings at a JSON boundary (`zEvaluationInput.parse`
 * normalises them), but the TypeScript surface is the strict one so nothing sloppy compiles.
 */
export type EvaluationInput = z.infer<typeof zEvaluationInput>;
export type ParsedEvaluationInput = EvaluationInput;
