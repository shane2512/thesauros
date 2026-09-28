# MIGRATION.md — Reuse map from the prior prototype

This project started as a copy of an earlier non-custodial treasury prototype built for a
different hackathon (different chain, different execution provider). That prototype's git history
was discarded and this repo was git-initialized fresh — this file is the only place that fact is
recorded, for the team's own benefit. It is **not** linked from `README.md` and should not be
referenced in demo materials, the pitch, or the submission video.

## Why a clean git history

The prior build targeted Base Sepolia via Coinbase AgentKit and Spend Permissions, for a different
hackathon track. This project targets Arc via the Circle Agent Stack, for Tameion. The chain, the
custody primitive, the execution provider, and large parts of the wallet/reasoning layers are all
different. Carrying the old commit history forward would misrepresent this as a reskin rather than
what it actually is: the reusable *domain logic* (policy evaluation, risk math, money types, audit
schema shape) kept, everything that touches custody and settlement rebuilt for a different stack.

## Kept as-is (reusable, chain/provider-agnostic domain logic)

| Path | Why it survives unchanged |
|---|---|
| `packages/policy/` | Pure policy evaluation, receipts, verdict precedence — no chain or provider assumptions. Reused directly; only the rule catalogue's numeric defaults may need retuning for USDC-on-Arc's cent-level fees. |
| `packages/shared/` (money, address, result, env, logger, canonical, signing) | `bigint` money math, `Result<T,E>`, redaction, checksummed-address helpers are chain-agnostic. `address.ts` gains a chain-id pairing (see Architecture) since Arc's CCTP/Gateway model makes "address alone" an unsafe key. |
| `packages/risk/` | Depeg/drawdown trigger math and simulation gate — reused; oracle *sources* change (see Rebuilt). |
| `packages/context/` (build, sanitize, types) | Deterministic context-gathering pattern is reused; the fields gathered change (Arc balances/CCTP state instead of Base balances/vault shares). |
| `packages/db/` schema shape | Tables, audit trigger, append-only pattern reused. Column-level changes: treasury rows gain a `chain_id`, spend-permission-specific columns are replaced with Paymaster-policy columns (see Data Model). |
| Tooling: `.dependency-cruiser.cjs`, `eslint.config.js`, `tsconfig.base.json`, `turbo.json`, `vitest.config.ts`, `docker-compose.yml`, CI workflow shape | Infra, not product — reused with package-scope renamed (`@steward/*` → `@thesauros/*`). |
| `apps/worker/` orchestration shape (gather → propose → verify → execute loop, lock, replay) | The loop shape is provider-agnostic; the `execute` step's implementation is rebuilt (see below). |

## Rebuilt from scratch (chain- and provider-specific)

| Old (removed) | New (this repo) | Why it can't just be renamed |
|---|---|---|
| `packages/wallet/src/agentkit.ts`, `spendPermission.ts`, `companionTreasury.ts`, `provision.ts`, `sweepHome.ts`, `revocation.ts`, `confirmer.ts`, `demoOracle.ts`, `calls.ts`, `chain.ts`, `abi.ts`, `actionRegistry.ts`, `executor.ts` | New `packages/wallet/` built around Circle Wallets (agent wallet provisioning), Paymaster (USDC-denominated, sponsor-or-self-pay gas policy in place of a Spend Permission cap), CCTP (cross-chain payouts), Gateway (unified balance read), USYC (yield deposit/redeem) | Coinbase Spend Permissions and EIP-7702 companion-wallet derivation are Base-specific primitives with no Arc equivalent; Circle's Paymaster policy is the closest analogous "hard on-chain cap the model cannot exceed," but the grant/revoke/read APIs are entirely different. |
| `packages/reasoning/src/serv/`, `prompts.ts`, `call.ts`, `verify.ts`, `screen.ts` | New `packages/reasoning/` client against whichever LLM provider is chosen for Thesauros (see `docs/VERIFY.md` — not yet pinned), with prompts rewritten for treasury/AP-AR/compliance tasks instead of SERV's task shape | The old client is a bespoke integration against a specific hackathon's reasoning API; nothing about it is reusable beyond the *pattern* (deterministic context in, schema-validated proposal out, never a write tool). |
| `apps/web/app/`, `components/`, `lib/`, `generated/` (all Steward UI) | New UI built in Phase 4, styled for Thesauros | Every screen referenced Steward's specific flows (Spend Permission grant, companion-wallet EIP-7702 explainer) that don't exist on this stack. |
| `scripts/demo/`, `scripts/live/` | New demo/seed scripts against Arc testnet in Phase 5 | Hardcoded to the old chain's faucet and deployed contract addresses. |
| `docs/AGENTKIT_INTEGRATION.md`, `SERV_REASONING.md`, `addresses.md`, `agentkit-actions.json` | `docs/CIRCLE_INTEGRATION.md`, `docs/REASONING.md`, addresses re-verified fresh in `docs/VERIFY.md` | Content is specific to the removed providers. |

## Not carried over at all

`.tastemaker/`, `PITCH.md`, `DESIGN.md`, `SECURITY_REVIEW.md`, `PROGRESS.md` (prior history),
`README.md`, old `CLAUDE.md`, `.vercel/`, Render/Vercel deploy config, `steward-claude-code-specs.zip`,
`spikes/` — hackathon-specific artifacts (pitch copy, prior submission's design decisions, prior
deploy history) that belong to the other event, not this one.

## Net effect

Roughly the policy/risk/money/audit "brain" of the prior prototype survived; everything that
actually touches funds — wallet provisioning, spend authorization, execution, cross-chain
settlement — is being rebuilt phase by phase against the Circle Agent Stack on Arc, per
`docs/PHASES.md`. Treat every file under `packages/wallet/`, `packages/reasoning/`, and `apps/web/`
as scaffolding-only until its owning phase rewrites it.
