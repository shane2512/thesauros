// System ceilings — constants, never user-editable (POLICY_ENGINE.md §5, SECURITY §3 L3).
//
// THIS FILE IS THE SINGLE SOURCE OF TRUTH for every ceiling in Thesauros (D-23). `packages/policy`
// (`validatePolicyDraft`, rules R06/R07/R14/R19) and `packages/wallet` (spend-permission bounds)
// both read it; neither re-declares a limit. Phase 3 added the risk-parameter bounds below and
// loosened nothing. It lives in `shared` rather than `policy` because `packages/wallet` must not
// import `packages/policy`.
//
// I12: all money is bigint micro-USD (6 decimals). 1 USDC == 1_000_000 micro-USD.

const USDC = 1_000_000n;

export const SYSTEM_CEILINGS = {
  /** Hard cap per action. */
  MAX_PER_TX_MICRO_USD: 250_000n * USDC,
  /** Hard cap per rolling 24h. */
  MAX_DAILY_MICRO_USD: 1_000_000n * USDC,
  MAX_ACTIONS_PER_HOUR: 20,
  MAX_VAULTS: 5,
  MAX_RECIPIENTS: 50,
  PRICE_MAX_AGE_SEC: 60,
  RECEIPT_TTL_SEC: 120,
  MIN_CONFIDENCE_AUTONOMOUS: 0.6,

  // --- Risk parameters (Phase 3; T16 — a mandate must not be able to disable its own guards) ----
  /** A depeg threshold wider than 5% would let a genuinely broken stable through R12. */
  MAX_DEPEG_THRESHOLD_BPS: 500,
  /** A drawdown threshold wider than 20% would make `risk_exit` never fire. */
  MAX_VAULT_DRAWDOWN_BPS: 2_000,
  /** Both risk thresholds must be armed: 0 disables the guard. */
  MIN_RISK_THRESHOLD_BPS: 1,

  // --- Spend Permission bounds (Phase 2; the on-chain authority cap, SECURITY §3 L2) -------------
  /** A permission may never grant more per period than the daily hard cap. */
  MAX_SPEND_PERMISSION_ALLOWANCE_MICRO_USD: 1_000_000n * USDC,
  /** Shortest and longest refill period we accept, in seconds (1 hour .. 30 days). */
  MIN_SPEND_PERMISSION_PERIOD_SEC: 3_600,
  MAX_SPEND_PERMISSION_PERIOD_SEC: 30 * 24 * 3_600,
  /** A permission may not run longer than a year from now. */
  MAX_SPEND_PERMISSION_HORIZON_SEC: 365 * 24 * 3_600,
  /** Clock-skew tolerance when checking that `start` is not in the past. */
  SPEND_PERMISSION_CLOCK_SKEW_SEC: 300,

  // --- Continuous compliance screening (Phase 1; RFB 5, I13) --------------------------------------
  /** A recipient screened 'medium' risk is clamped to this per-tx cap regardless of the signed policy. */
  RECIPIENT_TIER_CAP_MEDIUM_MICRO_USD: 10_000n * USDC,
  /** A recipient screened 'high' risk cannot be paid autonomously at all; the owner must approve. */
  RECIPIENT_TIER_CAP_HIGH_MICRO_USD: 0n,
} as const;

export type SystemCeilings = typeof SYSTEM_CEILINGS;
