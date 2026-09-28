# UX_FLOWS.md — Screens & states

Fresh UI, built Phase 4 — no reuse of the prior prototype's screens/copy/components (see
`docs/MIGRATION.md`: `apps/web/app`, `components`, `lib`, `generated` were all deleted).

## Screens

1. **Landing** — one-paragraph pitch, "Connect wallet" CTA. No filler nav (no About/Careers/Contact
   placeholder pages — a lesson carried over the hard way from the prior project).
2. **Connect** — wallet connect flow; sign-in verifies ownership.
3. **Mandate composer** — freeform text box + a couple of worked examples the owner can start from;
   submit triggers compilation.
4. **Policy review** — the compiled policy shown as plain numbers (liquidity floor, caps,
   approval threshold, depeg/drawdown thresholds, allowlist) with a copy explanation per field
   (reuse the "what each number means" framing style, it tested well before); owner signs to
   activate.
5. **Dashboard** — live balances (per chain, via Gateway), USYC position and accrued yield,
   pending approvals queue, recent audit trail entries, freeze/revoke/sweep controls always
   visible and always enabled regardless of backend health.
6. **Approval modal** — an ESCALATE-verdict proposal: what it is, why it escalated, approve/reject.
7. **Audit trail** — full append-only history, filterable, each row links context snapshot →
   proposal → verdict → execution.
8. **Compliance panel** (RFB 5 surface) — per-recipient risk tier, last-screened-at, history of
   tier changes.

## Copy rules

- Every number shown to the owner is labeled in plain language, not just a raw field name.
- Demo-mode data (I11) always carries a persistent "DEMO DATA" banner.
- Never claim an action succeeded before its on-chain confirmation is actually observed.

## Edge cases

- Wallet that can't grant a Paymaster policy (analogous to the prior project's "plain EOA can't
  grant a spend permission" class of issue) — verify Circle Wallets' actual constraints in
  Phase 2 and design the blocking/fallback UI only once that's known, not before.
- Freeze mid-execution: in-flight proposal must not execute after freeze is set; verify the race
  is closed in Phase 2's executor tests.
