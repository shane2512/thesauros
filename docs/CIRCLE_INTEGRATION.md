# CIRCLE_INTEGRATION.md — Circle Agent Stack integration

Replaces the deleted `AGENTKIT_INTEGRATION.md`. Everything here is provisional until Phase 0/2
verifies it against the real SDKs — the hackathon's own stack is new enough that docs and reality
may diverge; treat every concrete API name below as "best guess, confirm before relying on it."

## Setup (per the hackathon's Get Started steps)

```bash
uv tool install git+https://github.com/the-canteen-dev/ARC-cli
npm install -g @circle-fin/cli
```
ARC CLI bundles RPC access to a Canteen-hosted Arc testnet plus Arc repos/docs as agent context.
Circle CLI is the unified interface for agent wallets, x402-style payments, and crosschain USDC
transfers. Confirm current package names/versions in Phase 0 — do not hardcode a version without
checking.

## Components used, and where

| Circle component | Used for | Package |
|---|---|---|
| **Wallets** | The treasury's own wallet, provisioned per business | `packages/wallet/src/provision.ts` |
| **Paymaster** | The on-chain spend cap (I1's backstop) — USDC-denominated gas, sponsor mode set per the compiled policy | `packages/wallet/src/executor.ts` |
| **CCTP** | Cross-chain payouts when a recipient's allowlisted chain differs from the treasury's | `packages/wallet/src/` (CCTP module, Phase 2) |
| **Gateway** | Unified cross-chain balance read — the single honest view of "what does this business actually hold" that the reasoning layer's context depends on | `packages/context/build.ts` |
| **USYC** | The idle-cash yield instrument — deposit/redeem sized by the R-IDLE-SIZING policy rule | `packages/wallet/src/` (USYC module, Phase 2) |
| **Contracts** | Any budget-rule or milestone-escrow logic that needs to live on-chain rather than in the app's Policy Engine alone (stretch, only if Phase 2 has room) | TBD |

Reference implementations worth reading before implementing (not copying wholesale — this repo's
shape is different): `circlefin/arc-fintech` (multichain treasury, closest analog to RFB 1),
`circlefin/arc-multichain-wallet`, `circlefin/arc-nanopayments`.

## What must be verified before Phase 2 starts

- Exact Paymaster policy API: how a cap is set, whether it's per-transaction or a rolling window,
  how revoke propagates, whether sponsor-mode requires pre-funding.
- Exact CCTP flow for this SDK version: attestation wait time, whether it's abstracted by the App
  Kit "Bridge" kit or needs raw CCTP calls.
- Gateway's actual balance-read latency/consistency model (is it eventually consistent across
  chains, and if so by how much — this affects how fresh `packages/context` data can be treated
  as).
- USYC's redemption settlement time (affects how far ahead of a forecasted cash need a redeem must
  be triggered).

Record findings in `docs/VERIFY.md` as they're confirmed.
