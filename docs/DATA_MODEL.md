# DATA_MODEL.md — Database tables

`packages/db/src/schema.ts` structure is reused (see `docs/MIGRATION.md`); this doc reflects the
Phase 1 target shape. Exact Drizzle definitions live in code — this is the conceptual model.

## Tables

**users** — unchanged shape: id, owner address, created_at.

**wallets** (treasuries) — `chain_id` added (was implicitly single-chain before): id, user_id,
chain_id, treasury_address, circle_wallet_id, created_at.

**policies** — the compiled policy schema from `docs/POLICY_ENGINE.md`, versioned; `paymaster_policy_id`
replaces the old `spend_permission_*` columns.

**recipients** (allowlist) — `chain_id` added alongside address: id, wallet_id, address, chain_id,
label, risk_tier, last_screened_at (new, drives I13/R-SCREEN-DEGRADED).

**context_snapshots** — unchanged shape: append-only, raw gathered context per loop tick.

**proposals** — unchanged shape: append-only, reasoning-layer output, linked to the
context_snapshot it was generated from.

**verdicts** — unchanged shape: append-only, Policy Engine output per proposal, includes the
`AllowReceipt` when `ALLOW`.

**executions** — unchanged shape: append-only, keyed by `proposal_hash` (I10), execution
tx hash, chain_id (new — a CCTP payout's execution may reference two chains; record both source
and destination chain_id).

**screens** (new, RFB 5) — id, recipient_id, risk_tier, evidence, screened_at — one row per
scheduled re-screen, append-only.

**audit_log** — unchanged shape: every table above's writes also land here. DB trigger blocks
UPDATE/DELETE on this table and on every append-only table listed above (I6).

## Constraints carried over unchanged

- Unique constraint on `(proposal_hash)` in executions (I10 idempotency).
- Unique constraint on receipt nonce (I10, single-use).
- All money columns `bigint` micro-USD (I12) — no `numeric`/`float` for money anywhere.
