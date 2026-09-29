# PROGRESS.md — Living status log & decision log

## Status

**Current phase:** Phase 5 — in progress. The two code-only pieces of `docs/DEMO.md`'s seeding
(`pnpm db:seed:demo`, `pnpm demo:attack`) are built and verified live against Arc testnet + a real
Circle wallet. The rest of Phase 5 (public deployment, the ≤3-minute video, real counterparty
traction, the submission form) needs the human directly — hosting credentials, a recording, and a
form only they can submit — and is called out below rather than attempted blind.

### Phase 5 progress

- [x] `scripts/demo/seed.ts` (`pnpm db:seed:demo`): idempotent — reuses the demo owner/wallet/agent
      wallet on rerun, provisions a real Circle agent wallet the first time, seeds two recipients
      (one is beat 5's re-screen target) and activates a real signed policy. Run live against the
      dev Postgres and a real Circle sandbox account.
- [x] `scripts/demo/attack.ts` (`pnpm demo:attack <walletId> <recipientId>`): fires DEMO.md beat
      4's two attacks — an over-cap payment (R06 DENY) and a payment to an unknown recipient (R05
      DENY) — through the real `gather -> buildCalls -> simulate -> evaluate` pipeline
      (`apps/worker/src/{gather,pipeline}.ts`), not a second hand-rolled copy of it. Both verified
      live to DENY with the expected rule code.
- [ ] `scripts/demo/{provision-owner,fund-owner,drawdown,reset}.ts` — referenced in
      `package.json` but out of `docs/DEMO.md`'s explicit script list (only `db:seed:demo` and
      `demo:attack` are named); not built this session. `provision-owner`/`fund-owner` duplicate
      manual steps already done live in Phase 2 (a funded Circle wallet already exists); `reset`
      would just be `DELETE FROM wallets WHERE …` and is cheap to add whenever it's actually needed.
- [ ] Beats 2–3 and 6 of the demo script (mandate compile → policy sign → dashboard; live freeze)
      are the same code path Phase 4 already smoke-tested (sign-in, recipient add, freeze all
      round-tripped against real Postgres); beat 5 (a scheduled re-screen degrading a recipient's
      tier) is Phase 3's `screening.scan`, already tested there. Nothing new to build for these;
      running the actual demo is a human action (see below).
- [x] Fixed `.env.example` (D-018) and `README.md` for the exit gate's "a judge can clone and run
      from `README.md` alone" — `.env.example` previously used stale variable names that don't
      parse against `packages/shared/src/env.ts`'s real schema (a known issue from D-006, never
      actually fixed until now); `README.md` now names where each credential comes from, how to
      generate the two secrets, and how to run `db:seed:demo`/`demo:attack` without a wallet.
- [ ] Mainnet counterparty traction: deferred by the human's own instruction ("mainnet let's do
      later") — I8's gate needs explicit sign-off and isn't attempted here.
- [ ] **Needs the human:** fund the demo agent wallet (`0x97e3256a8172bDF43F8FA986fFDc9c3643Fd6dE8`
      — printed by `pnpm db:seed:demo` — same faucet workaround used in Phase 2, since the public
      faucet returned Forbidden); pick and configure a public host (do not assume the prior
      project's Render/Vercel setup transfers — PHASES.md says verify fresh); record the ≤3-minute
      video; decide whether to pursue a real mainnet counterparty (I8's mainnet gate needs explicit
      sign-off); write and submit the actual submission form before Oct 10, 11:59 PM ET.

### Bugs found while building the demo scripts (not by typecheck/lint/tests)

- `activatePolicyVersion`'s `body` was being stored as the raw `PolicyDraft` from
  `policyDraftFromTemplate`/`compileMandate`, which is missing `version`/`walletId`/`createdAt`/
  `signedBy`/`signature` — `zPolicyDraft` makes exactly those five fields optional because a draft
  predates activation (`packages/shared/src/schemas/policy.ts`), but the Policy Engine only ever
  evaluates a full, signed `Policy`. `apps/worker/src/gather.ts`'s `getActivePolicy` failed to
  parse the stored body the first time anything tried to read it back (`demo:attack`'s `gather()`
  call). Fixed in both `/api/policy`'s POST handler and `scripts/demo/seed.ts` by constructing the
  full envelope before storing. This also means no wallet had ever actually reached a state where
  `gather()` could read its policy back until this session — Phase 1–3's tests all construct a
  `Policy` object directly rather than going through activation, so this path was untested.
- The same `PolicyDraft`-has-bigints issue from Phase 4's recipient bug recurred for
  `mandates.compiled_draft` and `policies.body`: both jsonb columns throw
  `TypeError: Do not know how to serialize a BigInt` unless the value is round-tripped through
  `canonicalJson` first. Fixed at both write sites (`/api/mandate`, `scripts/demo/seed.ts`); also
  fixed `/api/mandate`'s response, which was returning the raw (bigint-carrying) compile output
  instead of the already-serialized value read back from the `mandate` row.

### Phase 4 task checklist

- [x] Verified `apps/worker/src/pipeline.ts`/`loop.ts`/`gather.ts` were already wired against the
      real wallet + reasoning packages from Phases 1–3; no rework needed.
- [x] Stripped `apps/web`'s leftover Coinbase/AgentKit/`@base-org`-specific `next.config.ts`
      webpack workarounds and the `@coinbase/cdp-sdk` dependency (D-015).
- [x] `packages/wallet/src/chains.ts`: Arc chain defs + `publicClientFor`, shared between
      `apps/worker` and `apps/web` rather than duplicated.
- [x] `packages/db/src/agent.ts`: `setAgentWallet`, the missing counterpart to
      `senderFactory`'s reader — no route could persist a provisioned wallet before this.
- [x] `packages/reasoning/src/prompts.ts`: prompt loading no longer uses
      `new URL(x, import.meta.url)` (D-016) — webpack rewrites that pattern into an object that
      fails Node's `fileURLToPath`, which only surfaces once a bundler (Next.js) touches the
      package; plain `tsc`/`vitest` never caught it.
- [x] All 12 routes from `docs/API.md`: `/api/auth/{nonce,verify}`, `/api/wallet/provision`,
      `/api/mandate`, `/api/policy` (GET mints an activation nonce, POST activates and cancels
      stale approvals), `/api/policy/recipients` (GET/two-step signed POST), `/api/treasury`,
      `/api/audit`, `/api/approvals/[id]`, `/api/freeze` (+`DELETE` for unfreeze), `/api/revoke`,
      `/api/sweep`.
- [x] `apps/web/lib/sweep.ts`: sweep's own build→simulate→evaluate→signReceipt→execute run
      inline in the request, never via the worker's job queue (I7 — sweep must survive the worker
      being down).
- [x] `apps/web/app/page.tsx`: one client-driven flow (connect → provision → mandate → policy
      activation → dashboard) against an injected EIP-1193 wallet, covering all of
      `docs/UX_FLOWS.md`'s screens as sections of one page rather than eight separate routes
      (D-017).
- [x] Live smoke test against the dev Postgres (not just typecheck): sign-in → session →
      `/api/treasury` → `/api/audit`, then the two-step recipient-add signature flow, then freeze
      — each left the DB row it should. Caught and fixed a real bug (below).

### Bugs found by the live smoke test (not by typecheck/lint/tests)

- `/api/policy/recipients` returned `recipients.maxPerTx` (a bigint `money` column) straight into
  `NextResponse.json()`, which throws (`TypeError: Do not know how to serialize a BigInt`) —
  Vitest never exercises real HTTP JSON serialization, only the DB layer's own bigint-safe types.
  Fixed by serializing to a decimal string before the response (I12).
- `.env.local` had `ARC_CHAIN_ID` where `packages/shared/src/env.ts`'s schema expects `CHAIN_ID`,
  and had no `RECEIPT_HMAC_SECRET` at all — both silently meant `getEnv()` would have thrown the
  first time any web route touched it. Neither the worker's own tests nor Phase 2/3's live checks
  caught this because those either construct `Env` objects directly in tests or export
  `RECEIPT_HMAC_SECRET`/`CHAIN_ID` as optional-with-defaults; `getEnv()` reading the real
  `.env.local` was never actually exercised until this phase's web routes did it live.

### Known issues (Phase 4 addition)

- No Playwright e2e suite — `pnpm test:e2e` isn't wired up (PHASES.md anticipated this as a
  possible time-boxed gap; the golden path was instead verified with a live scripted smoke test
  against the real dev database, which exercises the same HTTP/DB boundary Playwright would).
- No component tests for the new UI (`app/page.tsx`) — it was verified by the live smoke test
  exercising its API routes directly, not by rendering the React tree.
- `/api/revoke` and `/api/freeze` both flip the same `wallets.frozen` flag (D-012: Circle's Gas
  Station policy has no per-treasury API to revoke on Arc) — they are audited under distinct
  events (`FROZEN` with different `reason` text) but the owner sees the identical
  `Thesauros freeze` message to sign for either button, since `@thesauros/shared`'s `FreezeAction`
  type only defines `freeze`/`unfreeze`/`sweep`.
- The mandate/policy-activation/sweep paths were verified by build + typecheck + the DB-only
  parts of the smoke test, but not end-to-end with a live SERV call or a live Circle-wallet sweep
  in this session (Phase 2/3 already proved the underlying `compileMandate`/`execute` calls work
  live; Phase 4 only added the HTTP layer around them).

### Phase 3 task checklist

- [x] 1. LLM provider verified live (D-006's OpenServ decision, confirmed against the real API this
      time — `docs/VERIFY.md` row 12). `LiveServClient` now makes a real `/chat/completions` call
      with strict JSON-schema structured output instead of returning `NOT_IMPLEMENTED`. Verified
      end-to-end through the actual library code: real `propose`/`verify`/`screenUntrusted` calls
      against OpenServ produced correct, sensible results (a `noop` for healthy liquidity, `AGREE`
      on a review of it, and a correctly-flagged real injection attempt).
- [x] 2/3. `compile.ts`/`propose.ts` needed no changes beyond what Phase 0 already built — they were
      already written against the current Policy/Proposal schema (USYC-as-a-vault, no Base-specific
      assumptions baked in). Verified this by reading them again against D-012's Paymaster finding
      rather than assuming; nothing in either file references a per-wallet Paymaster policy.
- [x] 4. RFB 5 continuous screening: `screenCounterparty` (new reasoning task, schema-validated,
      fails to `ok: false` rather than inventing a tier on any error) plus `apps/worker/src/jobs/
      screening.ts`'s `screening.scan` scheduler — re-screens every recipient whose last screen is
      stale (or who's never been screened), writes the append-only `screens` row and the
      `recipients.riskTier` cache in one transaction, and audits a tier change. Deliberately never
      reachable from `executor.ts`; deliberately honest about the signal it actually has today (an
      allowlist tenure fact) rather than fabricating a fake sanctions-list/on-chain-history source.
- [x] 5. Adversarial corpus rebuilt at `packages/reasoning/adversarial/run.ts` (`pnpm test:adversarial`).
      10 cases exercising the real `screen -> propose -> verify -> evaluate` pipeline against
      scripted "compromised" model output: address smuggling (rationale and id field), fabricated
      fact ids, amount inflation, disallowed kinds, unicode/base64-obfuscated injected memos,
      malformed JSON, and verifier disagreement. Every case resolves either to a reasoning-layer
      `noop` (mapProposal's own deterministic checks) or a Policy Engine `DENY`/`ESCALATE` — never an
      `ALLOW` of a proposal that should have been blocked.
- [x] 6. Tests: 4 new `screenCounterparty` tests (`FixtureServClient`), 5 new `screening.scan` tests
      (real Postgres), 10 adversarial cases. 100% policy branch coverage maintained.

### D-014 — RFB 5's screening signal is honestly limited to allowlist tenure for now

`docs/REASONING.md` frames counterparty screening as using "on-chain history and any available
off-chain signal." No real on-chain-history analysis or sanctions-list integration exists in this
repo. Rather than fabricate a fake data source to look more complete, `screening.scan` gathers the
one deterministic fact that is actually available (how long the recipient has been on the owner's
allowlist) and is explicit in its own code comment about the gap. A richer signal pipeline (a real
sanctions-list API, on-chain activity heuristics) is real future work, not something to fake now.

## Known issues (Phase 3 addition)

- RFB 5's screening signal is limited (see D-014). The mechanism (schedule → LLM verdict → append-only
  history → cached tier → Policy Engine clamp) is real and tested end-to-end; only the richness of
  the *input signal* is a known gap.
- `SCREEN_STALE_MS` (24h) and `SCREENING_SCAN_CRON` (`*/30 * * * *`) are reasonable hackathon-scale
  defaults, not tuned against any real cadence requirement — revisit if RFB 5's judging criteria
  turn out to expect a specific re-screen frequency.

### Phase 2 task checklist

- [x] 1. Custody model decided: **developer-controlled wallets**, not user-controlled (D-012).
      User-controlled wallets need the end user to complete an MPC signing ceremony per transaction
      (social login/PIN) — incompatible with an unattended worker loop. The "non-custodial-by-design"
      story rests on Thesauros's own layers (Policy Engine, the `AllowReceipt` requirement, the
      owner's freeze/revoke path), not on Circle's wallet type.
- [x] 2. `packages/wallet/src/provision.ts`: real `createCircleClient`, `provisionTreasuryWallet`
      (wallet set + wallet on `ARC-TESTNET`), `getTreasuryWalletAddress`, `circleTxSender` (the real
      `TxSender`, backed by `createContractExecutionTransaction`). `actionRegistry.ts`'s `buildCalls`
      is real for every kind except `pull_allowance` (see D-013). `executor.ts`'s `execute()` claims
      the execution slot (I10), rebuilds and hash-checks the calls against the receipt (I5), and
      sends via the real `TxSender`; `confirmExecution()` polls Circle's `getTransaction` AND
      cross-checks the chain's own Transfer logs against `expectedDeltas` before calling anything
      "confirmed" (5.5 — a Circle status is not, on its own, ground truth).
- [x] 3. Paymaster policy: **could not be implemented as originally specified** — see D-012.
      Confirmed live and via docs that Gas Station policies are console-only, account-wide, and not
      settable per-treasury via any API. The Policy Engine's existing R06/R07 (already real, tested)
      are the actual per-treasury enforcement; `execute()`'s `AllowReceipt` requirement is I1's real
      backstop.
- [x] 4. Owner-always-wins (I7): `tripBreaker` (real DB write), `recordRevocationIfRevoked` (real,
      from Phase 1) and the wallet's `frozen` flag (checked in `runIteration` before any gather)
      already work without touching the reasoning layer or Circle. `sweep_home`'s calls are real
      (`buildCalls`'s `sweep_home` branch, unchanged since Phase 0/1).
- [ ] 5. Adversarial/fork tests against real Arc testnet: **not done**. `apps/worker/test/fork/*`
      still fork Base Sepolia (tracked known issue from Phase 0/1); rewriting them against a real
      Arc fork is substantial standalone work, deferred pending a live Circle account (see Known
      issues) and human direction on priority.
- [x] 6. Tests: 21 new tests in `packages/wallet/test/{actionRegistry,executor}.test.ts` (pure
      `buildCalls`/`callsHash` cases plus `execute`/`confirmExecution` against a real Postgres and a
      fake Circle client). `docs/VERIFY.md` updated with what Phase 2 discovered (row 4: Circle's
      `Blockchain` enum has no Arc mainnet value yet; row 5: entity-secret loss has no self-service
      recovery; row 6: Gas Station policy is console-only).

**Exit gate:**

```bash
pnpm test --filter @thesauros/wallet   # 21/21 pass
pnpm check:arch                        # circle-wallets-only-in-wallet-bootstrap enforced
```

"A real signed transaction lands on Arc testnet and is visible on its explorer" — **demonstrated**.
A fresh Circle Developer account was created after the first account's Entity Secret + recovery file
both turned out to be lost (no self-service recovery exists for that — see D-012's sibling finding
in `docs/VERIFY.md` row 5). Against the fresh account, `provisionTreasuryWallet` created a real
wallet set and wallet on Arc testnet (`0x66d527549FeF4463EEe9e22C378ae0A2B76745E8`), the human funded
it externally after Circle's own `requestTestnetTokens` faucet returned `Forbidden` for this account,
and `circleTxSender.send()` — the actual `packages/wallet/src/provision.ts` code, not a mock —
signed and broadcast a real ERC-20 `transfer` call. Confirmed on the public explorer:

- Tx hash: `0x90abd40e5f68837c6108d6b72e92ad08bc57471866bcc7ef25a21bfe569aa534`
- `https://explorer.testnet.arc.io/tx/0x90abd40e5f68837c6108d6b72e92ad08bc57471866bcc7ef25a21bfe569aa534`
- Status: Success · "Confirmed within <= 0.52 secs" (matches `docs/VERIFY.md` row 1's finality
  claim exactly) · fee `0.001715013975 USDC` (gas paid in USDC, per Arc's native-gas-is-USDC model,
  `docs/VERIFY.md` row 3) · contract `NativeFiatTokenV2_2` (the USDC precompile)

### D-012 — Custody model is developer-controlled; the Paymaster cap is NOT per-treasury and NOT API-settable

Two related Phase 2 findings that change what `docs/SECURITY.md`'s "on-chain Paymaster cap set from
the compiled policy" can mean in practice, confirmed against both Circle's docs and a live API call
(`docs/VERIFY.md` row 6):

1. **Custody model.** Circle's *user-controlled* wallets (the closest fit to "owner-controlled")
   require the end user to complete an MPC signing ceremony (social login, email OTP, or PIN) for
   every transaction. Thesauros's worker loop ticks on a schedule with nobody present to complete
   that ceremony, so user-controlled wallets are not viable for an autonomous agent. Went with
   **developer-controlled wallets**: Thesauros's own layers (Policy Engine caps, the `AllowReceipt`
   requirement `execute()` enforces, the owner's freeze/revoke/sweep path) are what make this
   "non-custodial-by-design," not the wallet type itself.
2. **Paymaster cap.** Confirmed exhaustively (docs + a live account) that Circle's Gas Station
   policy — the per-tx/daily USD cap mechanism — has no REST or SDK API to create or update it. It
   is configured once, per network, through the Developer Console UI, and applies to the **whole
   Circle account**, not to an individual treasury. There is no way to push a business's own
   mandate-derived per-tx/daily limits to Circle programmatically. Rejected building a custom
   on-chain limiter contract for Phase 2 (the alternative the human was offered) as more scope than
   the hackathon window allows; the Policy Engine's own R06 (per-tx)/R07 (rolling daily) rules — real
   and tested since before Phase 2 — are the actual per-treasury enforcement, with `execute()`'s
   receipt requirement as I1's real backstop. `docs/SECURITY.md`'s layer-5 description should be
   read as "the account-wide console policy is a coarse safety net," not "a per-wallet on-chain cap
   derived from the compiled policy" — worth a doc pass in a later phase, not blocking Phase 2.

### D-013 — `pull_allowance` stays `NOT_IMPLEMENTED`; it has no Circle equivalent

Base's Spend Permission model needed `pull_allowance` because the agent's smart wallet was separate
from the owner's EOA and had to pull funds into itself under a signed allowance. Circle
developer-controlled wallets don't have that separation: the treasury wallet Circle provisions
already holds the funds directly. `buildCalls` refuses to build this kind rather than inventing a
new meaning for it — if a real use case for it turns up (e.g. moving funds between a Circle wallet
and some other custody boundary), that is new design work, not a Phase 2 stub to reinterpret quietly.

## Known issues (Phase 2 addition)

- **Resolved this session:** the first Circle account's Entity Secret + recovery file were both
  lost with no self-service recovery. A fresh Circle Developer account was created and its Entity
  Secret registered cleanly (stored only in `.env.local`, never committed). Note for whoever holds
  this account going forward: **the moment `registerEntitySecretCiphertext` succeeds, save the
  Entity Secret and its downloaded recovery file to a password manager** — there is no second chance
  if both are lost again.
- **Resolved:** Circle's `requestTestnetTokens` faucet returned `Forbidden` for the new account
  (likely an account-level enablement Circle gates separately — not a bug in this repo). The human
  funded the wallet externally instead; `circleTxSender.send()` then landed a real transaction on
  Arc testnet (see the Exit gate section above for the tx hash and explorer link).
- Task 5 (adversarial/fork tests against real Arc testnet) is not started. The existing fork tests
  target Base Sepolia and need a full rewrite against Arc's actual testnet infrastructure (anvil
  equivalent, a real deployed vault, funded test accounts) — sized as its own chunk of work; Arc
  testnet USDC is now available in the funded wallet above if that work picks up soon.
- `packages/wallet/src/spendPermission.ts`'s `readAllowanceRemaining` and
  `revocation.ts`'s on-chain `isRevoked` read remain `NOT_IMPLEMENTED`/Base-specific — Circle has no
  equivalent primitive to replace them with (not a gap Phase 2 could close; see D-009/D-013).

### Phase 1 task checklist

- [x] 1. `packages/db/src/schema.ts`: `chain_id` added to `recipients` and `executions`
      (`destChainId` too, for a CCTP payout's source/destination pair); `wallets`'s chain-id check
      constraint, and every hardcoded Base chain-id literal across `shared`/`policy`/`risk`/`db`,
      corrected to Arc's real ids (5042002 testnet / 5042 mainnet, `docs/VERIFY.md` rows 1 & 13) —
      these were still Base Sepolia/Base mainnet (84532/8453), which was a live correctness bug in
      I8's mainnet gate and I11's demo fencing, not just a rename. New `paymaster_policies` table
      (Circle Paymaster policy: per-tx/daily caps, sponsor mode) and a `paymaster_policy_id` column
      on `policies`, replacing the old `spend_permission_*` columns at the policy level (D-009).
      New `screens` table (RFB 5) plus `risk_tier`/`last_screened_at` on `recipients` (I13).
- [x] 2. Migration `0003_lowly_sentry.sql` generated and applied clean against local Postgres.
- [x] 3. `packages/policy/src/rules/`: catalogue and verdict precedence unchanged; R13's comment/
      sentence reframed from "spend permission exceeded" to "the agent's remaining operating
      allowance, sourced from Spend Permission today and the Paymaster cap once Phase 2 lands" —
      its logic is untouched since the actual cap *source* is Phase 2 wallet work, not a policy
      rule change (D-010).
- [x] 4. Two new rule families: R-IDLE-SIZING turned out to already exist as R08 (runway buffer:
      denies a `vault_deposit` that would bring liquid USDC below the mandate's buffer — exactly
      "don't sweep the whole buffer," chain-agnostic, reused unchanged) — added no duplicate rule
      (D-011). R-SCREEN-DEGRADED is genuinely new: **R22**, which clamps a recipient's effective
      per-tx cap to a system tier ceiling when `state.recipientScreens` shows a `medium`/`high`
      tier, `ESCALATE` (owner-liftable) rather than `DENY`.
- [x] 5. `packages/shared/src/schemas/evaluation.ts`'s `state` gained `recipientScreens` (keyed by
      policy recipient id); `apps/worker/src/pipeline.ts`'s `evaluationStateOf` now builds it for
      real from `recipients.riskTier`/`lastScreenedAt` (already fetched by `gather.ts`), matched to
      the policy recipient by address equality (I4) — this is real, working plumbing, not a stub.
- [x] 6. Extended `packages/policy/test/rules.test.ts` with a full R22 branch suite (8 new tests);
      every pre-existing verdict-precedence/fail-closed test still passes, with only the mechanical
      rule-count literals (22→23) and the Base→Arc chain-id literals updated across the workspace's
      test fixtures — no test's actual intent changed.

**Exit gate, verified green this session:**

```bash
pnpm db:migrate                                              # clean
pnpm test --filter @thesauros/policy --filter @thesauros/db  # all pass, 100% policy branch coverage
pnpm check:arch                                               # clean
pnpm typecheck / pnpm lint / pnpm test (full)                 # also all green
```

### Phase 0 task checklist

- [x] 1. `pnpm install` clean; no broken workspace/tsconfig references from the `@steward/*` →
      `@thesauros/*` rename.
- [x] 2. `docs/VERIFY.md` fully researched against Arc Docs / Circle Developer Docs (11 of 13 rows
      fully verified; row 7 — Paymaster revoke propagation time — is a genuine, honestly-flagged gap
      with a concrete fallback, not a guess).
- [x] 3. Stripped dangling Coinbase AgentKit / SERV / Base Sepolia references from
      `packages/wallet` and `packages/reasoning`. Every function that is genuinely Base- or
      Coinbase-CDP-specific (spend-permission allowance reads, CDP client/account/sender
      construction, demo price refresh, execute/confirm chain sends, revoke detection's on-chain
      read) is now a clearly-marked `NOT_IMPLEMENTED` `Result` error, not a deleted export — the
      rest of `apps/worker`'s orchestration (gather → propose → verify → pipeline → jobs → loop)
      compiles and runs unchanged against these stubs.
- [x] 4. `.dependency-cruiser.cjs` re-pointed at the new package names (`cdp-only-in-wallet-bootstrap`
      now names `provision.ts`, the real successor to the deleted `agentkit.ts`); I1/I2/I3 are
      proven enforced by a rebuilt `scripts/fixtures/arch/` + `scripts/fixtures/lint/` (both were
      missing after the migration and `pnpm check:arch` was crashing, not just failing).
- [x] 5. Fresh `README.md` (already up to date) and this fresh `PROGRESS.md`.
- [x] 6. Dangling `packages/wallet/index.ts` / `packages/reasoning/index.ts` exports resolved (see
      Decisions below) rather than left as a known issue — every export now resolves to real code
      or a typed stub, so nothing downstream silently imports `undefined`.

**Exit gate, verified green this session:**

```bash
pnpm install        # clean
pnpm typecheck      # 9/9 packages
pnpm lint           # eslint + prettier clean
pnpm test           # 907 passed (563 + 344 policy-coverage run), 0 failed
pnpm check:arch     # depcruise clean on the real tree; fixture proves all 4 named rules still fire
```

`pnpm db:migrate` was exercised manually (`docker compose up -d --wait`, then migrate) and works;
it isn't part of the Phase 0 gate but is needed for `pnpm test`'s DB-backed suites, which all pass.

## Decisions (ADR-lite)

### D-024 — App UI replaced with the Stitch "Landing Page Recreation" screens

The whole authenticated app (shell, dashboard, fund sheet, freeze modal, 4-step onboarding, activity,
approvals, policy, recipients, settings, connect) was rebuilt from the nine Stitch mobile screens
(project 11119537162809807173), then audited with the tastemaker skill and revised. Presentation
only: every API route, signing flow (`useSignFlow`, server-issued messages), Policy Engine path and
freeze/sweep path (I7) is unchanged — the screens call the same functions they called before.

- **Tokens:** cool-grey ground `#f8f9fa`, white `.card` on a hairline shadow, ink `#191c1d`, brand
  yellow `#FCE300` for filled surfaces only; a named type scale (`text-cap` … `text-display`) instead
  of one-off pixel sizes. Dark mode kept.
- **Fonts (no new npm dependency — `next/font/google`):** the landing page's own pairing kept —
  Plus Jakarta Sans for everything, Geist Mono for addresses/hashes — plus UnifrakturCook for the
  wordmark only, next to the unchanged `brand/logo/thesauros-logo.svg` (copied to
  `apps/web/public/logo/`). Stitch's Space Grotesk was tried and dropped at the owner's call: the
  existing brand type wins over the imported design's.
- **Honesty over Stitch's placeholders:** Stitch's invented figures (APY, "$14.2k executed", ERC-4337,
  multisig quorum, "ZK proof", QR code) were not shipped. Every number on screen comes from
  `/api/dashboard`, `/api/decisions` or `/api/policy`; "Verify proof" became the real
  `/api/audit/verify` chain walk, "Download receipt" saves the decision JSON the API returned.
- **New route:** `/app/activity/[id]` (Event & proof) replaces the in-place expandable detail.
  Activity cards needing approval deep-link to `/app/approvals?decision=<id>`, which opens that
  approval's sign sheet. `/app/activity?filter=DENY` is linked from the dashboard's blocked count.
- **Navigation:** four tabs (Treasury, Activity, Approvals, Settings) as in Stitch; Recipients and
  Policy are reached from the dashboard and from Settings (Policy previously had no link at all).
- **Removed:** the unused recharts balance card (`components/ui/metric-*`, `progress-metric-card`).
  `recharts` stays in package.json for now; dropping it is a lockfile change for a separate commit.

### D-023 — Owner sweep: reserve gas headroom, and confirm on-chain before reporting success

Found live, right after D-022 fixed the simulation transport: the sweep executed and reported
`{status: 'executed'}`, but the funds hadn't actually moved. Two separate bugs:

1. **`sweep_home` swept the agent wallet's full measured USDC balance to zero.** Arc's native gas
   token IS USDC — the same balance the transfer moves (docs/VERIFY.md row 3). A transaction's own
   fee is deducted from that balance before the transfer call runs, so a transfer built from the
   FULL balance asks for more than remains once gas is paid, and reverts on-chain. Confirmed by
   querying Circle directly: `state: "FAILED"`, `errorReason: "FAILED_ON_ONCHAIN"`, with a real
   `networkFee` charged — and replaying the identical calldata as a free `eth_call` (no gas
   deduction) succeeded, isolating gas-vs-balance as the exact cause. Fixed by reserving
   `SYSTEM_CEILINGS.SWEEP_GAS_RESERVE_MICRO_USD` (20,000 micro-USD / $0.02 — comfortable margin over
   the ~$0.0015 observed real fee) from the amount `apps/web/lib/sweep.ts` builds the proposal,
   `expectedDeltas`, and `buildContext.agentUsdcBalance` from. `packages/wallet/src/actionRegistry.ts`
   needed no change: `BuildContext.agentUsdcBalance` has exactly one consumer (`sweep_home`), so its
   caller deciding "how much to actually sweep" rather than "the true full balance" is a safe,
   minimal redefinition.
2. **`runOwnerSweep` never confirmed the transaction landed.** `execute()`'s success only means
   Circle *accepted the submission* (`status: 'submitted'`) — the route then reported `'executed'`
   immediately, without ever calling `confirmExecution` (which polls Circle for terminal state and
   cross-checks the chain's own Transfer logs against the expected deltas — 5.5's whole point).
   Confirmed via the DB: the `executions` row for the failed sweep was permanently stuck at
   `status: 'submitted'` with an empty `tx_hash`, because nothing had ever verified or recorded
   the real outcome. Fixed: `runOwnerSweep` now calls `confirmExecution` (bounded to 20s/1s-poll —
   Arc's finality is deterministic and near-instant, so this isn't a guessed timeout) and only
   returns `'executed'` once the chain confirms it; `updateExecution` now records the real
   `status`/`txHash`/`confirmedAt` (or `failed`/`timeout` with the reason) instead of leaving the
   row silently wrong forever.

Separately noticed, not fixed here (flagged for later, doesn't block sweep): the worker's own
`exec.confirm` job handler (`apps/worker/src/jobs/confirm.ts`) has the same gap — it calls
`confirmExecution` and logs the result but never calls `updateExecution`, so agent-initiated
executions' rows likely have the same stuck-at-`submitted` problem. Worth a dedicated pass.

Exit gate: `pnpm typecheck`, `pnpm lint`, `pnpm check:arch`, `pnpm test` (601+352, policy still 100%
branch coverage), `pnpm --filter @thesauros/web build` all green.

### D-022 — Simulation transport switched from `eth_simulateV1` to `Multicall3From` (Arc's RPC doesn't support it)

Found live while testing an owner-initiated sweep: it was denied with
`MethodNotFoundRpcError: The method "eth_simulateV1" does not exist`. PHASES 5.1's original choice
(recorded as D-40) had only been checked against Base Sepolia and anvil — never against Arc's real
RPC — and Arc Docs MCP's own "Supported methods" table for `/arc/references/rpc-endpoints` confirms
`eth_simulateV1` isn't one of them (see `docs/VERIFY.md` row 14).

`packages/risk/src/simulate.ts` now batches the same pre-balance/body/post-balance call sequence
through Arc's predeployed `Multicall3From` contract (`0x522fAf9A91c41c443c66765030741e4AaCe147D0`)
via a single `eth_call` to its `aggregate3(...)` entry point, instead of `viem`'s `simulateCalls`.
`Multicall3From`'s `CallFrom` precompile preserves the agent wallet as `msg.sender` for every
subcall, which is what gives the same property `eth_simulateV1` was chosen for — state carry-over
within one call frame (`approve` then `deposit` sees the allowance) — without ever broadcasting
anything. Verified live against the real Arc testnet RPC before shipping: a `balanceOf` /
`balanceOf` / `transfer` / `balanceOf` / `balanceOf` `aggregate3` batch decoded correctly and
produced accurate before/after deltas.

No security property changed: deltas are still measured from real EVM execution (never inferred
from the proposal's own claims), an `eth_call` the RPC can't answer still returns `Err` and R11
still DENYs (I5, fail closed) — only the RPC method changed. `allowFailure: true` per call means one
subcall reverting doesn't unwind an earlier one's effects, which now also matches how the real
executor works: `@thesauros/wallet`'s `circleTxSender` sends each call as its own separate
Circle-signed transaction (Circle wallets have no native call-batching on Arc today), not one atomic
multi-call — so simulating via one atomic `aggregate3` and executing via N separate transactions
have the same failure granularity at the balance-delta level that R11 actually checks. Per-call gas
figures (`Multicall3From`'s `Result` has no gas field, unlike `eth_simulateV1`'s results) are no
longer measured — recorded as `0n` on the `simulations` row. Nothing reads that field for a policy
decision, so this is a loss of an audit nicety, not a safety regression.

### D-021 — Full route-for-route port of Steward's UI (superseding D-020's single-page scope)

The human tested D-020's single-page restyle and said it still didn't look or flow like Steward's
app — they wanted the actual userflow, not just the token system. A peer session (D-019/D-020's
collaborator) copied Steward's real source into `.steward-ui-source/` (149 files, git-ignored,
scratch-only) for this session to read directly rather than re-describe. Rebuilt Thesauros's
frontend as Steward's actual multi-route structure: `/` (raw landing.html), `/connect`,
`/onboarding` (4-step resumable wizard), `/app` (dashboard) with its shell (header, tab bar,
freeze modal, notification bell), replacing D-017's single-page dashboard entirely.

Every screen's markup/Tailwind classes/component tree came from Steward's real files; every
data-fetching call was rewired to this app's own API (`/api/dashboard`, `/api/onboarding`,
`/api/me`, `/api/notifications`, `/api/decisions[/id]`, plus API.md's original 12 routes), and
three real Coinbase/Base-specific pieces were dropped rather than ported, per D-012:

- **Spend Permission allowance meter** (Steward's `allowanceView`/`AllowanceMeter` on the
  dashboard) — Circle has no per-wallet on-chain allowance to visualize.
- **Onboarding's spend-permission-grant step** — Steward's wizard has 5 steps; this one has 4,
  because there is nothing to grant.
- **The freeze flow's on-chain revoke step** — kept the exact 3-step visual structure (the human
  asked for the same userflow), but step 2 now completes instantly with no signature, since
  there's no separate on-chain permission to revoke.

`wagmi` was dropped as a dependency (nothing imports it — one injected-wallet connector needs no
multi-connector library, D-017) along with the Coinbase-specific `useSigner`/`SignSurface`
machinery it powered; `lib/injectedWallet.ts`'s own `ensureArcNetwork()` replaces it, and is now
also what makes the connect flow actually check/prompt for the Arc network (a real bug found live:
a wallet left on Base Sepolia from testing Steward stayed there silently through sign-in, since
`personal_sign` is chain-agnostic and nothing else checked).

The landing page (`generated/landing.html`, Steward's real 750-line marketing page, served as a
raw file to keep its scroll-reveal animations) got the same treatment: branding swapped
throughout, but every specific evidentiary claim — "48/48 malicious cases blocked", a Base Sepolia
revoke tx hash, a "docs/SECURITY_REVIEW.md" citation — was replaced with Thesauros's own real,
checkable numbers (10/10 adversarial cases held, 100% policy branch coverage, 22 rules, the live
`demo:attack` R05/R06 denials) rather than carried over verbatim, since those specific figures
don't hold for this codebase and repeating them would be fabricating evidence, not restyling a page.

Verified live end-to-end against the real dev Postgres and Circle sandbox after a full DB reset
(the human asked for one to test onboarding as a genuinely new user): connect (with the Arc
network prompt firing correctly) -> provision a real Circle wallet -> compile a mandate (correctly
asking clarifying questions on an underspecified one, then compiling cleanly once complete) ->
sign and activate the policy -> onboarding reaches `'done'` and redirects to `/app`.

**Later in the same effort**: ported the remaining 6 screens. `/app/policy`, `/app/approvals`,
`/app/recipients` first (commit `8efa823`) — Policy split into a GET (active-policy view) and a new
`/api/policy/prepare` (recompiles the latest mandate's text fresh against current recipients/vaults
on every call, fixing a real gap where a newly-added recipient would be invisible to a stale
compiled draft); Approvals now makes the signature optional (rejecting needs none, only approving
does); Recipients always routes a successful add into signing the next policy version. Then
`/app/activity` and `/app/settings`(`/close`): Activity ports Steward's tabbed decision detail
(Context/Proposal/Verifier/Policy checks/Simulation/Transaction) verbatim, adapted to this app's
`zDecisionDetail` shape (no `contextFacts`/`screen` fields — the Context tab shows trigger/kind/
status instead) and its `?before=` cursor param instead of Steward's `?cursor=`. Settings turned out
to need far less invention than expected: `packages/db` already had `verifyChain` (a real,
previously-unused hash-chain recompute for I6), `scrubUserPersonalData`, and `setTelegramChatId`
implemented from an earlier phase but never wired to a route — this pass added the three small
routes (`/api/audit/verify`, `/api/audit/export`, `/api/me/telegram`,
`/api/account/delete-personal-data`) and a `telegramEnabled`/`zMe.user.telegramChatId` field each,
rather than fabricating the feature from scratch. `ClosureChecklist` embeds the existing `FreezeFlow`
for step 1 and gates "delete personal data" on the wallet already being frozen, matching Steward's
own ordering.

`.steward-ui-source/` can be deleted now that all 9 routes are ported — kept for now in case a later
pass wants to re-check styling.

Exit gate for this final slice: `pnpm --filter @thesauros/web typecheck` clean, `pnpm lint` clean,
`pnpm --filter @thesauros/web build` succeeded (34 routes).

**Last gap closed**: ported `ProgressMetricCard`/`MetricChart`/`metric-controls` (the balance-history
chart) into `BalanceCard`. Needed no new dependency — `recharts` and `lucide-react` were already in
`apps/web/package.json`, unused leftovers from the Steward scaffold. Kept Steward's own honest
framing rather than inventing a trend: Thesauros has no balance-history table, so the series is
today's real balance plotted as a flat two-point line ("no observed change"), not fabricated
movement. D-021 (the full route-for-route Steward UI port) is now complete with no known gaps.

### D-020 — Ported Steward's visual design system (tokens/primitives only, not branding/routes)

The human asked for Thesauros's UI to visually match Steward's exactly. Asked the peer session
(D-019's checklist author) for the actual implementation rather than guessing; it pointed at
`D:\STEWARD`'s untouched original files (`.tastemaker/style-lock.md`, `app/globals.css`,
`components/ui/primitives.tsx`, `lib/format.ts`, `lib/status.ts`, `components/icons.tsx`), which
this session's filesystem could read directly.

What was ported, verbatim in substance:

- `apps/web/app/globals.css` — the full token contract (color roles, dark/light palettes, the
  yellow-never-as-text-on-white rule, verdict colors as the one deliberate exception, type scale,
  radii, shadows, motion tokens) and every `@layer` rule (glass, meter/limit-line, wordmark-rule,
  breathe/loadbar/skeleton keyframes, `prefers-reduced-motion` handling). Every value, rule and
  comment carried over exactly; only the CSS custom-property prefix changed (`--st-*` → `--th-*`)
  so Thesauros's own source doesn't literally name its tokens after the old project.
- `apps/web/app/layout.tsx` — same Plus Jakarta Sans / Geist Mono font pairing and skip-link.
- `apps/web/components/{icons,primitives}.tsx`, `apps/web/lib/{format,status,utils}.ts` — the
  actual component/helper source (Money, Balance, VerdictBadge, Button, Row, StatusPill,
  AllowanceMeter, Banner, EmptyState, etc., plus the money/date formatters and the icon set).
  `status.ts` was adapted (not copied) to Thesauros's real `/api/treasury` response shape rather
  than Steward's `Dashboard` contract type, since that type doesn't exist here.
- `apps/web/app/page.tsx` restyled end-to-end with these primitives: the dashboard, mandate
  composer, policy card, approvals, recipients/compliance (now showing the `AllowanceMeter`
  device against each recipient's cap, using the real `riskTier` field neither Steward nor the
  peer's checklist had), and audit trail all use the real tokens, radii, verdict-badge rule, and
  money formatting instead of the ad-hoc dark-neutral Tailwind classes from D-017's first pass.

What was deliberately NOT ported, per CLAUDE.md's explicit rule against reintroducing the prior
prototype's branding: the "Steward" name/wordmark text (now "Thesauros"), Steward-specific copy,
and Steward's multi-route IA (`/connect`, `/onboarding`, `/app/policy`, `/app/approvals`,
`/app/activity`, `/app/recipients`, `/app/settings/close`) — D-017's single-page architecture is
kept, restyled rather than restructured, per the human's own scoping answer ("same owner-facing
behavior/UX," not a literal route-for-route rebuild). The I11 "DEMO DATA" banner — which
CLAUDE.md requires and which Steward's own team had removed by explicit owner request on their
project (D-115 there) — was kept, using the same `Banner` component and the same visual treatment
Steward uses for its other banners, just not the same one Steward chose to keep.

Verified: `pnpm typecheck`/`lint`/`test`/`check:arch`/`build` all green; the landing screen was
visually confirmed in the browser pane against the token system (yellow pill button, wordmark
rule, mono-uppercase banner label, dark canvas) before committing. The signed-in dashboard's
styling was verified by code review and successful build/typecheck rather than a live screenshot
(no in-session way to complete an injected-wallet sign-in against a headless browser without a
real extension) — worth a manual click-through before the actual demo.

A caveat found while wiring this in: `/api/treasury` had been returning pre-formatted decimal
strings (`formatUnits(...)`, e.g. `"1234.56"`) rather than raw base units, which the ported
`Money`/`Balance`/`AllowanceMeter` components need as bigint-parseable integer strings (I12) — the
first draft of the restyle actually mangled this (`"1234.56".replace('.', '')` → garbage). Fixed
by having `/api/treasury` return raw base units and letting the UI format them, which is also the
more correct convention per I12 (money crosses the API boundary as untouched base-unit digits;
formatting happens once, at the last step, in the UI) — this bug never reached a commit.

### D-019 — Cross-session audit checklist (Steward/Base owner-flow bugs): pass/fail against Thesauros

A peer session working on the discarded prior prototype (Steward, Base/Coinbase AgentKit) sent an
11-item self-audit checklist of bugs it hit in Steward's owner flow, asking whether Thesauros has
the same bugs. Per D-001/CLAUDE.md §9, Steward's architecture is NOT Thesauros's — most of these
items describe a Coinbase Smart Wallet / Spend Permission mechanism (companion wallets, CREATE2
derivation, `SpendPermissionManager.revoke()`) that doesn't exist here at all (D-012: Circle's
developer-controlled wallets have no per-wallet Paymaster policy to grant or revoke via API). Went
through each item against the real code and, where possible, a live server rather than trusting the
claim:

1. **Connect-flow connector memory** — N/A. Thesauros has exactly one connection path (an injected
   EIP-1193 wallet, D-017); there's no second connector to retry against the wrong one.
2. **No filler nav on landing** — Pass. `app/page.tsx`'s signed-out view is a title, one line of
   copy, and one Connect button; no About/Careers/Contact placeholders.
3. **Domain derivation for sign-in** — Pass, already correct: `apps/web/lib/auth.ts`'s
   `domainFromRequest` reads `req.headers.get('host')`, never `new URL(req.url).host` (this is
   API.md's own carried-over lesson, followed in Phase 4).
4. **Wallet-type-can-hold-a-cap check at provisioning** — N/A by architecture, not just "doesn't
   apply, unchecked": Circle's Gas Station policy is console-configured and account-wide (D-012),
   so there is no per-wallet capability to verify at provisioning time — every Circle
   developer-controlled wallet `provisionTreasuryWallet` creates is identical in this respect.
   Separately confirmed the treasury address (the connecting EOA) is set once at first sign-in
   (`ensureWalletForUser`, `onConflictDoNothing`) and never re-derived on a later sign-in.
5. **Mandate compilation fails closed, never invents a default** — Tested live against the real
   `/api/mandate` route (real SERV call, not a fixture) with three mandates: one omitting every
   required number, one naming a recipient that doesn't exist yet, one with no numbers at all. All
   three correctly returned `draft: null` with specific `MISSING`-coded issues and clarifying
   questions — zero invented defaults. Onboarding copy distinguishing "click a template" vs. "type
   free text" doesn't apply yet since there's no template-button UI in the current mandate
   composer (D-017's single-page flow only has the free-text path); worth adding if templates gain
   a UI.
6. **Signing-path isolation from the Paymaster-cap check (Steward's D-116 bug)** — N/A by
   architecture: grepped every route under `apps/web/app/api` and `apps/web/lib` for any check
   gating a signature on "can this wallet hold a cap," and found none — `/api/policy`,
   `/api/policy/recipients`, `/api/approvals/[id]`, `/api/freeze`, `/api/revoke`, `/api/sweep` all
   verify a plain EIP-191 signature via `verifyMessage` with no shared gate between them. This bug
   class cannot exist here because there is no screen that grants a per-wallet Paymaster cap at
   all (item 4).
7. **`executor.ts` is the only Circle-write-capable module** — Pass, already enforced:
   `pnpm check:arch`'s `circle-wallets-only-in-wallet-bootstrap` rule (verified in Phase 0/4 runs
   to actually fire on the deliberate-violation fixture, not just exist unconfigured).
8. **Approval modal signature isolation** — Pass, same evidence as item 6: `/api/approvals/[id]`
   is a plain signature check with no Paymaster-related gate.
9. **Freeze/revoke/sweep independent of the worker** — Tested live with the worker process
   confirmed NOT running (checked `Get-NetTCPConnection`/process list before running the test):
   sign-in, freeze, and unfreeze all round-tripped correctly against the real dev Postgres with
   only the web process up. Revoke shares `ownerFreezeAction` with freeze, so the same evidence
   covers it. Sweep's `evaluate -> signReceipt -> execute` path was not exercised live in this
   check (needs a funded, provisioned agent wallet, which the current demo wallet isn't yet) but is
   structurally identical — no worker/reasoning call anywhere in `apps/web/lib/sweep.ts`. The
   "granting account differs from the connected wallet" scenario (Steward's D-117 bug) is N/A:
   Circle's model has no per-wallet grant to revoke, so there is no granting-account/connected-
   wallet mismatch to guard against.
10. **Audit trigger actually tested, not just present** — Pass, already true:
    `packages/db/test/audit.test.ts`'s `'rejects UPDATE, DELETE and TRUNCATE'` test issues real
    `UPDATE`/`DELETE`/`TRUNCATE` statements against `audit_log` and asserts each is rejected with
    the trigger's specific error message.
11. **General lesson (test live, not just typecheck/lint)** — Already this session's own practice:
    Phase 4/5's live smoke tests already caught two real bugs (BigInt JSON serialization, a
    missing policy envelope) that no static check found. This audit added two more live checks
    (mandate fail-closed behavior, freeze/unfreeze with the worker down) that hadn't been run yet.

Net: 7 of 11 items pass or are structurally inapplicable with evidence; 0 required a code change.
The one gap worth tracking is sweep's live execute() path, which needs a funded wallet to verify
end-to-end — left as a "needs the human" item alongside the rest of Phase 5's funding/deployment
tasks rather than blocking on it.

### D-018 — Fixed `.env.example` to match `packages/shared/src/env.ts`'s real schema

D-006 (Phase 0) flagged that `.env.example` used stale Base/CDP-era variable names
(`ARC_CHAIN_ID`, `REASONING_API_KEY`, no `RECEIPT_HMAC_SECRET`) that don't parse against the env
schema, and deferred fixing it to "Phase 1/2 once the real Circle/Arc variable shapes are being
wired up." That fix never actually landed — confirmed by hitting the exact same
`ARC_CHAIN_ID`-vs-`CHAIN_ID` mismatch in my own working `.env.local` during Phase 4's live smoke
test. Since Phase 5's exit gate is "a repo a judge can clone and run from README.md alone," a
judge copying `.env.example` verbatim would have hit `getEnv()` throwing at their very first
`pnpm dev`. Fixed `.env.example` to the real field names and added the missing
`RECEIPT_HMAC_SECRET`; `README.md` now spells out where each credential comes from and how to
generate the two secrets.

### D-015 — `apps/web` build config stripped of every Coinbase/AgentKit-specific workaround

`next.config.ts` still carried a jose ESM race-condition fix, `@base-org/account`/
`@coinbase/agentkit` webpack externals, `@noble/hashes` version-collision avoidance and a
MetaMask-SDK React-Native fallback — all specific to the deleted prior prototype's dependency
tree, none of which apply to a bare EIP-1193 `window.ethereum` connection plus the Circle Agent
Stack. `@coinbase/cdp-sdk` was also still listed in `package.json` though nothing imported it.
Both removed; `pnpm install` afterwards dropped 7 packages and added 6, confirming the tree was
genuinely unused rather than transitively required.

### D-016 — Prompt loading uses `dirname(fileURLToPath(import.meta.url))`, not `new URL(x, import.meta.url)`

`packages/reasoning/src/prompts.ts` read `prompts/<name>.md` via
`new URL('../prompts/', import.meta.url)` + string concatenation. That works under plain Node
(`tsc`, Vitest, `apps/worker`) but breaks once a bundler touches the package: webpack (Next.js
bundles `@thesauros/reasoning` for `apps/web`'s `/api/mandate`) treats the two-argument `new URL`
form as an asset-module reference. A path built from a runtime variable can't be resolved that
way at all ("Module not found"), and even a literal per-name URL gets rewritten into a
webpack-internal URL wrapper that isn't a real `URL` instance, so `fileURLToPath` then throws
(`instanceof URL` fails across that boundary). Switched to computing the directory once with
`dirname(fileURLToPath(import.meta.url))` and joining with `path.join` — a form webpack does not
special-case — which behaves identically under plain Node. This class of bug is invisible to
`pnpm typecheck`/`pnpm test`/`pnpm check:arch`; only `pnpm build` (which runs `next build`)
catches it, which is why it surfaced in Phase 4 rather than Phase 3.

### D-017 — One `apps/web/app/page.tsx`, not eight routes, for `docs/UX_FLOWS.md`'s eight screens

Connect, mandate composer, policy review, dashboard, approval modal, audit trail and compliance
panel are implemented as sections of one client component driven by wallet-session state, rather
than eight separate Next.js routes/pages. Every one of them is a thin read-or-sign-and-post view
over the same small set of API routes with no independent navigation state worth preserving in
the URL for a hackathon-scale demo; splitting them into separate routes would have meant either
prop-drilling the same session/treasury fetch through eight files or re-fetching it eight times,
for no UX benefit. Rejected alternative: a router-driven multi-page flow — deferred until a real
need for deep-linkable screens (e.g. sharing a specific audit entry's URL) shows up.

### D-001 — Fresh project, discarded git history, reused domain-generic packages only

The prior prototype targeted a different chain (Base Sepolia) and provider (Coinbase AgentKit) for
a different hackathon. Rather than reskin that history, this repo was git-initialized fresh. Only
chain/provider-agnostic domain logic (`policy`, `shared`, `risk`, `context`, DB schema shape,
tooling config) was carried over; everything touching custody and execution is being rebuilt
against the Circle Agent Stack on Arc. Full reuse map: `docs/MIGRATION.md`. Rejected alternative:
keep the old history and rename in place — rejected because it misrepresents the scope of the
rebuild to anyone reviewing the repo (judges included), and because the old commits reference a
different hackathon's branding throughout.

### D-002 — Workspace scope renamed `@steward/*` → `@thesauros/*`

Mechanical rename across all packages so no internal identifier leaks the prior project's name.

### D-003 — `apps/worker`'s Base/AgentKit/SERV-era orchestration is kept, wired against typed stubs

`apps/worker/src/{gather,pipeline,loop,runtime,jobs,index}.ts` and `jobs/{confirm,permissionScan}.ts`
(~2,000 lines) implement the gather → propose → verify → pipeline → jobs → loop shape
`docs/MIGRATION.md` calls out as reusable. They don't compile as-is because the wallet/reasoning
modules they import were deleted in the migration. Two options were considered: (a) delete this
orchestration and rebuild it fresh once Phase 2/3 land, or (b) keep it and give `@thesauros/wallet`
/ `@thesauros/reasoning` real-shaped, `NOT_IMPLEMENTED`-erroring stand-ins for exactly the
functions/types it needs. Option (a) was tried first and reverted after review: deleting ~2,000
lines of working orchestration logic to avoid guessing Phase 2/3 designs was a bigger, less
reversible action than the alternative, and the "guessing" concern doesn't actually apply to most
of the missing surface (types, pure hashing, prompt plumbing, a real deterministic heuristic
screen) — only the genuine chain-write/wallet-provider boundary needs to stay a stub. Went with (b):
- `@thesauros/wallet`: `reads.ts`/`reconcile.ts`/`errors.ts` are real (reused as-is); `abi.ts` was
  recreated (trivial ERC-20/ERC-4626/mock-feed view ABIs); `actionRegistry.ts` (`Call`,
  `VaultPosition`, `BuildContext`, `callsHash`) and `spendPermission.ts`'s `parseSpendPermission`
  are real, pure functions; `executor.ts`'s `tripBreaker` is real (just a DB write via
  `@thesauros/db`'s existing `openBreaker`); `revocation.ts`'s `recordRevocationIfRevoked` is real
  (proven by `apps/worker/test/permissionScan.test.ts`, which only mocks the single `isRevoked`
  chain read). Only the genuinely Base/Coinbase-CDP-specific boundary — `readAllowanceRemaining`,
  `buildCalls`, `execute`, `confirmExecution`, `createCdpClient`/`cdpAccountNames`/`cdpTxSender`,
  `demoPriceRefresher` — returns a typed `NOT_IMPLEMENTED` `Result`, which the pipeline already
  treats as "no calls" and fails closed to DENY (R11), so nothing can move funds through this path
  before Phase 2 implements it for real.
- `@thesauros/reasoning`: `compile.ts`/`explain.ts`/`propose.ts`/`schemas.ts`/`heuristics.ts`
  survived the migration with real logic but no supporting infra. Rebuilt `call.ts` (the
  schema-validate + one-repair-retry transport boundary), `serv/client.ts` (`ServClient` interface,
  `LiveServClient` — a clearly-marked not-implemented-yet stub for whichever provider Phase 3 wires
  up — and `FixtureServClient`, a real, tested offline double), `prompts.ts` (loads
  `prompts/*.md`, one per task), and `screen.ts`/`verify.ts` (real implementations — deterministic
  heuristic-first injection screening and a shadow verifier that fails to `UNSURE`, never `AGREE`).
  All of this is proven by `packages/reasoning/test/tasks.test.ts` + `heuristics.test.ts` (62 tests,
  0 stubbed assertions).

### D-004 — Deleted the SERV/OpenServ-branded golden-test fixtures

`packages/reasoning/fixtures/{examples.ts,explain.json}` and `test/golden.test.ts` were recordings
against the old SERV/OpenServ provider (`gpt-5.4-mini`, `inference-api.openserv.ai`), which
CLAUDE.md §9 says must never be reintroduced. They were also unreplayable regardless: the recorded
`requestHash` is keyed off the exact prompt text, and Phase 0 rewrote every prompt for the new
provider, so the one surviving fixture (`explain.json`) could never hash-match again. Deleted
rather than kept as permanently-skipped dead weight; `git log` still has them if a specific old
recorded answer is ever needed for reference.

### D-005 — Rebuilt the missing `scripts/fixtures/arch/` and `scripts/fixtures/lint/` test fixtures

`pnpm check:arch` was crashing outright (not failing a check — throwing on `undefined` stdout)
because the fixture trees its two proof scripts (`check-arch-fixture.mjs`, `check-lint-fixture.mjs`)
spawn `dependency-cruiser`/`eslint` against were never migrated over. Rebuilt both as small,
self-contained trees (their own stub `@thesauros/wallet`/`@thesauros/reasoning`-shaped files,
connected by relative imports so they don't need their own `node_modules`) that trigger exactly the
four named dependency-cruiser rules and the two named eslint purity rules the scripts assert on.

### D-006 — `.env.example`'s Circle/Arc variable names vs. `packages/shared/src/env.ts`'s current schema

`.env.example` already lists the new variable names (`ARC_RPC_URL`, `ARC_CHAIN_ID`,
`CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `REASONING_API_KEY`), but `packages/shared/src/env.ts`'s
zod schema still validates the old Base/CDP/SERV names (`CHAIN_ID`, `RPC_URL_BASE_SEPOLIA`,
`CDP_API_KEY_ID`, `SERV_API_KEY`, `SPEND_PERMISSION_MANAGER_ADDRESS`, …), which `apps/worker`'s
`runtime.ts`/`jobs.ts` still read. Left as-is for Phase 0 (env schema changes belong with Phase 1's
data-model work and Phase 2/3's wallet/reasoning rebuilds, once the real Circle/Arc variable shapes
are being wired up for real) — tracked below as a known issue so Phase 1/2 don't miss it.

### D-007 — Root `package.json`'s `typecheck` script dropped its `scripts/live`/`scripts/demo` checks

Those directories don't exist yet (Phase 5 creates them per `docs/MIGRATION.md`), so
`tsc --noEmit -p scripts/live/tsconfig.json` failed with "path does not exist." Removed both
clauses from the `typecheck` script; Phase 5 should re-add them once those directories (and their
own `tsconfig.json`s) exist.

### D-008 — Reasoning provider kept as OpenServ (SERV); reverses `CLAUDE.md` §9's earlier blanket ban

Human decision, made outside the phase-by-phase build: the reasoning layer (`packages/reasoning`)
stays on OpenServ/SERV rather than moving to a new-to-be-chosen provider. Settlement chain (Arc,
via the Circle Agent Stack) and reasoning provider (OpenServ) are independent choices — I1/I3 only
require that whichever model is used never receives a write tool, which OpenServ never did in the
prior prototype either. `CLAUDE.md` §9 has been updated with an explicit exception for this;
`docs/REASONING.md` and `docs/VERIFY.md` row 12 updated to match.

This **reopens D-004** (which deleted the SERV/OpenServ-branded golden-test fixtures under the
old blanket-ban reading of §9) — those fixtures no longer need to be gone on principle, though
D-004's other stated reason (they were unreplayable regardless, since Phase 0 rewrote every prompt
and the recorded `requestHash` is keyed to the exact old prompt text) still holds, so there's
nothing to actually restore; new golden fixtures should just be recorded fresh against the live
OpenServ client once Phase 3 rebuilds the prompts.

This also corrects a mix-up already present in `docs/VERIFY.md` row 12 before this decision: an
earlier pass had recorded the reasoning-layer provider as "Anthropic Claude, Sonnet, medium
effort," citing `CLAUDE.md` §4. That section is about which model *Claude Code itself* runs as
while *building this repo* — an entirely different, unrelated axis from which LLM the shipped
product calls inside `packages/reasoning` to propose treasury actions to a real user. Whoever
picks this back up in Phase 3: verify OpenServ's API base URL, auth, and model id are still live
before relying on them (the prior credentials were pinned to a different hackathon's platform and
may have lapsed) — that's a real blocker to raise with the human if true, not a reason to quietly
substitute a different provider.

### D-009 — Kept `spend_permissions` alongside the new `paymaster_policies` table, rather than replacing it

`docs/DATA_MODEL.md` frames Paymaster as replacing spend-permission columns outright. But the
`spend_permissions` table is actively read and written by tested, working Phase 0 code
(`packages/wallet/src/revocation.ts`, `apps/worker/src/jobs/permissionScan.ts`, `gather.ts`), and
Circle's Paymaster policy genuinely cannot back that table's `pending`/`approved_onchain`/`revoked`
lifecycle — a Paymaster policy is configured server-side via the Circle API, not owner-signed
on-chain the way a Base Spend Permission is. Ripping the table out now would break real, tested
functionality for a replacement Phase 2 hasn't built yet. Added `paymaster_policies` and
`policies.paymaster_policy_id` as new, additive columns instead; Phase 2 retires `spend_permissions`
once the real Circle Paymaster flow is live and nothing reads it anymore.

### D-010 — R13 kept its Spend-Permission-shaped logic; only its framing changed

`docs/PHASES.md` Phase 1 says the "spend permission exceeded" rule should become "paymaster cap
exceeded." R13 checks `proposal.amount <= state.allowanceRemaining` — a shape that is provider-
agnostic on its face (it is just "does not exceed the remaining allowance," whatever backs the
number). What actually changes in Phase 2 is *how `allowanceRemaining` gets its value*
(`packages/wallet/src/spendPermission.ts`'s `readAllowanceRemaining`, today a Base-specific
`NOT_IMPLEMENTED` stub per Phase 0's D-003) — not R13's comparison itself. Rewrote R13's comment and
`sentences.ts` entry to describe it as the operating-allowance check it actually is, rather than
inventing a second, parallel "paymaster cap" rule that would just duplicate R13's own logic once
Phase 2 supplies a real number.

### D-011 — R-IDLE-SIZING is R08; no new rule was added for it

`docs/PHASES.md` Phase 1 asks for "an idle-cash-into-USYC sizing rule (don't sweep the whole
buffer, respect the liquidity floor from the mandate)." `packages/policy/src/rules/R08.ts` already
denies exactly this for `vault_deposit` (and escalates it for `pay_recipient`): the runway buffer
must still be covered after the action, for any vault, not only a USYC-flavored one — the rule
generalizes over "vault," and USYC is Circle's specific vault-shaped vehicle, not a new proposal
kind or a new sizing dimension. Verified there is no gap by reading R08 rather than assuming the
task description implied uncovered behavior. Adding a second rule with the same logic under a new
name would only create two sources of truth for the same limit (and two things to keep in sync) —
skipped per the "no unrequested abstractions" standard; if a future phase's USYC deposit flow needs
sizing behavior R08 genuinely doesn't cover (e.g. a *target* allocation percentage rather than a
floor), that is new scope to design then, not something to guess at now.

## Known issues

- `packages/shared/src/env.ts` still validates the old Base/CDP/SERV environment variable names
  (see D-006). `apps/worker` boots against these; nothing in Phase 0 exercises a real boot, so this
  is latent, not broken, but Phase 1/2 must update the schema (and `apps/worker/src/runtime.ts`'s
  consumption of it) alongside the real Circle/Arc wiring, not as an afterthought.
- `apps/worker`'s orchestration (`gather`/`pipeline`/`loop`/`jobs`/`runtime`) will not actually run
  end-to-end until Phase 2 (wallet) and Phase 3 (reasoning) replace the `NOT_IMPLEMENTED` stubs
  described in D-003 with real Circle Wallets/Paymaster and LLM-provider implementations.
- `apps/worker/test/fork/{loop,soak}.fork.test.ts` still fork **Base Sepolia** (anvil + a Coinbase
  Smart Wallet spend permission), per `docs/PHASES.md` Phase 2 task 5's own plan to rewrite them
  "against the real testnet" (Arc). They're opt-in (`THESAUROS_FORK=1`) and were left untouched;
  Phase 2 owns rewriting them, not Phase 0. Phase 1's wallet-chain-id correction (5042002/5042 only)
  means their `Policy` fixtures now need an `as unknown as Policy` cast (their `chainId: 84532` is
  intentionally out-of-union — they really do target Base Sepolia today) and their raw
  `chain_id: 84532` wallet inserts would now fail the `wallets_chain_id_check` constraint at runtime
  if run. Left as-is rather than patched piecemeal: Phase 2's rewrite replaces these fixtures
  wholesale anyway.
- `docs/VERIFY.md` row 7 (Paymaster policy revoke propagation time) has no published SLA. Per its
  own fallback: I7's freeze must be enforced by the Policy Engine's own in-app frozen flag (checked
  synchronously before every proposal), not by assuming a Circle-side propagation time — and the
  real revoke-then-retry gap should be measured empirically on Arc testnet during Phase 2.
- `docs/VERIFY.md` row 4's exact App Kit npm package name needs one more doc read
  (`docs.arc.io/app-kit`'s quickstart) before Phase 2 imports it.
- A stray empty `D:STEWARD.tastemaker/` directory exists at the repo root (harmless, untracked,
  likely created by a misdirected path from outside this repo). Not cleaned up this session since
  it's outside `docs/PHASES.md`'s task list; safe to delete whenever noticed.
- Root `package.json` and `packages/wallet/package.json` still list `@coinbase/agentkit` /
  `@coinbase/cdp-sdk` as dependencies even though no source file imports them for real anymore
  (only the Phase 0 architecture-boundary fixture does, deliberately). `apps/web`'s own
  `@coinbase/cdp-sdk` reference was removed in Phase 4 (D-015); the root and `packages/wallet`
  copies are still pending a cleanup pass.

## Next step

Phase 5's code-only tasks (seed + attack scripts) are done. What's left is entirely human actions:
fund the demo agent wallet, pick and configure a public host, record the demo video, and submit
the form — see "Phase 5 progress" above for specifics.
