# TESTING.md — Test strategy & exit gates

## Layers

- **Unit** (`vitest`): every package, especially `packages/policy` (100% branch coverage target,
  maintained from the prior prototype).
- **Adversarial corpus** (`pnpm test:adversarial`, Phase 3): prompt-injection and malformed-output
  cases against `packages/reasoning`; every case must resolve `DENY`/`ESCALATE`, never a silent
  `ALLOW`.
- **Fork tests** (`packages/wallet/test/fork/`, Phase 2): real calls against Arc testnet — confirm
  the Paymaster cap is enforced on-chain, not just in application logic.
- **Component tests** (`apps/web/test/`, Phase 4): the new UI flows.
- **E2E** (`pnpm test:e2e`, stretch): full mandate → execution flow through the running app; if the
  window doesn't allow wiring Playwright, this is a documented known gap, not a silently skipped
  gate.

## Exit gate commands (must all pass at the end of every phase)

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm check:arch
```

Plus phase-specific gates listed in `docs/PHASES.md`. Never mark a phase complete with failing or
skipped tests (per `CLAUDE.md` §9).

## What "done" means for the Policy Engine specifically

Every rule in `docs/POLICY_ENGINE.md`'s catalogue has at least: one test proving it fires on a
proposal that should trigger it, one test proving it does not fire on a proposal that shouldn't,
and one test proving the fail-closed path (malformed/unknown input still resolves DENY/NOOP).
