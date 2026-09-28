# PROGRESS.md — Living status log & decision log

## Status

**Current phase:** Phase 0 (not yet started — repo scaffold just migrated, nothing implemented
against Arc/Circle yet).

## Decisions (ADR-lite)

### D-001 — Fresh project, discarded git history, reused domain-generic packages only
The prior prototype targeted a different chain (Base Sepolia) and provider (Coinbase AgentKit)
for a different hackathon. Rather than reskin that history, this repo was git-initialized fresh.
Only chain/provider-agnostic domain logic (`policy`, `shared`, `risk`, `context`, DB schema shape,
tooling config) was carried over; everything touching custody and execution is being rebuilt
against the Circle Agent Stack on Arc. Full reuse map: `docs/MIGRATION.md`. Rejected alternative:
keep the old history and rename in place — rejected because it misrepresents the scope of the
rebuild to anyone reviewing the repo (judges included), and because the old commits reference a
different hackathon's branding throughout.

### D-002 — Workspace scope renamed `@steward/*` → `@thesauros/*`
Mechanical rename across all packages so no internal identifier leaks the prior project's name.

## Known issues (as of the migration)

- `packages/wallet/index.ts` and `packages/reasoning/index.ts` still reference exports whose
  implementation files were deleted in the migration (Coinbase AgentKit / SERV client code).
  `pnpm typecheck` will fail until Phase 0 task 3 stubs or removes these.
- `apps/worker/` still calls into the removed wallet/reasoning implementations; will not run until
  Phase 2/3 land.
- `docs/VERIFY.md` has zero rows verified yet — Phase 0 must not be marked complete until every
  row Phase 1 depends on is filled in.

## Next step

Start Phase 0 per `docs/PHASES.md`.
