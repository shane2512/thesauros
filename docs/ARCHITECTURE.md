# ARCHITECTURE.md — System design

## Monorepo layout

```
apps/
  web/       Next.js app — owner-facing UI + API routes
  worker/    long-running loop: gather -> propose -> verify -> execute
packages/
  policy/    pure Policy Engine (I2) — reused from prior prototype, retuned in Phase 1
  shared/    money math, address+chain helpers, Result<T,E>, logger, env, signing
  risk/      depeg/drawdown triggers, simulation gate — reused, oracle sources rebuilt
  context/   deterministic context gathering for the reasoning layer
  reasoning/ AI reasoning client — rebuilt Phase 3, never gets write tools (I3)
  wallet/    Circle Agent Stack integration — rebuilt Phase 2, only executor.ts writes (I1)
  db/        Drizzle schema + repos, append-only audit trigger
docs/        specs (this directory)
scripts/     demo/seed scripts (Phase 5)
```

## Runtime flow

1. **Gather** (`packages/context`): deterministic read of treasury balances (via Circle Gateway's
   unified cross-chain balance), USYC position, pending payables, counterparty risk tiers, market
   data (USDC peg, USYC share price).
2. **Propose** (`packages/reasoning`): context in, a schema-validated proposal out. The model never
   sees a write tool — it only ever returns structured data that the deterministic layers below
   interpret.
3. **Verify** (`packages/policy` + `packages/risk`): the proposal is evaluated against the
   compiled policy's rules and the risk simulation gate. Verdict precedence: `DENY > ESCALATE >
   ALLOW` (I5). An `ALLOW` verdict produces a signed, single-use `AllowReceipt`.
4. **Execute** (`packages/wallet/src/executor.ts`): the only module allowed to call a Circle write
   action, and only with a valid unexpired unused `AllowReceipt`. The Paymaster policy's on-chain
   cap is the last line of defense if every layer above it were somehow wrong.
5. **Audit** (`packages/db`): every step of 1–4 writes an append-only row.

## Multi-chain model (new vs. the prior single-chain prototype)

Arc's Circle Agent Stack is chain-abstracted by design (Gateway's unified balance, CCTP's native
cross-chain burn/mint). This repo treats `(address, chainId)` as the unit of identity everywhere —
never a bare address — because the same address can hold a materially different balance state on
Arc versus a CCTP-connected chain, and a payout's destination chain is part of the policy's
allowlist match, not an afterthought (I4).

## Custody model

Non-custodial by design: the treasury lives in a Circle Wallet whose policy (and, if
owner-controlled, whose key) belongs to the business, not to Thesauros. The reasoning layer never
holds a key. The only thing Thesauros's backend can do unilaterally is *propose*; execution
requires passing the Policy Engine and staying under the Paymaster cap, and the owner can freeze
or revoke that cap at any time without any dependency on Thesauros's own uptime (I7).

## Env vars (fill in as verified — see `docs/VERIFY.md`)

```
DATABASE_URL=
ARC_RPC_URL=
ARC_CHAIN_ID=
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
REASONING_API_KEY=            # provider TBD, see VERIFY.md
SESSION_SECRET=
DEMO_MODE=
THESAUROS_ALLOW_MAINNET=
```
