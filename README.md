# Thesauros

The treasury that reconciles itself before it pays.

Thesauros is a non-custodial, AI-operated business treasury settled on **Arc**, Circle's
stablecoin-native L1. Write a plain-English mandate; Thesauros compiles it into an explicit,
numeric policy; an autonomous loop then keeps idle USDC productive in USYC, pays allowlisted
recipients on schedule (same-chain or cross-chain via CCTP), and continuously re-screens every
counterparty rather than checking them once at onboarding. AI reasoning proposes — a pure,
auditable Policy Engine and an on-chain Circle Paymaster cap dispose. The owner can freeze, revoke,
or sweep the treasury home at any time, independent of whether any part of the AI stack is up.

Built for the **Tameion Agents Hackathon** (Canteen × Circle).

## Stack

Next.js (web) + a worker loop, TypeScript monorepo (pnpm + turbo), Postgres (Drizzle), Circle
Agent Stack (Wallets, Paymaster, CCTP, Gateway, USYC) on Arc.

## Getting started

```bash
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

See `CLAUDE.md` for the full build plan and invariants, `docs/PHASES.md` for the phase-by-phase
roadmap, and `docs/VERIFY.md` for what's been confirmed against the live Circle/Arc stack so far.
