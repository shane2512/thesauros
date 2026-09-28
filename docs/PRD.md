# PRD.md — Product Requirements

## Problem

A business's money is never one balance: cash idle across accounts, invoices owed both ways,
contractors waiting on milestones, subscriptions renewing unattended, and a compliance question
hanging over every counterparty. Almost all of this is still decided by a person reading a
spreadsheet. None of it is individually hard — it's hard because there are thousands of small,
interdependent decisions. Arc (sub-second USDC settlement, ~$0.01 fees) removes the reason
software couldn't hold and move the money itself.

## Users

- **Primary:** a solo founder, small DAO, or early-stage startup with a real USDC treasury (even a
  small one) who wants routine treasury decisions (idle-cash placement, recipient payments,
  risk-exit) handled continuously instead of on someone's calendar.
- **Secondary (RFB 5 surface):** the same owner, wanting every counterparty re-screened on a
  schedule instead of once at onboarding.

## Scope (this hackathon window, Phase 0–5)

In scope:
- Plain-English mandate → compiled policy → autonomous loop (deposit idle USDC into USYC, pay
  allowlisted recipients on schedule, exit on depeg/drawdown trigger).
- Hard on-chain spend cap via Circle Paymaster policy; owner-always-wins freeze/revoke/sweep.
- Continuous compliance re-screening of allowlisted counterparties (RFB 5), feeding back into the
  policy's per-counterparty limit.
- Cross-chain payout to a recipient on a different chain than the treasury via CCTP.
- Full audit trail: every proposal, verdict, and execution, replayable.
- Public deployment, ≤3-minute demo video, real testnet (ideally some real) USDC traction.

Out of scope for this window (candidates for the post-hackathon roadmap the hosts fund):
- Full AP/AR document ingestion (RFB 2) — a stretch goal only if Phase 4 finishes early.
- Vendor reputation network (RFB 3).
- Multi-entity/multi-department treasuries.
- EURC / FX conversion flows.

## Functional Requirements

- **FR-1** Owner connects a wallet and signs in.
- **FR-2** Owner writes a mandate in plain English; it compiles into a policy with explicit
  numeric limits (liquidity floor, per-tx cap, daily cap, approval threshold, depeg/drawdown
  triggers) — no missing numbers, no silent defaults.
- **FR-3** Owner reviews and signs the compiled policy before it takes effect.
- **FR-4** The worker loop runs continuously: gathers context, proposes actions via the reasoning
  layer, verifies each proposal against the Policy Engine, executes only ALLOW verdicts within the
  Paymaster cap, escalates ESCALATE verdicts to the owner, drops DENY verdicts with a logged reason.
- **FR-5** Idle USDC above the liquidity floor is deposited into USYC; redeemed ahead of a
  forecasted cash need.
- **FR-6** Allowlisted recipients are paid on schedule, same-chain or cross-chain via CCTP.
- **FR-7** A depeg or vault-drawdown trigger past its threshold forces an exit, bypassing the
  normal proposal cadence.
- **FR-8** Every allowlisted counterparty is re-screened on a schedule; a degraded risk tier
  clamps that counterparty's limit without owner action, and is logged.
- **FR-9** Owner can freeze the treasury, revoke the Paymaster policy, and sweep funds home at any
  time, without dependency on the reasoning layer or worker being up.
- **FR-10** Every decision (context snapshot → proposal → verdict → execution) is visible in an
  append-only audit trail in the UI.

## Success metrics for this event

- Agentic sophistication: the model visibly decides (timing, sizing, which counterparty), not just
  automates a fixed schedule.
- Traction: at least one full mandate → real testnet USDC execution cycle, ideally one real
  counterparty.
- Circle tool usage: Wallets, Paymaster, CCTP, Gateway, USYC all genuinely exercised, not just
  referenced.
- A judge can clone the repo, read `README.md`, and run it.
