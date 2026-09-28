# PHASES.md — Thesauros build plan (Tameion Agents Hackathon)

Six phases, Phase 0 through Phase 5, sized for the two-week Sep 27 – Oct 10 window. Every phase
runs on **Sonnet, medium effort**. Work strictly in order — do not start phase N+1 until phase N's
exit gate is green and the human has said to continue. Commit ~6 times per phase (§5 of
`CLAUDE.md`); stage only what changed for that step.

---

## Phase 0 — Verify the ground truth, repair the scaffold

**Goal:** Turn the migrated scaffold into something that actually installs, typechecks, and
builds, and pin down every external fact this whole project depends on before writing a single
line of product logic on top of them.

**Read first:** `CLAUDE.md`, `docs/MIGRATION.md`, `docs/VERIFY.md` (fill this in as you go).

**Tasks:**
1. `pnpm install` at the root; fix whatever the scope rename (`@steward/*` → `@thesauros/*`) or
   deleted files broke in `pnpm-workspace.yaml`, `tsconfig` path aliases, and any `package.json`
   `dependencies` that pointed at removed local packages.
2. Verify and record in `docs/VERIFY.md`: Arc testnet chain id and RPC URL, the Circle Agent Stack
   SDKs actually needed (`@circle-fin/*` packages — confirm exact npm names and current versions),
   Circle CLI auth flow, ARC CLI install and its bundled testnet RPC access, USDC token address on
   Arc testnet, whether Paymaster sponsorship needs a funded policy up front. Do not assume any of
   these — the hackathon page names the CLIs but not the concrete addresses/ids.
3. Strip every remaining reference to the removed providers (Coinbase AgentKit, SERV/OpenServ, Base
   Sepolia) from whatever `apps/worker/` and `packages/wallet/index.ts`/`packages/reasoning/index.ts`
   still export — these will currently fail to typecheck since their implementation files were
   removed in the migration; either stub them behind a clearly-marked `NotImplementedYet` `Result`
   error, or delete the dangling export, whichever keeps `pnpm typecheck` green.
4. Re-point `.dependency-cruiser.cjs` import-boundary rules at the new package names; confirm I1/I2/I3
   are still enforced (policy package importing nothing it shouldn't, reasoning package never
   imported by anything that can write).
5. Write a fresh `README.md` (project name, one-paragraph pitch, tech stack, how to run) and a
   fresh `docs/PROGRESS.md` (empty status log + Decisions section, ADR-lite, starting from D-001).
6. Delete the dangling `packages/wallet/index.ts` / `packages/reasoning/index.ts` exports that
   still point at removed files, or replace them with the new package's real entry point once
   Phase 2/3 lands — track this as a known issue in `PROGRESS.md` until then.

**Exit gate:**
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test           # existing policy/shared/risk/context tests still pass unmodified
pnpm check:arch
```
All green. `docs/VERIFY.md` has no remaining "TODO: verify" markers for anything Phase 1–2 will
depend on.

---

## Phase 1 — Data model & Policy Engine adaptation

**Goal:** Adapt the reused Policy Engine and DB schema to Arc's multi-chain-by-design model and
Circle's Paymaster cap instead of a Spend Permission cap.

**Read first:** `docs/DATA_MODEL.md`, `docs/POLICY_ENGINE.md`, `packages/policy/` (existing code).

**Tasks:**
1. Update `packages/db/src/schema.ts`: add `chain_id` to every address-bearing table (treasuries,
   recipients, executions — Arc's CCTP/Gateway model means "same address, different chain" is a
   real distinct state, unlike the old single-chain schema). Replace the old
   `spend_permission_*` columns with `paymaster_policy_*` columns (policy id, per-tx cap, daily
   cap, sponsor mode).
2. Write the migration; confirm `pnpm db:migrate` runs clean against a local Postgres
   (`docker compose up -d`).
3. Update `packages/policy/src/rules/` — the rule catalogue itself (R-* ids, verdict precedence)
   is chain-agnostic and stays; only the default numeric thresholds and the "spend permission
   exceeded" rule become "paymaster cap exceeded."
4. Add the two new rule families this stack enables and RFB 1/5 call for: an idle-cash-into-USYC
   sizing rule (don't sweep the whole buffer, respect the liquidity floor from the mandate) and a
   continuous-recheck rule (a counterparty whose compliance tier has degraded since last screen
   gets its limit clamped, not just flagged at onboarding — ties to I13).
5. Extend `packages/context/` types for the new fields the policy needs (chain id per balance,
   USYC position, last-screened-at per counterparty).
6. Tests: extend `packages/policy/test/golden.test.ts` fixtures for the new rules; keep the
   existing verdict-precedence and fail-closed tests passing unmodified.

**Exit gate:**
```bash
pnpm db:migrate
pnpm test --filter @thesauros/policy --filter @thesauros/db
pnpm check:arch
```
100% branch coverage maintained on `packages/policy`.

---

## Phase 2 — Circle Agent Stack integration (wallet layer)

**Goal:** Replace the deleted Coinbase-specific wallet package with a real `packages/wallet/`
against Circle Wallets, Paymaster, and Contracts on Arc testnet — the layer that actually holds
and moves money, so it gets the most scrutiny.

**Read first:** `docs/CIRCLE_INTEGRATION.md`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md`.

**Tasks:**
1. Provision an agent-controlled Circle Wallet per treasury (owner-controlled or
   developer-controlled per Circle's model — decide and record as a Decision in `PROGRESS.md`,
   citing the security tradeoff).
2. Implement `packages/wallet/src/provision.ts` (create/fetch the treasury's Circle Wallet),
   `reads.ts` (balance reads — reused shape, new client), `executor.ts` (the *only* module allowed
   to call a Circle write action — I1 — and only with a valid unexpired `AllowReceipt`).
3. Implement the Paymaster policy as the on-chain cap enforcing I1's "the model can never move
   funds by itself past a hard limit," mirroring what the Spend Permission did in the prior stack:
   set per-tx and per-day caps from the compiled Policy, gas paid in USDC.
4. Implement owner-always-wins (I7): freeze, revoke Paymaster policy, and sweep-to-owner-wallet as
   plain signed calls that never touch the reasoning layer.
5. Adversarial/fork tests against Arc testnet (reuse the old fork-test pattern from
   `packages/wallet/test/fork/`, rewritten against the real testnet): confirm an over-cap
   proposal is rejected on-chain, not just by the Policy Engine.
6. Tests + `docs/VERIFY.md` update with anything discovered about real Paymaster/Wallets behavior
   that the docs didn't cover.

**Exit gate:**
```bash
pnpm test --filter @thesauros/wallet
pnpm check:arch     # confirm only executor.ts imports a write action
```
A real signed transaction lands on Arc testnet and is visible on its explorer; a proposal that
exceeds the Paymaster cap provably reverts on-chain, not just in application logic.

---

## Phase 3 — Reasoning layer (AI proposes, never disposes)

**Goal:** Rebuild `packages/reasoning/` against the chosen LLM provider for Thesauros's specific
tasks: mandate compilation, payment/treasury proposals, and continuous compliance screening
(RFB 5) — with the same "no write tools, schema-validated output, fail closed on anything
malformed" boundary as before.

**Read first:** `docs/REASONING.md`, `docs/SECURITY.md` (prompt-injection section).

**Tasks:**
1. Pick and verify the LLM provider (record in `docs/VERIFY.md` — do not assume the prior
   project's provider is available or appropriate here).
2. Rewrite `prompts.ts`/`compile.ts` for mandate compilation against Circle/Arc primitives (USYC
   instead of a generic vault, CCTP payouts instead of a single-chain payout, Paymaster cap
   language instead of Spend Permission language).
3. Rewrite `propose.ts`/`schemas.ts` for the proposal shape this stack needs; keep the zod
   validation and "unknown/malformed → DENY" fail-closed pattern from I5.
4. Add the RFB 5 screening task: a deterministic scheduler calls the reasoning layer per
   counterparty on a cadence, output is a risk-tier verdict (not a payment authorization — this
   task never touches `executor.ts`).
5. Port the adversarial/prompt-injection test corpus concept from the prior project
   (`packages/reasoning/adversarial/` was removed — rebuild it against the new prompts) — this is
   a hard requirement, not optional, per I3.
6. Tests: schema-validation fuzzing, injection corpus, fail-closed-on-malformed-output.

**Exit gate:**
```bash
pnpm test --filter @thesauros/reasoning
pnpm test:adversarial
```
100% of the adversarial corpus is blocked (DENY or ESCALATE, never a silent ALLOW).

---

## Phase 4 — Worker loop + web app

**Goal:** Wire the autonomous loop end to end and build the UI: connect wallet, write mandate,
review compiled policy, watch the loop run, freeze/revoke, approve escalations.

**Read first:** `docs/UX_FLOWS.md`, `docs/API.md`, `docs/ARCHITECTURE.md`.

**Tasks:**
1. Rewire `apps/worker/src/pipeline.ts`/`loop.ts`/`gather.ts` against the new wallet + reasoning
   packages; keep the gather → propose → verify → execute shape.
2. Build `apps/web/app/api/*` routes per `docs/API.md`: auth (SIWE-equivalent sign-in against the
   Circle Wallet's owner key or the connected EOA — decide and record), mandate submission, policy
   review/sign, treasury dashboard, freeze/approve endpoints.
3. Build the UI screens per `docs/UX_FLOWS.md`: connect, mandate composer, policy review, live
   dashboard (balances across chains via Gateway's unified view, USYC position, pending
   approvals, audit trail), freeze/revoke controls.
4. Fresh visual design — this is a from-scratch UI, not a reskin; no leftover Steward
   copy/branding/screenshots anywhere in `apps/web`.
5. Tests: component tests for the new flows (freeze, approve, mandate submit), replacing the old
   Steward-specific test fixtures.
6. Local end-to-end smoke: `pnpm dev`, connect a wallet, submit a mandate, watch it compile,
   approve, watch the loop execute a real testnet payment.

**Exit gate:**
```bash
pnpm build
pnpm test
pnpm test:e2e   # if Playwright is wired up by this point; otherwise document as a known gap
```
Manual smoke test passes: mandate → policy → live execution → audit trail visible in the UI.

---

## Phase 5 — Demo, traction, and submission

**Goal:** Get real usage (traction is 30% of judging), deploy publicly, and produce the submission
artifacts.

**Read first:** `docs/DEMO.md`, PRD traction requirements.

**Tasks:**
1. Seed and run the demo scenario end to end on Arc testnet (`docs/DEMO.md`): a real small
   business/DAO/solo-founder mandate, real USDC movement, a compliance screen catching a
   deliberately risky counterparty, a freeze mid-flight.
2. If feasible in the window, onboard at least one real counterparty with real intent (the
   traction criterion explicitly rewards "genuine usage... test or real, real customers
   transacting in real USDC on mainnet count more") — gated behind the Phase-5-only mainnet
   sign-off in `CLAUDE.md` I8.
3. Deploy publicly (pick a host; do not assume the prior project's Render/Vercel setup transfers —
   verify fresh against this repo's actual dependency footprint).
4. Record the ≤3-minute demo video.
5. Write the submission: public GitHub repo (this repo, history starts clean at this project's own
   first commit), live product link, traction numbers (invoices processed / payments sent /
   volume moved), Circle tool usage called out explicitly (Wallets, Paymaster, CCTP, Gateway,
   USYC, Contracts — name each one actually used).
6. Final `docs/PROGRESS.md` update: what shipped, what's a known gap, what the roadmap looks like
   post-event (the hosts explicitly fund continued builders).

**Exit gate:** Submission form filled out before Oct 10, 11:59 PM ET, with a working live link and
a repo a judge can clone and run from `README.md` alone.
