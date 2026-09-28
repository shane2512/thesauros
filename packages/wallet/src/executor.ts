// The only module allowed to call a chain-write action, and only with a valid, unexpired, unused
// `AllowReceipt` from the Policy Engine (I1). `execute()` itself is not implemented yet: sending the
// built calls through Circle Wallets, sponsored by the Paymaster policy, is Phase 2 work. Until then
// it fails closed — `runPipeline` treats the `Err` as a failed iteration, never as a silent success.
import type { PublicClient } from 'viem';
import { openBreaker, type Db } from '@thesauros/db';
import {
  err,
  type Address,
  type AllowReceipt,
  type Hex,
  type Policy,
  type Proposal,
  type Result,
} from '@thesauros/shared';
import { execError, type ExecError } from './errors';
import type { BuildContext } from './actionRegistry';
import type { TxSender } from './provision';

export type ExecuteOutcome = {
  status: 'submitted' | 'confirmed' | 'failed';
  execution: { id: string };
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

export async function execute(
  deps: ExecuteDeps,
  args: ExecuteArgs,
): Promise<Result<ExecuteOutcome, ExecError>> {
  void deps;
  void args;
  return err(
    execError(
      'BUILD_FAILED',
      'execute() is not implemented yet — see docs/PHASES.md Phase 2 (Circle Wallets/Paymaster send)',
      'fatal',
    ),
  );
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
  publicClient: PublicClient;
  now: () => Date;
  timeoutMs?: number;
  pollIntervalMs?: number;
};
export type ConfirmArgs = {
  executionId: string;
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

export type ConfirmOutcome = { status: 'confirmed' | 'failed'; reason?: string };

/** Not implemented yet (Phase 2): confirming a submitted execution needs a real chain send first. */
export async function confirmExecution(
  deps: ConfirmDeps,
  args: ConfirmArgs,
): Promise<Result<ConfirmOutcome, string>> {
  void deps;
  void args;
  return err(
    'NOT_IMPLEMENTED: confirmExecution needs the Circle/Arc receipt-confirmation implementation (Phase 2)',
  );
}
