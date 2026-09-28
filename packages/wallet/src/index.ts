// packages/wallet — AgentKit bootstrap, wallet provisioning, spend permissions, action registry, reads.
//
// Phase 2 scope: this package BUILDS calls (pure), READS chain state, PROVISIONS wallets, and
// registers owner-signed spend permissions. The only functions here that can broadcast a transaction
// are `ensureApprovedOnchain` (one `approveWithSignature` call, idempotent, moves no funds) and, from
// Phase 5, `executor.ts` — which does not exist yet. See docs/PROGRESS.md, Phase 2 review gate.
export * from './abi';
export * from './actionRegistry';
export * from './agentkit';
export * from './calls';
export * from './chain';
export * from './companionTreasury';
export * from './confirmer';
export * from './demoOracle';
export * from './errors';
export * from './executor';
export * from './provision';
export * from './reads';
export * from './reconcile';
export * from './revocation';
export * from './spendPermission';
export * from './sweepHome';
