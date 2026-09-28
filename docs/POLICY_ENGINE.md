# POLICY_ENGINE.md — Policy schema & rule catalogue

`packages/policy` is reused near-verbatim from the prior prototype (see `docs/MIGRATION.md`) —
it was already chain-agnostic. This doc describes the target shape after Phase 1's adaptation.

## Policy schema (fields a compiled mandate must produce — no missing numbers)

```
liquidityFloorMicroUsd: bigint      // never touched, sweep-home reserve
perTxCapMicroUsd: bigint            // autonomous per-action cap
dailyCapMicroUsd: bigint            // autonomous daily cap
approvalThresholdMicroUsd: bigint   // above this, ESCALATE instead of ALLOW
depegThresholdBps: number
vaultDrawdownThresholdBps: number   // applies to USYC share price
allowlist: { address, chainId, label }[]
paymasterPolicyId: string           // set once the Circle Paymaster policy is created (Phase 2)
```

## Verdict precedence (I5, non-negotiable)

`DENY > ESCALATE > ALLOW`. Any parse error, unknown proposal kind, stale context snapshot, or
thrown exception inside a rule must resolve to `DENY` or `NOOP` — never silently fall through to
`ALLOW`.

## Rule catalogue (R-*)

Reused rule families (unchanged behavior, retuned thresholds):
- R-CAP-PERTX / R-CAP-DAILY — proposal amount vs. `perTxCapMicroUsd` / `dailyCapMicroUsd`.
- R-ALLOWLIST — exact `(address, chainId)` match required (I4); no ENS, no fuzzy match.
- R-APPROVAL — amount above `approvalThresholdMicroUsd` ⇒ `ESCALATE`.
- R-DEPEG — USDC price vs. `depegThresholdBps` ⇒ forced exit proposal, bypasses normal cadence.

New rule families (Phase 1, this project only):
- R-DRAWDOWN-USYC — USYC share price drop vs. `vaultDrawdownThresholdBps` ⇒ forced redeem.
- R-IDLE-SIZING — a deposit-into-USYC proposal must never bring the liquid balance below
  `liquidityFloorMicroUsd`; oversized deposit proposals are clamped, not denied outright, so the
  loop still makes progress on idle capital.
- R-PAYMASTER-CAP — mirrors R-CAP-PERTX/DAILY but checks the proposal against the *live* Circle
  Paymaster policy state (Phase 2), catching drift between the DB's cached policy and the
  on-chain cap.
- R-SCREEN-DEGRADED (I13) — if a counterparty's last compliance screen (Phase 3) raised its risk
  tier since the policy was compiled, that counterparty's effective allowlist limit is clamped to
  a lower tier-based cap without requiring the owner to re-sign the whole policy.

## Allow-receipts

An `ALLOW` verdict produces a signed, single-use `AllowReceipt` (proposal hash, verdict, expiry,
nonce). `packages/wallet/src/executor.ts` refuses to execute anything without a valid unexpired
unused receipt (I1, I10).

## Testing target

100% branch coverage on `packages/policy`, maintained through every phase. The adversarial corpus
in Phase 3 exercises this engine from the reasoning-output side; `packages/policy/test/` exercises
it directly with hand-built proposals, including deliberately malformed ones.
