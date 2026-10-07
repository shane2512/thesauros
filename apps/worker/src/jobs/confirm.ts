// 5.5 — the `exec.confirm` job handler. Registration only: the *scheduling* (who enqueues it, and
// the boot-time resume of unresolved executions) is Phase 6.5/6.6.
//
// The handler is a thin adapter: parse the payload at the boundary (zod), build the deps, call
// `confirmExecution`. It never resends anything — that is the whole point of the confirmer.
import { createPublicClient, getAddress, http, type PublicClient } from 'viem';
import { z } from 'zod';
import type { PgBoss } from 'pg-boss';
import {
  confirmExecution,
  createCircleClient,
  type CircleClient,
  type ConfirmOutcome,
} from '@thesauros/wallet';
import { createLogger, type Env, type Result } from '@thesauros/shared';
import { getExecutionById, updateExecution, type Db } from '@thesauros/db';
import { arcTestnet } from '../runtime';

export const EXEC_CONFIRM_QUEUE = 'exec.confirm';

const zAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const zConfirmJob = z.object({
  executionId: z.string().uuid(),
  /** Optional: the enqueuers don't carry it; the handler reads it from the execution row (`userOpHash`). */
  providerTxId: z.string().min(1).optional(),
  token: zAddress,
  holders: z.object({
    agent: zAddress,
    treasury: zAddress,
    recipient: zAddress.optional(),
  }),
  /** Claimed deltas as decimal strings (JSON has no bigint). */
  expectedDeltas: z.array(
    z.object({
      token: zAddress,
      holder: z.enum(['agent', 'treasury', 'recipient']),
      delta: z.string().regex(/^-?\d+$/),
    }),
  ),
  obligationId: z.string().uuid().optional(),
  counterpartyLabel: z.string().optional(),
});
export type ConfirmJob = z.infer<typeof zConfirmJob>;

type ExecutionPatch = Parameters<typeof updateExecution>[2];

/**
 * What the execution row should say once the confirmer has spoken. `confirmExecution` only reads
 * the chain; without writing this back, an agent-initiated execution stays `submitted` forever
 * even after it landed (or reverted) on chain.
 */
export function confirmPatch(result: Result<ConfirmOutcome, string>, now: Date): ExecutionPatch {
  if (!result.ok) return { status: 'timeout', error: result.error };
  if (result.value.status !== 'confirmed')
    return {
      status: 'failed',
      error: result.value.reason ?? 'the transaction did not confirm on chain',
      ...(result.value.txHash ? { txHash: result.value.txHash } : {}),
    };
  return { status: 'confirmed', txHash: result.value.txHash, confirmedAt: now };
}

export function registerConfirmJob(deps: {
  boss: PgBoss;
  db: Db;
  env: Env;
  publicClient?: PublicClient;
  client?: CircleClient;
}): Promise<void> {
  const log = createLogger('exec.confirm');
  const publicClient =
    deps.publicClient ??
    (createPublicClient({
      chain: arcTestnet,
      transport: http(deps.env.ARC_RPC_URL),
    }) as PublicClient);
  const client =
    deps.client ??
    (deps.env.CIRCLE_API_KEY && deps.env.CIRCLE_ENTITY_SECRET
      ? createCircleClient({
          apiKey: deps.env.CIRCLE_API_KEY,
          entitySecret: deps.env.CIRCLE_ENTITY_SECRET,
        })
      : undefined);

  return (async () => {
    await deps.boss.createQueue(EXEC_CONFIRM_QUEUE);
    await deps.boss.work(EXEC_CONFIRM_QUEUE, async (jobs) => {
      for (const job of jobs) {
        const parsed = zConfirmJob.safeParse(job.data);
        if (!parsed.success) {
          // Fail closed and loudly: a malformed job is a bug, never a silent skip (I5).
          log.error({ jobId: job.id, issues: parsed.error.issues }, 'malformed exec.confirm job');
          throw new Error(`malformed exec.confirm job ${job.id}`);
        }
        if (!client) {
          log.error({ jobId: job.id }, 'no Circle client configured; cannot confirm');
          throw new Error('CIRCLE_API_KEY/CIRCLE_ENTITY_SECRET are required to confirm executions');
        }
        const d = parsed.data;
        const providerTxId =
          d.providerTxId ??
          (await getExecutionById(deps.db, d.executionId))?.userOpHash ??
          undefined;
        if (!providerTxId) {
          log.error({ executionId: d.executionId }, 'no provider transaction id on the execution');
          throw new Error(`execution ${d.executionId} has no provider transaction id to confirm`);
        }
        const result = await confirmExecution(
          { db: deps.db, client, publicClient, now: () => new Date() },
          {
            executionId: d.executionId,
            providerTxId,
            token: getAddress(d.token),
            holders: {
              agent: getAddress(d.holders.agent),
              treasury: getAddress(d.holders.treasury),
              recipient: d.holders.recipient ? getAddress(d.holders.recipient) : undefined,
            },
            expectedDeltas: d.expectedDeltas.map((x) => ({
              token: getAddress(x.token),
              holder: x.holder,
              delta: BigInt(x.delta),
            })),
            obligationId: d.obligationId,
            counterpartyLabel: d.counterpartyLabel,
          },
        );
        await updateExecution(deps.db, d.executionId, confirmPatch(result, new Date()));
        if (!result.ok) {
          log.error({ executionId: d.executionId, error: result.error }, 'confirmer failed');
          throw new Error(result.error);
        }
        log.info({ executionId: d.executionId, status: result.value.status }, 'execution settled');
      }
    });
  })();
}
