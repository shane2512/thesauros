# Running a shadow-week pilot

A shadow week lets a real team try Thesauros with no risk: Thesauros proposes every payment and idle-cash
move, the Policy Engine returns a verdict for each, and nothing is ever sent. The team keeps paying the way
it does today. At the end the report lines up what Thesauros proposed against what the team actually paid.

## Setup (about 15 minutes, on a call)

1. Ask first: how do they pay contributors today, what went wrong last time, how much cash sits idle?
2. The team connects a wallet on the live app and creates the agent wallet.
3. Write their mandate with them in plain English: per-payment limit, daily limit, cash buffer, approval
   threshold, and the contributors with their payment day and amount. Add each recipient, review the
   compiled numbers and sign.
4. Fund the agent wallet with a little testnet USDC from https://faucet.circle.com (Arc Testnet). Shadow mode
   never sends it, but the simulation step needs a balance to test the proposal against.
5. Switch the treasury to shadow mode (operator, with the team's consent):

   ```bash
   pnpm pilot:shadow <ownerAddress | walletId> on
   ```

## At the end of the week

The team exports what they actually paid as `paid.csv`:

```
date,recipient,amount
2026-10-15,Asha,500
```

Then:

```bash
pnpm pilot:report <ownerAddress | walletId> --paid paid.csv --team "Team name" --days 7
```

The report lists payments that matched, ones Thesauros proposed that the team did not pay, ones the team paid
that Thesauros did not propose, possible double payments in the team's own ledger, proposals blocked by the
rules (with rule codes), and the idle cash Thesauros would have put to work. The yield figure is an estimate
at an assumed annual rate, not a result.

Switch shadow mode off with `pnpm pilot:shadow <ownerAddress | walletId> off`.

## Ground rules

- Report only what really happened. Name a team and link their site or X only with their permission.
- State that it is testnet with test USDC.
