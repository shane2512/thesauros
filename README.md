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
cp .env.example .env.local   # fill in CIRCLE_API_KEY/CIRCLE_ENTITY_SECRET, SERV_API_KEY,
                              # SESSION_SECRET/RECEIPT_HMAC_SECRET (see .env.example for how)
docker compose up -d
pnpm db:migrate
pnpm dev                     # web on :3000, worker in the background
```

Circle credentials come from the [Developer Console](https://console.circle.com) (create a
developer-controlled wallet API key + register an Entity Secret); OpenServ credentials from
[openserv.ai](https://openserv.ai). Without them the web UI still runs — sign-in, the dashboard and
the audit trail all work — but wallet provisioning, mandate compilation and the autonomous loop
need real keys.

### Seeing it work without connecting your own wallet

```bash
pnpm db:seed:demo          # provisions a real Circle testnet treasury + policy + recipients
pnpm demo:attack <walletId printed above> <a seeded recipientId>
```

`db:seed:demo` prints the demo agent wallet's address — fund it with testnet USDC to see the
autonomous loop actually move money. `demo:attack` fires the two denial cases from
`docs/DEMO.md`'s beat 4 (an over-cap payment and a payment to a non-allowlisted address) through
the real Policy Engine pipeline and prints the `DENY` verdict for each, with the rule code that
caught it (R06, R05) — no UI or wallet connection required.

### Exit gate

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm check:arch && pnpm build
```

See `CLAUDE.md` for the full build plan and invariants, `docs/PHASES.md` for the phase-by-phase
roadmap, `docs/DEMO.md` for the 3-minute demo script, and `docs/VERIFY.md` for what's been
confirmed against the live Circle/Arc stack so far.
