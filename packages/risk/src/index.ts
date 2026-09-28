// packages/risk — the risk gate (SECURITY §3 Layer 4): simulation, price adapters, risk triggers.
// Imports `shared` and viem only; never `wallet` or `reasoning` (ARCHITECTURE §2, enforced by
// `pnpm check:arch`). Nothing here can send a transaction.
export * from './oracle';
export * from './simulate';
export * from './triggers';
