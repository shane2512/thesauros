# Verifiable proofs

Everything below can be checked without trusting us: on-chain items link to the public Arc testnet
explorer, contract addresses come from Circle's and Arc's own docs, and the usage numbers come from
the production database via a read-only query you can re-run ([`scripts/proofs.sql`](../scripts/proofs.sql)).

Explorer: **https://explorer.testnet.arc.io** · Every transaction below was re-checked against the explorer API on the snapshot date · Network: Arc testnet · Snapshot: **Oct 16, 2026**

## 1. Pilot: a real team, six payments made by the agent

A five-person college project team used Thesauros to split their monthly app-hosting bill. They signed
a policy compiled from a plain-English mandate; the agent then made every payment on its own, each one
passing the Policy Engine before it was sent. Names are withheld; the transactions are public.

| # | Time (UTC) | Payment | Amount | Transaction |
|---|---|---|---|---|
| 1 | 2026-10-14 18:01 | Member 1 | 95 USDC | [`0x7bac14fa…a33933`](https://explorer.testnet.arc.io/tx/0x7bac14fafb71a7451ac476678c0bbd91f3636121f69b58de01cede1640a33933) |
| 2 | 2026-10-14 18:18 | Member 2 | 95 USDC | [`0xca6dd4c1…980d72`](https://explorer.testnet.arc.io/tx/0xca6dd4c1826beffac62ae2f59abc423c747ec6182020cf3bcb5cada25a980d72) |
| 3 | 2026-10-14 18:23 | Member 3 | 95 USDC | [`0x7890c0f4…52357a`](https://explorer.testnet.arc.io/tx/0x7890c0f4e71332064f6441fd37910cc5ef17bb417dfc6eb6df496cc64452357a) |
| 4 | 2026-10-14 18:23 | Member 4 | 95 USDC | [`0x0d0f47ab…d974ba`](https://explorer.testnet.arc.io/tx/0x0d0f47ab91cf6e7a756637a7050dc334e76fbcc41479f7797aec85dcddd974ba) |
| 5 | 2026-10-14 18:24 | Member 5 | 95 USDC | [`0xdb607646…5cc3bd`](https://explorer.testnet.arc.io/tx/0xdb6076460c65f1c19941fa37de76899cd5d4c688a1748d196650b780e95cc3bd) |
| 6 | 2026-10-14 18:24 | Hosting wallet | 25 USDC | [`0xec09a877…aeaae5`](https://explorer.testnet.arc.io/tx/0xec09a877cde9a8b8ca685fd52f513e8a741542c5b3658fcbe2a5f682514aeae5) |
| | | **Total** | **500 USDC** | all confirmed |

Sent from the team's Circle agent wallet
[`0xC8f3847267b51CF0eD1Ab1801D843a9416d34C8a`](https://explorer.testnet.arc.io/address/0xC8f3847267b51CF0eD1Ab1801D843a9416d34C8a).

## 2. USYC: the agent depositing into Circle's Teller

| Time (UTC) | Action | On-chain result | Transaction |
|---|---|---|---|
| 2026-10-07 11:23 | 9 USDC in → 7.89789 USYC out | success | [`0xac7b8252…fd3a5b`](https://explorer.testnet.arc.io/tx/0xac7b82524a3aa8317d823c5b38f8a014afe510947b21e940783b49fd52fd3a5b) |
| 2026-10-07 14:31 | 100 USDC in → 87.754338 USYC out | success (our confirmation watcher timed out; the chain shows it landed) | [`0xdd003575…6c7144`](https://explorer.testnet.arc.io/tx/0xdd003575e47b392306cde0b4bf150942328e0a3c40f6fffa43f323a4806c7144) |

From agent wallet [`0xD277832fE0b169aed51cB0DF826e0bcEa6bd23e2`](https://explorer.testnet.arc.io/address/0xD277832fE0b169aed51cB0DF826e0bcEa6bd23e2).
Five further deposit attempts that day failed *before* broadcast (no transaction exists); they led to
the fixes for the gas reserve and the post-failure cooldown — see [`PROGRESS.md`](PROGRESS.md).

## 3. First Circle Wallets transfer on Arc

The earliest end-to-end proof that our wallet code (not a mock) signs and broadcasts through Circle
Wallets on Arc: [`0x90abd40e…9aa534`](https://explorer.testnet.arc.io/tx/0x90abd40e5f68837c6108d6b72e92ad08bc57471866bcc7ef25a21bfe569aa534)
(details in [`PROGRESS.md`](PROGRESS.md)).

## 4. Usage (production database, Sep 30 – Oct 16, 2026)

| Metric | Value |
|---|---|
| Users who connected a wallet | 12 |
| Circle agent wallets created | 12 |
| Mandates written | 57 |
| Policy versions signed | 26 |
| Wallets with a signed, live policy | 6 |
| Recipients added | 10 |
| Agent decisions | 24 |
| Policy Engine verdicts | 21 ALLOW · 2 DENY |
| Successful on-chain executions | 8 (6 payments, 2 USYC deposits; the DB marks one deposit `timeout`, the explorer shows success) |
| Append-only audit-log entries | 14,164 |

"Users" counts distinct owner wallets, including our own test wallets.

## 5. Contracts we call (from Arc and Circle docs)

| Contract | Address (Arc testnet) | Source |
|---|---|---|
| USYC token | [`0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C`](https://explorer.testnet.arc.io/address/0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C) | [`VERIFY.md`](VERIFY.md) row 15 |
| USYC Teller | [`0x9fdF14c5B14173D74C08Af27AebFf39240dC105A`](https://explorer.testnet.arc.io/address/0x9fdF14c5B14173D74C08Af27AebFf39240dC105A) | [`VERIFY.md`](VERIFY.md) row 15 |
| USYC Entitlements | [`0xcc205224862c7641930c87679e98999d23c26113`](https://explorer.testnet.arc.io/address/0xcc205224862c7641930c87679e98999d23c26113) | [`VERIFY.md`](VERIFY.md) row 15 |
| Multicall3From (simulation gate) | [`0x522fAf9A91c41c443c66765030741e4AaCe147D0`](https://explorer.testnet.arc.io/address/0x522fAf9A91c41c443c66765030741e4AaCe147D0) | [`VERIFY.md`](VERIFY.md) row 14 |

## 6. Check it yourself

- **Live app:** https://thesauros-wb3.onrender.com — connect MetaMask on Arc testnet and sign a policy.
- **Transactions:** open any link above; each shows the agent wallet as sender and a successful status.
- **Safety claims:** `pnpm test`, `pnpm test:adversarial` (prompt-injection corpus) and `pnpm check:arch`
  (the AI layer cannot import anything that signs) — see [`TESTING.md`](TESTING.md).
- **Usage numbers:** re-run [`scripts/proofs.sql`](../scripts/proofs.sql) against the database.
