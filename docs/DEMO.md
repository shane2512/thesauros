# DEMO.md — Demo script (≤3 minutes, Phase 5)

## Scenario

A small DAO/solo-founder treasury on Arc testnet with real USDC.

## Beats

1. (0:00–0:20) Problem framing in one breath: "Cash sitting idle, payments decided on a Tuesday
   spreadsheet, compliance checked once and never again." Cut straight to the product.
2. (0:20–0:50) Connect wallet, write a mandate in plain English, show it compile into an explicit
   numeric policy live — no missing numbers.
3. (0:50–1:30) Sign the policy, cut to the dashboard: idle USDC already moving into USYC, a
   scheduled recipient payment executing on-chain (show the Arc explorer link), the audit trail
   updating in real time.
4. (1:30–2:00) Attack beat: submit a proposal that exceeds the Paymaster cap or targets a
   non-allowlisted address — show it get denied, both in the app and provably on-chain.
5. (2:00–2:30) Compliance beat (RFB 5): a counterparty's risk tier degrades on a scheduled
   re-screen; show its limit clamp automatically, logged in the audit trail, no owner action
   needed.
6. (2:30–2:50) Owner override: freeze the treasury live, show it takes effect immediately and
   independent of the worker/reasoning layer.
7. (2:50–3:00) Close: live link, GitHub repo, one line on traction (real testnet USDC moved,
   and — if achieved — a real counterparty).

## Seeding

`pnpm db:seed:demo` (Phase 5) provisions one demo treasury, one compiled policy, a couple of
allowlisted recipients at varying risk tiers, and enough context history to make the dashboard and
audit trail non-empty on first load.

## Attack script

`pnpm demo:attack` (Phase 5, ported from the prior project's pattern) fires the over-cap and
non-allowlisted-destination proposals used in beat 4, so the denial is reproducible on demand
rather than hoped for live.
