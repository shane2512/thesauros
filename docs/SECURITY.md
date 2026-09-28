# SECURITY.md — Threat model & custody

Highest-precedence spec in this repo (see `CLAUDE.md` §2). If any other doc conflicts with this
one, this one wins.

## Custody model

Non-custodial: Thesauros's backend never holds a private key with authority over the treasury's
full balance. It holds, at most, the ability to *propose* an action, bounded by:
1. The compiled Policy Engine's rules (per-tx cap, daily cap, allowlist, verdict precedence).
2. The Circle Paymaster policy's on-chain cap, set from that same compiled policy — this is the
   hard backstop if the application layer were compromised or buggy.
3. The owner's ability to freeze/revoke/sweep at any time, independent of Thesauros's own uptime
   (I7).

## Security layers (defense in depth)

| Layer | What it stops |
|---|---|
| 1. Deterministic context gathering | Prevents the model from fabricating input data it wasn't given. |
| 2. Schema-validated proposal output | An LLM output that doesn't parse as a valid proposal shape is dropped, not coerced. |
| 3. Policy Engine (pure, I2) | The actual business-rule enforcement: caps, allowlist, thresholds. No network I/O — can't be fooled by a slow or malicious API response. |
| 4. Risk simulation gate | Catches proposals that pass the static policy but fail a dynamic check (e.g. slippage, depeg state at execution time). |
| 5. On-chain Paymaster cap | The backstop: even a fully compromised backend cannot move more than the cap allows, because the chain itself enforces it. |
| 6. Owner override path | Freeze/revoke/sweep never depend on layers 1–5 being healthy. |

## Threat model (non-exhaustive, extend as Phase 2/3 surface new specifics)

- **Prompt injection** via a malicious mandate, a poisoned counterparty name, or manipulated
  context data: mitigated by layer 1 (deterministic gathering — the model can't inject data that
  wasn't fetched by trusted code) and layer 2/3 (a proposal that tries to route around the
  allowlist or cap fails schema/policy validation regardless of what the model "intended").
- **Compromised reasoning API credentials:** worst case is the model proposes bad actions; layers
  3–5 still hold. This is the entire point of I1/I3.
- **Compromised backend / DB:** worst case an attacker forges proposals; layer 5 (on-chain
  Paymaster cap) is the true worst-case bound, plus the owner's independent freeze path.
- **Replay / double-execution:** mitigated by idempotency (I10) — proposal-hash keyed executions,
  single-use receipt nonces.
- **Counterparty risk drift:** mitigated by I13 — continuous re-screening, not a one-time gate,
  directly answering the hackathon's own RFB 5 framing ("most businesses screen once, at
  onboarding, and never look again").

## Failure matrix

| Component down | Effect |
|---|---|
| Reasoning API | Worker proposes nothing; no new executions; freeze/revoke/sweep still work. |
| Worker process | No new proposals gathered or executed; freeze/revoke/sweep still work (I7 — never route through the worker). |
| Database | Fails closed: no verdict can be recorded, so no execution proceeds (I5). |
| Circle API | No new reads or writes possible; this is a genuine outage, but no funds are at risk beyond what the last-set Paymaster cap already bounds. |

## Verify before relying on

Circle Paymaster policy's exact cap semantics (per-tx vs. rolling-window vs. per-policy-lifetime),
whether a policy revoke is instant or has a propagation delay, and Arc testnet finality time all
need to be confirmed against real behavior in Phase 2 and recorded in `docs/VERIFY.md` — do not
assume they mirror the prior prototype's Spend Permission semantics.
