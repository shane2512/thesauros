// Circle Wallets bootstrap (I1: the ONLY module allowed to construct a send-capable client —
// enforced by `.dependency-cruiser.cjs`'s `circle-wallets-only-in-wallet-bootstrap` rule).
//
// Custody model (Phase 2 decision, docs/PROGRESS.md): developer-controlled wallets, not
// user-controlled. User-controlled wallets need the end user to complete an MPC signing ceremony
// (social login / PIN) per transaction, which is fundamentally incompatible with an unattended
// worker loop that ticks on a schedule with nobody present. The "non-custodial-by-design" story
// SECURITY.md describes therefore rests entirely on Thesauros's OWN layers (Policy Engine caps,
// the AllowReceipt requirement, the owner's freeze/revoke/sweep path) rather than on Circle's
// wallet type — I1 holds because `execute()` refuses to call this client without a receipt, not
// because Circle is incapable of moving the funds.
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { encodeFunctionData, getAddress } from 'viem';
import {
  createLogger,
  err,
  ok,
  type Address,
  type Hex,
  type Result,
  type Secret,
} from '@thesauros/shared';
import { MOCK_PRICE_FEED_ABI } from './abi';
import type { Call } from './actionRegistry';
import { CIRCLE_TERMINAL_FAILURE, CIRCLE_TERMINAL_SUCCESS } from './circleStatus';

const log = createLogger('wallet');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

export type CreateCircleClientOptions = { apiKey: Secret<string>; entitySecret: Secret<string> };

export function createCircleClient(options: CreateCircleClientOptions): CircleClient {
  return initiateDeveloperControlledWalletsClient({
    apiKey: options.apiKey.reveal(),
    entitySecret: options.entitySecret.reveal(),
  });
}

/** Surfaces Circle's REST error body when present; falls back to the SDK's own message. */
function describeCircleError(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const response = (e as { response?: { data?: unknown } }).response;
    if (response?.data) return JSON.stringify(response.data);
  }
  return e instanceof Error ? e.message : String(e);
}

export type ProvisionedWallet = { walletSetId: string; walletId: string; address: Address };

/**
 * One wallet set + one wallet per treasury, on Arc. Circle has no "find or create" primitive:
 * calling this twice makes two wallets, so the caller MUST persist the returned ids
 * (`wallets.agent_wallet_ref`) and never call this again for a treasury that already has one.
 */
export async function provisionTreasuryWallet(
  client: CircleClient,
  args: { name: string },
): Promise<Result<ProvisionedWallet, string>> {
  try {
    const walletSet = await client.createWalletSet({ name: args.name });
    const walletSetId = walletSet.data?.walletSet?.id;
    if (!walletSetId) return err('createWalletSet returned no wallet set id');

    // Circle's Blockchain enum only lists ARC-TESTNET today (docs/VERIFY.md row 4 update):
    // Arc mainnet isn't a selectable Wallets blockchain yet, independent of I8's own mainnet gate.
    const created = await client.createWallets({
      blockchains: ['ARC-TESTNET'],
      count: 1,
      walletSetId,
    });
    const wallet = created.data?.wallets?.[0];
    if (!wallet) return err('createWallets returned no wallet');

    return ok({ walletSetId, walletId: wallet.id, address: getAddress(wallet.address) });
  } catch (e) {
    return err(`Circle wallet provisioning failed: ${describeCircleError(e)}`);
  }
}

export async function getTreasuryWalletAddress(
  client: CircleClient,
  walletId: string,
): Promise<Result<Address, string>> {
  try {
    const res = await client.getWallet({ id: walletId });
    const address = res.data?.wallet?.address;
    if (!address) return err(`Circle wallet ${walletId} has no address`);
    return ok(getAddress(address));
  } catch (e) {
    return err(`Circle getWallet failed: ${describeCircleError(e)}`);
  }
}

/** The agent wallet's sender: Circle signs and broadcasts — Thesauros never holds this key. */
export type TxSender = {
  getAddress(): Address;
  send(calls: readonly Call[]): Promise<Result<{ providerTxId: string }, string>>;
};

/** How long to wait for one call in a multi-call sequence to reach a terminal Circle state before
 * sending the next. Arc's finality is deterministic and near-instant (docs/VERIFY.md), so this is a
 * generous multiple of that, not a guess. */
const CALL_CONFIRM_TIMEOUT_MS = 20_000;
const CALL_CONFIRM_POLL_MS = 1_000;

/**
 * Poll Circle for one submitted call's terminal state. Never throws: an unresolved/failed check is
 * `Err`, which the caller (`send`) turns into refusing to submit the next dependent call rather than
 * guessing it landed.
 */
async function waitForTerminal(client: CircleClient, id: string): Promise<Result<void, string>> {
  const deadline = Date.now() + CALL_CONFIRM_TIMEOUT_MS;
  for (;;) {
    let state: string | undefined;
    try {
      const res = await client.getTransaction({ id });
      state = res.data?.transaction?.state;
    } catch (e) {
      return err(`Circle getTransaction failed: ${describeCircleError(e)}`);
    }
    if (state && CIRCLE_TERMINAL_SUCCESS.has(state)) return ok(undefined);
    if (state && CIRCLE_TERMINAL_FAILURE.has(state))
      return err(`call ${id} did not confirm (Circle state: ${state})`);
    if (Date.now() >= deadline)
      return err(`call ${id} did not reach a terminal state within ${CALL_CONFIRM_TIMEOUT_MS}ms`);
    await sleep(CALL_CONFIRM_POLL_MS);
  }
}

export function circleTxSender(client: CircleClient, walletId: string, address: Address): TxSender {
  return {
    getAddress: () => address,
    async send(calls) {
      // Circle's developer-controlled EOA/SCA wallets have no native call-batching on Arc today
      // (docs/VERIFY.md row 4): each `Call` becomes its own contract-execution transaction, sent in
      // order. An approve+deposit pair is therefore two on-chain transactions, not one atomic
      // multicall — a known Phase 2 limitation (docs/PROGRESS.md), not a security gap: R18 already
      // requires the approval to be for the exact deposit amount, so a call that failed partway
      // through leaves at most a dangling approval, never a mismatched fund movement.
      //
      // Found live: `createContractExecutionTransaction` only acknowledges SUBMISSION, not on-chain
      // confirmation — firing the next call immediately after can (and did) let a deposit's
      // transaction land before its own approve had actually confirmed, reverting with "ERC20:
      // transfer amount exceeds allowance" even though the approve itself succeeded moments later.
      // Every call but the last is now confirmed before the next is sent; the last call's id is
      // still returned immediately (its own confirmation is `confirmExecution`'s job, 5.5).
      let last: { id: string } | undefined;
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        if (!call) continue;
        try {
          const res = await client.createContractExecutionTransaction({
            walletId,
            contractAddress: call.to,
            callData: call.data,
            ...(call.value > 0n ? { amount: call.value.toString() } : {}),
            fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
          });
          const id = res.data?.id;
          if (!id)
            return err('Circle createContractExecutionTransaction returned no transaction id');
          last = { id };
          if (i < calls.length - 1) {
            const confirmed = await waitForTerminal(client, id);
            if (!confirmed.ok)
              return err(`call #${i} to ${call.to} did not confirm: ${confirmed.error}`);
          }
        } catch (e) {
          return err(`Circle send failed: ${describeCircleError(e)}`);
        }
      }
      if (!last) return err('no calls to send');
      return ok({ providerTxId: last.id });
    },
  };
}

/** I11-fenced: only ever constructed in DEMO_MODE, on the Arc testnet chain id. */
export type DemoPriceRefresher = {
  setPrice(microUsd: bigint): Promise<Result<{ providerTxId: string }, string>>;
};

/** Refreshes the demo MockPriceFeed via the same Circle-signed path everything else uses. */
export function demoPriceRefresher(
  client: CircleClient,
  walletId: string,
  feed: Address,
): DemoPriceRefresher {
  return {
    async setPrice(microUsd: bigint) {
      try {
        const res = await client.createContractExecutionTransaction({
          walletId,
          contractAddress: feed,
          callData: encodeFunctionData({
            abi: MOCK_PRICE_FEED_ABI,
            functionName: 'setPrice',
            args: [microUsd],
          }) as Hex,
          fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
        });
        const id = res.data?.id;
        if (!id) return err('Circle createContractExecutionTransaction returned no transaction id');
        return ok({ providerTxId: id });
      } catch (e) {
        return err(`Circle demo price refresh failed: ${describeCircleError(e)}`);
      }
    },
  };
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
