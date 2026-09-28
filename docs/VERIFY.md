# VERIFY.md — External facts that MUST be verified before relying on them

Nothing below is confirmed yet. Fill in as each is checked (who checked it, how, and when), per
Phase 0's exit gate. Do not let downstream phases silently assume an unverified row.

| # | Fact | Status | Verified by / method | Fallback if wrong |
|---|---|---|---|---|
| 1 | Arc testnet chain id | TODO | | Block on this — nothing in Phase 1+ can proceed without it |
| 2 | Arc testnet RPC URL (ARC CLI bundled vs. public) | TODO | | |
| 3 | USDC token address on Arc testnet | TODO | | |
| 4 | Exact `@circle-fin/*` npm package names + versions for Wallets/Paymaster/CCTP/Gateway/App Kit | TODO | | |
| 5 | Circle CLI auth flow (API key vs. OAuth, entity secret handling) | TODO | | |
| 6 | Paymaster policy cap semantics (per-tx vs. rolling window vs. lifetime) | TODO | | Phase 2 blocked without this |
| 7 | Paymaster policy revoke propagation time | TODO | | Affects I7's "freeze takes effect immediately" claim |
| 8 | Whether Circle Wallets supports owner-controlled (self-custody-adjacent) vs. developer-controlled only | TODO | | Determines the custody-model Decision recorded in PROGRESS.md |
| 9 | CCTP attestation wait time on Arc testnet | TODO | | |
| 10 | Gateway balance-read consistency model (latency, eventual vs. strong) | TODO | | |
| 11 | USYC redemption settlement time | TODO | | |
| 12 | LLM provider for the reasoning layer (not yet chosen) | TODO | | Phase 3 blocked without this |
| 13 | Arc mainnet chain id (only needed if Phase 5 mainnet gate is exercised) | TODO | | |

## Rule

If reality differs from what any other doc in this repo assumed, use the fallback column here; if
none fits, stop and ask the human rather than silently weakening a security invariant to make an
API work (per `CLAUDE.md` §8).
