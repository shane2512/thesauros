// packages/wallet — the only package allowed to touch chain-write actions (I1). Phase 2: real
// Circle Wallets integration. `provision.ts` is the sole bootstrap for a send-capable client
// (enforced by `.dependency-cruiser.cjs`); `executor.ts` is the sole caller of a write action, and
// only with a valid `AllowReceipt`. `readAllowanceRemaining` (Base Spend Permission-specific) and
// `recordRevocationIfRevoked`'s on-chain read stay `NOT_IMPLEMENTED` — Circle has no equivalent
// mechanism to replace them with (docs/PROGRESS.md).
export * from './abi';
export * from './actionRegistry';
export * from './errors';
export * from './executor';
export * from './provision';
export * from './reads';
export * from './reconcile';
export * from './revocation';
export * from './spendPermission';
