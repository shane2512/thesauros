# PROGRESS.md — Living status log & decision log

## Status

**Current phase:** Phase 0 — complete. Exit gate is green (`pnpm install`, `pnpm typecheck`,
`pnpm lint`, `pnpm test`, `pnpm check:arch` all pass; `docs/VERIFY.md` has no unresolved
"TODO: verify" rows). Awaiting human sign-off to start Phase 1.

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
  Phase 2 owns rewriting them, not Phase 0.
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
  (only the Phase 0 architecture-boundary fixture does, deliberately). Left in place because
  `apps/web` still references `@coinbase/cdp-sdk` in `next.config.ts` (Phase 4 scope, untouched
  this session) — removing the dependency now would break that build. Phase 2/4 should drop it
  from every `package.json` once the real Circle SDK packages replace it everywhere.

## Next step

Human sign-off to start Phase 1 (`docs/DATA_MODEL.md`, `docs/POLICY_ENGINE.md`,
`packages/policy/` per `docs/PHASES.md`).
