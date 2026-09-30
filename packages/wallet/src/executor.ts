// The only module allowed to call a chain-write action, and only with a valid, unexpired, unused
// `AllowReceipt` from the Policy Engine (I1). Real Circle Wallets send path: `buildCalls` builds
// the calls, `TxSender.send` (Circle-backed, from `provision.ts`) submits them, and
// `confirmExecution` polls Circle for the terminal state and cross-checks it against the measured
// on-chain balance deltas before calling anything "confirmed" (5.5 — never trust a status flag
// alone).
import { getAddress, parseAbiItem, type PublicClient } from 'viem';
import { claimExecutionSlot, openBreaker, updateExecution, type Db } from '@thesauros/db';
import {
  err,
  ok,
  type Address,
  type AllowReceipt,
  type Hex,
  type Policy,
  type Proposal,
  type Result,
} from '@thesauros/shared';
import { classifyError, execError, type ExecError } from './errors';
import { buildCalls, callsHash, type BuildContext } from './actionRegistry';
import { CIRCLE_TERMINAL_FAILURE, CIRCLE_TERMINAL_SUCCESS } from './circleStatus';
import type { CircleClient, TxSender } from './provision';

export type ExecuteOutcome = {
  status: 'submitted';
  execution: { id: string };
  /** Circle's own transaction id — the confirmer's handle to poll (stored as `executions.userOpHash`). */
  providerTxId: string;
};

export type ExecuteDeps = { db: Db; sender: TxSender; receiptKey: Uint8Array; now: () => Date };

export type ExecuteArgs = {
  walletId: string;
  decisionId: string;
  proposal: Proposal;
  policy: Policy;
  receipt: AllowReceipt;
  buildContext: BuildContext;
  simulatedCallsHash: Hex;
};

/**
 * Builds the calls again from the same inputs `runPipeline` simulated, refuses to send anything
 * that doesn't hash to what was simulated (I5 — a receipt authorises SPECIFIC calls, not "whatever
 * this proposal happens to build the second time"), writes the execution row BEFORE broadcasting
 * (5.5 — so a crash between send and record still leaves an intent row `reconcile.ts` can close),
 * then hands the calls to the Circle-backed sender.
 */
export async function execute(
  deps: ExecuteDeps,
  args: ExecuteArgs,
): Promise<Result<ExecuteOutcome, ExecError>> {
  const built = buildCalls(args.proposal, args.policy, args.buildContext);
  if (!built.ok)
    return err(execError('BUILD_FAILED', `${built.error.code}: ${built.error.message}`, 'fatal'));

  const calls = built.value;
  const hash = callsHash(calls);
  if (hash !== args.simulatedCallsHash)
    return err(
      execError(
        'CALLS_MISMATCH',
        `rebuilt calls hash ${hash} does not match the simulated/receipted hash ${args.simulatedCallsHash}`,
        'fatal',
      ),
    );
  if (calls.length === 0)
    return err(execError('BUILD_FAILED', 'nothing to execute (empty call set)', 'fatal'));

  const claim = await claimExecutionSlot(deps.db, {
    nonce: args.receipt.nonce,
    issuedAt: new Date(args.receipt.issuedAt),
    usedAt: deps.now(),
    walletId: args.walletId,
    decisionId: args.decisionId,
    proposalHash: args.receipt.proposalHash,
    kind: args.proposal.kind,
    callsHash: hash,
  });
  if (!claim.ok)
    return err(
      execError(
        claim.error.code === 'NONCE_REPLAYED' ? 'RECEIPT_INVALID' : 'DB_UNAVAILABLE',
        claim.error.message,
        'fatal',
      ),
    );

  // I10: a replay of an already-claimed execution returns the prior outcome rather than sending
  // again. `providerTxId` lives in `userOpHash` (the generic "provider-side handle" column).
  if (!claim.value.created) {
    return ok({
      status: 'submitted',
      execution: { id: claim.value.execution.id },
      providerTxId: claim.value.execution.userOpHash ?? '',
    });
  }

  const sent = await deps.sender.send(calls);
  if (!sent.ok) {
    await updateExecution(deps.db, claim.value.execution.id, {
      status: 'failed',
      error: sent.error,
    });
    return err(classifyError(new Error(sent.error)));
  }

  await updateExecution(deps.db, claim.value.execution.id, {
    status: 'submitted',
    userOpHash: sent.value.providerTxId,
  });

  return ok({
    status: 'submitted',
    execution: { id: claim.value.execution.id },
    providerTxId: sent.value.providerTxId,
  });
}

/** Real, not a stub: opening the breaker only writes a DB row (`@thesauros/db`), nothing chain-specific. */
export async function tripBreaker(
  db: Db,
  walletId: string,
  reason: string,
  now: Date,
): Promise<void> {
  await openBreaker(db, walletId, reason, now);
}

export type ConfirmHolders = { agent: Address; treasury: Address; recipient?: Address };
export type ConfirmDeps = {
  db: Db;
  client: CircleClient;
  publicClient: PublicClient;
  now: () => Date;
  timeoutMs?: number;
  pollIntervalMs?: number;
};
export type ConfirmArgs = {
  executionId: string;
  providerTxId: string;
  token: Address;
  holders: ConfirmHolders;
  expectedDeltas: readonly {
    token: Address;
    holder: 'agent' | 'treasury' | 'recipient';
    delta: bigint;
  }[];
  obligationId?: string;
  counterpartyLabel?: string;
};

export type ConfirmOutcome = { status: 'confirmed' | 'failed'; reason?: string; txHash?: Hex };

const TRANSFER = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls Circle for the transaction Circle assigned in `execute()`, then — only once Circle reports
 * an on-chain hash — reads the token's own Transfer logs to confirm the MEASURED effect actually
 * matches `expectedDeltas`. A Circle status of "confirmed" is not, on its own, enough to call an
 * execution settled (5.5): the chain's own logs are the ground truth this checks against.
 */
export async function confirmExecution(
  deps: ConfirmDeps,
  args: ConfirmArgs,
): Promise<Result<ConfirmOutcome, string>> {
  const timeoutMs = deps.timeoutMs ?? 120_000;
  const pollIntervalMs = deps.pollIntervalMs ?? 3_000;
  const deadline = deps.now().getTime() + timeoutMs;

  let state: string | undefined;
  let txHash: Hex | undefined;
  let errorReason: string | undefined;
  for (;;) {
    let tx;
    try {
      tx = await deps.client.getTransaction({ id: args.providerTxId });
    } catch (e) {
      return err(`Circle getTransaction failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const t = tx.data?.transaction;
    state = t?.state;
    txHash = t?.txHash as Hex | undefined;
    errorReason = t?.errorReason;
    if (state && (CIRCLE_TERMINAL_SUCCESS.has(state) || CIRCLE_TERMINAL_FAILURE.has(state))) break;
    if (deps.now().getTime() >= deadline)
      return ok({
        status: 'failed',
        reason: `timed out waiting for Circle state (last: ${state ?? 'unknown'})`,
      });
    await sleep(pollIntervalMs);
  }

  if (!state || CIRCLE_TERMINAL_FAILURE.has(state))
    return ok({
      status: 'failed',
      reason: errorReason ?? `Circle reported ${state ?? 'no state'}`,
    });

  if (!txHash) return ok({ status: 'failed', reason: 'Circle reported success with no tx hash' });

  let logs;
  try {
    logs = await deps.publicClient.getLogs({
      address: args.token,
      event: TRANSFER,
      blockHash: (await deps.publicClient.getTransactionReceipt({ hash: txHash })).blockHash,
    });
  } catch (e) {
    return err(`reading Transfer logs failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const holderAddress = (h: 'agent' | 'treasury' | 'recipient'): Address | undefined =>
    h === 'agent'
      ? args.holders.agent
      : h === 'treasury'
        ? args.holders.treasury
        : args.holders.recipient;

  const measured = new Map<string, bigint>();
  for (const log of logs) {
    const from = getAddress(log.args.from as Address);
    const to = getAddress(log.args.to as Address);
    const value = log.args.value as bigint;
    measured.set(from, (measured.get(from) ?? 0n) - value);
    measured.set(to, (measured.get(to) ?? 0n) + value);
  }

  for (const delta of args.expectedDeltas) {
    const holder = holderAddress(delta.holder);
    if (!holder) continue;
    const seen = measured.get(getAddress(holder)) ?? 0n;
    if (seen !== delta.delta)
      return ok({
        status: 'failed',
        reason: `measured delta for ${delta.holder} (${seen}) does not match expected (${delta.delta})`,
        txHash,
      });
  }

  return ok({ status: 'confirmed', txHash });
}
