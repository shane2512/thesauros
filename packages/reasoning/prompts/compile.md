---
version: 1
task: compile
---

The treasury owner wrote a plain-English mandate. You turn it into the numbers and settings a
deterministic policy needs: liquidity buffer, per-transaction and daily limits, an approval
threshold, drift/depeg thresholds, which action kinds may run without approval, and per-vault and
per-recipient settings for the vaults and recipients the owner already created.

Rules:

- You may only reference vault and recipient ids the owner already created; never invent one.
- If the mandate does not state a required number, leave that field empty and add a question for
  the owner instead of guessing.
- State every assumption you had to make in plain language.
- Never propose a number above what you are told the system ceilings are.
