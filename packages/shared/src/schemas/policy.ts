// Policy schema per POLICY_ENGINE.md §2. Shape only; the ceilings check lives in
// `packages/policy` (`validatePolicyDraft`), the rules in `packages/policy/src/rules`.
import { z } from 'zod';
import { zAddress, zAmount, zChainId, zHex } from './primitives';
import { zProposalKind } from './proposal';

export const zPolicyToken = z.object({
  symbol: z.literal('USDC'),
  address: zAddress,
  decimals: z.literal(6),
});
export type PolicyToken = z.infer<typeof zPolicyToken>;

/**
 * D-024 — `usyc_teller` added alongside the original `erc4626`: Circle's real USYC on Arc is not a
 * plain ERC-4626 vault. Its Teller contract's `deposit`/`redeem` are ABI-identical to ERC-4626's, so
 * `vault_deposit` and a full-redeem `risk_exit` work unchanged, but it has no `withdraw` (partial,
 * by-asset-amount) and no `convertToAssets`/`maxWithdraw` for position valuation — `address` here is
 * the Teller (where deposit/redeem calls go), never the USYC token itself.
 */
export const zVaultKind = z.enum(['erc4626', 'usyc_teller']);
export type VaultKind = z.infer<typeof zVaultKind>;

export const zPolicyVault = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  address: zAddress,
  asset: zAddress,
  kind: zVaultKind,
  /** Share of managed funds this vault may hold, in basis points (R09). */
  maxAllocationBps: z.number().int().min(0).max(10_000),
});
export type PolicyVault = z.infer<typeof zPolicyVault>;

export const zPolicyRecipient = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  address: zAddress,
  maxPerTxMicroUsd: zAmount,
  schedule: z
    .object({ dayOfMonth: z.number().int().min(1).max(28), amountMicroUsd: zAmount })
    .optional(),
});
export type PolicyRecipient = z.infer<typeof zPolicyRecipient>;

export const zPolicy = z.object({
  version: z.number().int().positive(),
  walletId: z.string().min(1),
  chainId: zChainId,
  /** `sweep_home` destination (owner). Immutable except via an owner-signed policy version. */
  treasuryAddress: zAddress,
  tokens: z.array(zPolicyToken),
  vaults: z.array(zPolicyVault),
  recipients: z.array(zPolicyRecipient),
  limits: z.object({
    perTxMicroUsd: zAmount,
    dailyMicroUsd: zAmount,
    maxActionsPerHour: z.number().int().positive(),
  }),
  runwayBufferMicroUsd: zAmount,
  approvalThresholdMicroUsd: zAmount,
  approvalThresholdByKind: z.partialRecord(zProposalKind, zAmount).optional(),
  depegThresholdBps: z.number().int().min(0).max(10_000),
  vaultDrawdownBps: z.number().int().min(0).max(10_000),
  autonomousKinds: z.array(zProposalKind),
  x402: z.object({ dailyBudgetMicroUsd: zAmount, allowedHosts: z.array(z.string()) }).optional(),
  createdAt: z.string(),
  signedBy: zAddress,
  signature: zHex,
});
export type Policy = z.infer<typeof zPolicy>;

/**
 * A policy before activation: the owner has not signed it yet and onboarding has not assigned the
 * wallet id / version. Mandate templates and `compileMandate` (Phase 4) produce drafts; the Policy
 * Engine only ever evaluates a full, signed `Policy`.
 */
export const zPolicyDraft = zPolicy.partial({
  version: true,
  walletId: true,
  createdAt: true,
  signedBy: true,
  signature: true,
});
export type PolicyDraft = z.infer<typeof zPolicyDraft>;
