// 5.5 (crash window) — what closes the gap between "we sent it" and "we recorded that we sent it".
//
// The executor writes the execution row with status `pending` BEFORE broadcasting. So on boot,
// every `pending`/`submitted` row is a question:
//   - it has a userOp/tx hash  ⇒ hand it to the confirmer, which polls it to a terminal state;
//   - it has no hash at all    ⇒ we do not know whether the send happened. We look at the chain.
//
// The lookup is deliberately blunt and deliberately pessimistic: if the agent wallet moved the
// policy token at all since the row was created, we mark the execution `timeout`
// (UNCERTAIN / needs-reconcile) and alert. We NEVER resend — a resend needs a new simulation and a
// new verdict (PHASES "Do not"). Only when the chain shows no matching movement at all do we mark
// the row `failed`, which is the state that allows the loop to propose the action again.
//
// The boot hook that calls this belongs to Phase 6.6; the lookup itself lives here so the crash
// window is closed by code, not by a promise in a document.
import { getAddress, parseAbiItem, type Hex, type PublicClient } from 'viem';
import {
  appendAudit,
  listUnresolvedExecutions,
  updateExecution,
  type Db,
  type ExecutionRow,
} from '@thesauros/db';
import { err, ok, type Address, type Result } from '@thesauros/shared';

const TRANSFER = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

/** Base blocks are ~2 s. We over-scan rather than under-scan, capped so a boot cannot stall. */
const BLOCK_TIME_MS = 2_000;
const MAX_LOOKBACK_BLOCKS = 5_000n;

export type ReconcileDeps = {
  db: Db;
  publicClient: PublicClient;
  now: () => Date;
  /** The policy token whose movements identify an agent-wallet send (USDC in the MVP). */
  token: Address;
};

export type ReconcileOutcome =
  /** A hash exists: the confirmer owns this row. Nothing decided here. */
  | { status: 'has-hash'; execution: ExecutionRow; hash: Hex }
  /** Chain activity found for the agent wallet in the window: UNCERTAIN, alerted, never resent. */
  | { status: 'uncertain'; execution: ExecutionRow; candidates: Hex[] }
  /** No activity at all: the send never happened. Safe to re-propose with a new verdict. */
  | { status: 'never-sent'; execution: ExecutionRow };

/**
 * Decide what happened to one unresolved execution. Never sends anything.
 */
export async function reconcileExecution(
  deps: ReconcileDeps,
  execution: ExecutionRow,
  agentWalletAddress: Address,
): Promise<Result<ReconcileOutcome, string>> {
  const hash = (execution.txHash ?? execution.userOpHash) as Hex | null;
  if (hash) return ok({ status: 'has-hash', execution, hash });

  const agent = getAddress(agentWalletAddress);
  const elapsedMs = Math.max(0, deps.now().getTime() - execution.createdAt.getTime());
  let fromBlock: bigint;
  try {
    const head = await deps.publicClient.getBlockNumber();
    const lookback = BigInt(Math.ceil(elapsedMs / BLOCK_TIME_MS)) + 10n;
    const window = lookback > MAX_LOOKBACK_BLOCKS ? MAX_LOOKBACK_BLOCKS : lookback;
    fromBlock = head > window ? head - window : 0n;
  } catch (e) {
    return err(`cannot read the head block: ${String(e)}`);
  }

  let candidates: Hex[];
  try {
    const [out, into] = await Promise.all([
      deps.publicClient.getLogs({
        address: deps.token,
        event: TRANSFER,
        args: { from: agent },
        fromBlock,
        toBlock: 'latest',
      }),
      deps.publicClient.getLogs({
        address: deps.token,
        event: TRANSFER,
        args: { to: agent },
        fromBlock,
        toBlock: 'latest',
      }),
    ]);
    candidates = [...out, ...into]
      .map((l) => l.transactionHash)
      .filter((h): h is Hex => h !== null);
  } catch (e) {
    return err(`cannot scan for agent-wallet activity: ${String(e)}`);
  }

  const now = deps.now();
  if (candidates.length > 0) {
    const row = await updateExecution(deps.db, execution.id, {
      status: 'timeout',
      error: `no hash stored, but ${candidates.length} agent-wallet transfer(s) found since the row was created — needs manual reconciliation`,
    });
    const audited = await appendAudit(deps.db, {
      walletId: execution.walletId,
      actor: 'system',
      event: 'EXECUTION_TIMEOUT',
      entityType: 'execution',
      entityId: execution.id,
      payload: {
        reason: 'crash window',
        candidates: [...new Set(candidates)],
        needsReconcile: true,
      },
      createdAt: now,
    });
    if (!audited.ok) return err(audited.error.message);
    return ok({ status: 'uncertain', execution: row ?? execution, candidates });
  }

  const row = await updateExecution(deps.db, execution.id, {
    status: 'failed',
    error: 'no transaction hash and no on-chain activity: the send never happened',
  });
  const audited = await appendAudit(deps.db, {
    walletId: execution.walletId,
    actor: 'system',
    event: 'EXECUTION_FAILED',
    entityType: 'execution',
    entityId: execution.id,
    payload: { reason: 'crash window: never sent', fromBlock: fromBlock.toString() },
    createdAt: now,
  });
  if (!audited.ok) return err(audited.error.message);
  return ok({ status: 'never-sent', execution: row ?? execution });
}

/** Every unresolved execution, oldest first. Phase 6.6 calls this on worker boot. */
export async function listCrashWindow(db: Db, walletId?: string): Promise<ExecutionRow[]> {
  return listUnresolvedExecutions(db, walletId);
}
