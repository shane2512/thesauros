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

## Onboarding script to send to the team

Copy this to the team. It takes about 15 minutes. Everything runs on Arc testnet with test USDC.

> **Trying Thesauros with your team (testnet)**
>
> Thesauros is an AI agent that manages a team's USDC treasury, but it can only act inside rules you write
> in plain English and sign. You stay in control: you can freeze it at any time.
>
> **Before you start:** a browser wallet such as MetaMask, and your team's payment list (who gets paid, how
> much, and on which day of the month).
>
> **1. Connect.** Open https://thesauros-wb3.onrender.com and click Connect wallet. Signing in moves no money.
> If MetaMask opens on the wrong network, approve the switch to Arc Testnet.
>
> **2. Create your agent wallet.** Follow the setup. It creates a separate wallet for the agent. It is not
> your own wallet.
>
> **3. Write your rules.** Describe how your team handles money, in plain sentences. For example:
>
> *Keep 100 USDC liquid. The agent may move up to 50 USDC per transaction and up to 150 USDC per day on its
> own. Ask me before anything over 100 USDC. Pay Asha 40 USDC on the 14th of each month and Ben 25 USDC on
> the 15th.*
>
> Use your own numbers. For a quick test, set one payment's day of the month to today or tomorrow so it is
> due while you try it. Click compile and read the numbers it shows you before you sign. If something is
> wrong, edit the text and compile again. (Leave out the USYC vault: Circle only allows approved wallets to
> deposit into it.)
>
> **4. Add your recipients.** On the Recipients screen add each person with their wallet address. Sign each
> one.
>
> **5. Sign the policy.** Signing makes your rules the only rulebook the agent can follow.
>
> **6. Give the agent some test USDC.** Copy the agent wallet address from your dashboard and get free test
> USDC at https://faucet.circle.com (choose Arc Testnet).
>
> **7. Watch it work.** The agent checks the treasury on its own schedule, so there is nothing to press. Open
> Activity to see what it decided and which rules it checked. Open a decision to see the transaction link.

### Mistakes the compiler catches (and how to fix them)

| What the app says | What it means | Fix |
|---|---|---|
| "is the treasury itself" | A recipient has your own treasury address | Use the contributor's own address |
| "may receive X USDC per transaction, above the policy per-tx limit" | A recipient's cap is higher than the overall per-transaction limit | Lower the recipient's cap, or raise the per-transaction limit |
| "this vault address is already allowlisted" | The same vault was added twice | Keep one |
| "already decided in the last 24h" (in Activity) | The agent will not repeat an identical action within 24 hours | This is the repeat guard working; change the amount or wait |

### Two ways to run a pilot

- **Shadow week (no money moves).** An operator switches the treasury to shadow mode. The agent proposes and
  records everything, the team keeps paying as usual, and the report compares the two. Good when the team
  wants zero risk.
- **Live test (small testnet transactions).** Leave shadow mode off. With the agent wallet funded with test
  USDC, the agent makes real testnet payments and deposits that its signed policy allows. The agent
  checks on its own schedule. Each confirmed action has a transaction link, and `pnpm pilot:report` lists them
  all under "Live transactions".

Only real activity by the team counts. Do not move money between your own wallets to inflate numbers, and say
plainly in any submission that it is testnet with test USDC.
