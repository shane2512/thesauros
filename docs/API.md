# API.md — HTTP routes & internal interfaces

## Web app routes (Next.js, `apps/web/app/api/`) — built in Phase 4

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/nonce` | GET | Issue a sign-in nonce |
| `/api/auth/verify` | POST | Verify signature, create session — carries over the prior project's hard-learned lesson: derive the signed domain from the request's `Host` header, never from `req.url`, if this app ever sits behind a reverse proxy |
| `/api/wallet/provision` | POST | Provision the owner's Circle Wallet treasury |
| `/api/mandate` | POST | Submit mandate text, trigger compilation |
| `/api/policy` | GET/POST | Fetch compiled policy draft / owner signs to activate |
| `/api/policy/recipients` | POST | Add a recipient to the allowlist (address + chain_id) |
| `/api/treasury` | GET | Dashboard: balances (via Gateway), USYC position, pending approvals |
| `/api/audit` | GET | Paginated audit trail |
| `/api/approvals/:id` | POST | Owner approves/rejects an ESCALATE-verdict proposal |
| `/api/freeze` | POST | Owner freeze — never depends on worker/reasoning being up (I7) |
| `/api/revoke` | POST | Owner revokes the Paymaster policy (I7) |
| `/api/sweep` | POST | Owner sweep-to-self (I7) |

## Internal service interfaces (package boundaries, not HTTP)

- `packages/context` → `packages/reasoning`: `buildContext(): Result<Context, Err>`
- `packages/reasoning` → `packages/policy`: `propose(ctx): Result<Proposal[], Err>`
- `packages/policy` → `packages/wallet`: `evaluate(proposal, policy): Verdict` (never network I/O)
- `packages/wallet/src/executor.ts` (only caller of Circle write actions): `execute(receipt):
  Result<ExecutionRecord, Err>`

Exact request/response zod schemas to be written alongside each route in Phase 4 — this doc lists
shape and ordering, not final types.
