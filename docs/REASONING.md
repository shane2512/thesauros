# REASONING.md — AI reasoning layer

Rebuilds `packages/reasoning/` against a to-be-verified LLM provider (see `docs/VERIFY.md`) for
Thesauros's own task set. Replaces the prior prototype's SERV-specific client — nothing about that
client's API shape is reusable, only the *pattern* below.

## The pattern (unchanged from prior prototype, this is the load-bearing invariant)

Deterministic context in → schema-validated structured output out. The reasoning layer:
- **Never** receives a tool that can sign or send a transaction (I3).
- **Never** decides the final verdict — it proposes, `packages/policy` disposes (I1).
- Produces output validated against a zod schema; anything that fails validation is treated as a
  parse error and fails closed (I5), not retried into a looser shape.

## Tasks

1. **Mandate compilation** (`compile.ts`) — plain-English mandate → the policy schema in
   `docs/POLICY_ENGINE.md`, with every numeric field populated. If the mandate is ambiguous about
   a required number, the task fails closed and asks the owner to clarify — it must never invent a
   default.
2. **Action proposal** (`propose.ts`) — given gathered context, propose zero or more actions
   (deposit-to-USYC, redeem-from-USYC, pay-recipient, exit-on-trigger). Each proposal is a
   structured object, never freeform text with intent baked in.
3. **Compliance screening** (new for this project, Phase 3, RFB 5) — given a counterparty's
   on-chain history and any available off-chain signal, produce a risk-tier verdict. This task's
   output feeds R-SCREEN-DEGRADED in the Policy Engine; it is explicitly *not* a payment
   authorization and this module must never be reachable from `executor.ts`.

## Prompt-injection defense (I3, layer 1–2 of `docs/SECURITY.md`)

- Context is built exclusively by `packages/context` from trusted sources (DB, RPC, Circle API) —
  a mandate's freeform text or a counterparty's on-chain metadata can appear *in* the context but
  is always clearly delimited and never able to alter what tools/actions are available.
- The adversarial test corpus (rebuilt in Phase 3, mirroring the deleted
  `packages/reasoning/adversarial/`) exercises injected instructions inside mandate text,
  counterparty labels, and simulated API responses, asserting every case resolves to `DENY` or
  `ESCALATE`, never a silent `ALLOW`.

## Provider

Not yet pinned — verify in Phase 0/3 and record in `docs/VERIFY.md`. Do not assume the prior
project's provider (SERV) is available; it was specific to a different hackathon's platform.
