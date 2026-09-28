# CLAUDE.md — Thesauros Operating Manual for Claude Code

> Read this file at the start of EVERY session, before touching code.
> This repository is built **only** from the specs in `/docs`. Do not invent scope.

## 1. What we are building (one paragraph)

**Thesauros** (θησαυρός — Greek for "treasury," the storeroom money was kept in) is a
non-custodial-by-design, AI-operated business treasury settled on **Arc**, Circle's
stablecoin-native L1, built for the **Tameion Agents Hackathon** (Canteen × Circle, RFB 1 —
Intelligent Business Treasury, with RFB 5 — Compliance Intelligence as a secondary surface). The
owner writes a plain-English **Mandate**. Thesauros compiles it into a machine **Policy**, then
runs an autonomous loop that keeps idle USDC productive (deposits into USYC, Circle's
yield-bearing money-market token, redeemed exactly when a cash-flow forecast says the money is
needed), pays allowlisted recipients — including across chains via CCTP — on schedule, and screens
every counterparty continuously rather than once at onboarding. **AI reasoning proposes;
deterministic code disposes.** A model output can never move funds by itself: every proposal
passes a pure Policy Engine, a risk/simulation gate, and is capped by a Circle Paymaster-sponsored
transaction limit enforced on-chain. Execution happens through the **Circle Agent Stack**
(Wallets, Paymaster, CCTP, Gateway, USYC, Contracts). Tagline: *"The treasury that reconciles
itself before it pays."*

Hackathon: Tameion Agents Hackathon, hosted by Canteen, platform partner Circle, settlement on
Arc. Submission deadline Oct 10. Judging: Agentic Sophistication (30%), Traction (30%), Circle
tool usage (20%), Innovation (20%). Traction is real: this must be usable by an actual small
business/DAO/solo-founder counterparty with real or testnet USDC moving, not a static demo.

## 2. Source of truth & read order

1. `CLAUDE.md` (this file) — invariants and workflow
2. `docs/PHASES.md` — the ONLY build plan. Work phase by phase (Phase 0–5 for this hackathon).
3. `docs/PROGRESS.md` — current state; update it at the end of every work session
4. `docs/MIGRATION.md` — what carried over from the prior prototype's reusable domain logic
   (policy engine, risk engine, money math, DB shape) versus what had to be rebuilt for Arc/Circle
   (everything touching custody, execution, and the settlement chain)
5. The docs listed under "Read first" for the current phase

Full doc index:

| File | Purpose |
|---|---|
| `docs/PRD.md` | Product requirements, scope, functional requirements (FR-*) |
| `docs/ARCHITECTURE.md` | System design, monorepo layout, stack, runtime flows, env vars |
| `docs/SECURITY.md` | Threat model, custody model, security layers, failure matrix |
| `docs/POLICY_ENGINE.md` | Policy schema, rule catalogue (R-*), verdicts, allow-receipts |
| `docs/REASONING.md` | AI reasoning client, tasks, prompts, schemas, validation, injection defense |
| `docs/CIRCLE_INTEGRATION.md` | Circle Agent Stack setup: Wallets, Paymaster, CCTP, Gateway, USYC, Contracts |
| `docs/DATA_MODEL.md` | Database tables, fields, relations, constraints |
| `docs/API.md` | HTTP routes (web) and internal service interfaces |
| `docs/UX_FLOWS.md` | Screens, states, copy rules, edge cases |
| `docs/TESTING.md` | Test strategy, adversarial corpus, exit-gate commands |
| `docs/DEMO.md` | 3-minute hackathon demo script + seeding + attack scripts |
| `docs/VERIFY.md` | External facts that MUST be verified before relying on them |
| `docs/MIGRATION.md` | Reuse map from the prior prototype |
| `docs/PROGRESS.md` | Living status log + decision log (ADR-lite) |

**Conflict resolution** (higher wins): `SECURITY.md` > `POLICY_ENGINE.md` > `ARCHITECTURE.md` >
`PRD.md` > everything else. If specs are ambiguous, choose the **safer** option, implement it,
and record the decision in `docs/PROGRESS.md` → Decisions.

## 3. Non-negotiable invariants

Breaking any of these is a failed phase, regardless of tests passing.

- **I1 — Reasoning never touches funds.** Only `packages/wallet/src/executor.ts` may invoke Circle
  Agent Stack *write* actions, and only with a valid, unexpired, unused `AllowReceipt` from the
  Policy Engine.
- **I2 — Policy Engine is pure.** `packages/policy` has no network I/O, no LLM imports, no
  `Date.now()` (clock is injected), no randomness, no env access. Enforced by `pnpm check:arch`.
- **I3 — The model gets no write tools.** Never pass a Circle write action to any LLM tool-calling
  API. Context gathering is deterministic code.
- **I4 — Exact-match destinations.** Recipients/contracts/chains must match the allowlist by
  checksummed address + chain-id equality. No ENS resolution at execution time, no
  prefix/suffix "similarity," no inferring a destination chain from a CCTP message alone.
- **I5 — Fail closed.** Verdict precedence `DENY > ESCALATE > ALLOW`. Unknown kind, parse error,
  stale data, thrown exception ⇒ `DENY` or `NOOP`. Never default to `ALLOW`.
- **I6 — Append-only audit.** Every context snapshot, proposal, verification, verdict, execution,
  approval, freeze and revocation writes an `audit_log` row. DB trigger blocks UPDATE/DELETE. This
  is the ledger-vs-agent distinction the hackathon's own brief calls out: a ledger checks debits
  equal credits, not that the agent's reasoning was sound — the audit log is what lets a reviewer
  replay *why*, not just *what*.
- **I7 — Owner always wins.** Freeze, revoke, and sweep-home work even if the model, the reasoning
  API, or the worker is down. They never call the reasoning layer.
- **I8 — Testnet by default.** Chain = Arc testnet (see `docs/VERIFY.md` for the current chain ID
  — verify before hardcoding). Code refuses Arc mainnet unless
  `THESAUROS_ALLOW_MAINNET=true` AND the Phase 5 mainnet gate in `PHASES.md` is signed off by the
  human. Real mainnet USDC traction is worth more for judging (see PRD) but is opt-in, never
  default.
- **I9 — Secrets.** Only in `.env.local` (git-ignored). Never logged (pino redaction), never
  included in LLM prompts, never returned by APIs.
- **I10 — Idempotency.** Every execution is keyed by `proposal_hash`; receipt nonces are single-use
  (unique DB constraint). Retries reuse the key.
- **I11 — Demo overrides are fenced.** Mock prices/rates only when `DEMO_MODE=true` AND chainId is
  the Arc testnet id. The UI shows a persistent "DEMO DATA" banner when active.
- **I12 — Money math.** Token amounts are `bigint` base units. USD values are integer micro-USD
  (`bigint`, 6 decimals). No JS `number` for money, anywhere.
- **I13 — Continuous screening, not a one-time gate.** Compliance screening (RFB 5) re-runs on a
  schedule for every existing counterparty, not only once at onboarding. A counterparty's risk
  tier can change; the policy's per-counterparty limit must react to that, not just the initial
  check.

## 4. Model policy

This build uses **Sonnet at medium effort for every phase and every task**, including the policy
engine, execution, and security-sensitive work. There are no Opus-gated phases and no per-task
model overrides in this project. If you are not running as Sonnet, stop and tell the human.

## 5. Workflow for every phase

1. Read `docs/PROGRESS.md` to find the current phase. Never skip a phase.
2. Read the phase's "Read first" docs in `docs/PHASES.md`.
3. Write a short plan into `docs/PROGRESS.md` under the phase heading (task checklist).
4. Implement tasks **in the listed order**. Write tests alongside code, not after.
5. Run the phase's **Exit Gate** commands. All must pass.
6. Update `docs/PROGRESS.md` (done items, decisions, known issues, next step).
7. **Commit as you go, not in one lump.** Each phase should land as roughly **6 commits**,
   each a coherent, reviewable step (e.g. schema + migration, one package's core logic + its
   tests, one API route + its tests, one UI flow, the exit-gate fix-ups, the docs/progress
   update). Stage and commit **only the files that actually changed or were created for that
   step** — never a blanket `git add -A` that scoops up unrelated files. Conventional commit
   style: `phase-N: <summary>`.
8. **Stop and report** to the human: what was built, gate results, open risks.
   Do not start the next phase until the human says so.

## 6. Commands

```bash
pnpm install          # install workspace
pnpm dev              # web + worker, with local Postgres via docker compose
pnpm build            # build all packages/apps
pnpm typecheck        # tsc --noEmit across workspace
pnpm lint             # eslint
pnpm test             # vitest unit + integration
pnpm test:adversarial # prompt-injection & attack corpus (Phase 2+)
pnpm check:arch       # dependency-cruiser: enforces I1/I2/I3 import boundaries
pnpm db:migrate       # drizzle migrations
pnpm db:seed:demo     # demo seed (Phase 5)
```

## 7. Coding standards

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any`, no `@ts-ignore` without a
  comment + issue.
- Validate every external boundary with **zod** (HTTP input, LLM output, env, RPC responses, DB
  JSON, Circle API responses).
- Return `Result<T, E>` (discriminated union) from domain functions; throw only for programmer
  errors.
- Logging: `pino`, structured, with redaction paths for keys/secrets/signatures.
- Addresses: always checksummed (viem `getAddress()`) before storing or comparing; every stored
  address is paired with a chain id (Arc is multi-chain-aware by design via CCTP/Gateway — an
  address alone is not a unique key).
- Pure functions for anything testable; side effects at the edges.
- Every new module gets tests. Policy Engine target: 100% branch coverage.
- No new dependency without a one-line justification in `PROGRESS.md` → Decisions.

## 8. When things don't match reality

The Circle Agent Stack (Wallets, Paymaster, CCTP, Gateway, USYC, Contracts) and Arc itself are
new and evolve fast during the event window. Items in `docs/VERIFY.md` **must** be verified before
relying on them. If reality differs from what a doc assumes:
- Use the documented **fallback** in `VERIFY.md`.
- If no fallback fits, stop and ask the human. Do not silently weaken a security invariant to make
  an API work.

## 9. Things you must never do

- Never give a model a tool that can sign or send transactions.
- Never add "temporary" bypasses of the Policy Engine (including for demos or tests against real
  RPC).
- Never store or print private keys, Circle API secrets, wallet secrets, or session secrets.
- Never use mainnet funds without the explicit Phase 5 sign-off. Never hardcode an address that
  was not verified in `VERIFY.md`.
- Never mark a phase complete with failing or skipped tests.
- Never expand scope beyond `PRD.md` without the human's approval.
- Never reintroduce the prior prototype's branding or chain (Base, Coinbase AgentKit, the
  Steward name itself) into user-facing copy, docs, or package names — this is a clean rebuild
  for a different chain and a different platform partner, not a reskin.
- **Exception, by explicit decision (see `docs/PROGRESS.md` D-006):** the reasoning *provider*
  is kept as OpenServ/SERV, reused deliberately rather than replaced. Settlement chain (Arc,
  via the Circle Agent Stack) and reasoning provider (OpenServ) are independent choices — I1/I3
  only require that whichever model is used never receives a write tool. "OpenServ" and "SERV"
  may appear in code, docs, and — if it doesn't muddy the Tameion pitch — in demo copy that's
  clear the reasoning brain and the settlement chain are two different partners' tech.
