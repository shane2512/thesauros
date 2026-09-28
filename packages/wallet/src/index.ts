// packages/wallet — the only package allowed to touch chain-write actions (I1). Phase 0 status: the
// reads (`reads.ts`), the crash-window reconciliation (`reconcile.ts`), the error taxonomy
// (`errors.ts`), the pure call-hashing (`actionRegistry.ts`) and the breaker (`executor.ts`'s
// `tripBreaker`) are real. Everything that would actually build a Circle/Arc call, send it, or talk
// to a wallet provider is a clearly-marked NotImplementedYet stub — see docs/PHASES.md Phase 2.
export * from './abi';
export * from './actionRegistry';
export * from './errors';
export * from './executor';
export * from './provision';
export * from './reads';
export * from './reconcile';
export * from './revocation';
export * from './spendPermission';
