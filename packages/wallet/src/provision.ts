// Wallet provisioning and the transaction sender. Coinbase CDP (`createCdpClient`/`cdpAccountNames`/
// `cdpTxSender`) is the prior prototype's provider and has no place in a Circle/Arc build (CLAUDE.md
// §9); Phase 2 provisions a Circle Wallet per treasury instead. These stay as clearly-marked
// NotImplementedYet stubs so `apps/worker`'s orchestration keeps compiling against the same shapes
// until Phase 2 replaces them for real.
import { createLogger, err, type Address, type Hex, type Result } from '@thesauros/shared';
import type { Call } from './actionRegistry';

const log = createLogger('wallet');

/** The agent wallet's sender: whatever provider is wired up, this is all `execute()` needs from it. */
export type TxSender = {
  getAddress(): Address;
  send(calls: readonly Call[]): Promise<{ txHash: Hex }>;
};

/** Opaque handle to whichever wallet provider's SDK client is in use. Phase 2: a Circle Wallets client. */
export type WalletProviderClient = { evm: unknown };

export type CreateWalletClientOptions = {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
};

/**
 * Not implemented yet (Phase 2). Returns a client handle rather than throwing so callers that only
 * pass it through at boot (without using it) keep working; every function that would actually use it
 * below fails closed instead.
 */
export function createCdpClient(options: CreateWalletClientOptions): WalletProviderClient {
  void options;
  return { evm: undefined };
}

export type CdpAccountNames = { evmAccount: string; smartAccount: string };

/** Not implemented yet (Phase 2): account naming is specific to the wallet provider chosen there. */
export function cdpAccountNames(userId: string): Result<CdpAccountNames, string> {
  void userId;
  return err(
    'NOT_IMPLEMENTED: cdpAccountNames is Coinbase-CDP-specific; Phase 2 provisions a Circle Wallet instead',
  );
}

export type CdpTxSenderArgs = { cdp: unknown; names: CdpAccountNames; network: string };

/** Not implemented yet (Phase 2). */
export async function cdpTxSender(args: CdpTxSenderArgs): Promise<Result<TxSender, string>> {
  void args;
  return err(
    'NOT_IMPLEMENTED: cdpTxSender is Coinbase-CDP-specific; Phase 2 wires this to Circle Wallets',
  );
}

/** I11-fenced: only ever constructed in DEMO_MODE, on the Arc testnet chain id. */
export type DemoPriceRefresher = {
  setPrice(microUsd: bigint): Promise<Result<Hex, string>>;
};

export type DemoPriceRefresherArgs = {
  cdp: unknown;
  adminAccountName: string;
  feed: Address;
  chainId: number;
  demoMode: boolean;
};

/** Not implemented yet (Phase 2): the demo mock-price refresh needs a real signer to be wired up. */
export function demoPriceRefresher(
  args: DemoPriceRefresherArgs,
): Result<DemoPriceRefresher, string> {
  void args;
  return err(
    'NOT_IMPLEMENTED: demoPriceRefresher needs a Phase 2 signer (Circle Wallets or a local dev key)',
  );
}

/**
 * D-1 (carried over): a wallet SDK's un-awaited telemetry call can reject after the request that
 * triggered it has already returned, which otherwise crashes the Node process. Logging instead of
 * dying is provider-agnostic, so this stays a real implementation, not a stub.
 */
export function installUnhandledRejectionLogger(): void {
  process.on('unhandledRejection', (reason) => {
    log.error({ reason: String(reason) }, 'unhandled rejection (ignored, not crashing)');
  });
}
