// 5.5 — the `exec.confirm` job handler. Registration only: the *scheduling* (who enqueues it, and
// the boot-time resume of unresolved executions) is Phase 6.5/6.6.
//
// The handler is a thin adapter: parse the payload at the boundary (zod), build the deps, call
// `confirmExecution`. It never resends anything — that is the whole point of the confirmer.
import { createPublicClient, getAddress, http, type PublicClient } from 'viem';
import { baseSepolia } from 'viem/chains';
import { z } from 'zod';
import type { PgBoss } from 'pg-boss';
import { confirmExecution } from '@thesauros/wallet';
import { createLogger, type Env } from '@thesauros/shared';
import type { Db } from '@thesauros/db';

export const EXEC_CONFIRM_QUEUE = 'exec.confirm';

const zAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const zConfirmJob = z.object({
  executionId: z.string().uuid(),
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

export function registerConfirmJob(deps: {
  boss: PgBoss;
  db: Db;
  env: Env;
  publicClient?: PublicClient;
}): Promise<void> {
  const log = createLogger('exec.confirm');
  const publicClient =
    deps.publicClient ??
    (createPublicClient({
      chain: baseSepolia,
      transport: http(deps.env.RPC_URL_BASE_SEPOLIA),
    }) as PublicClient);

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
        const d = parsed.data;
        const result = await confirmExecution(
          { db: deps.db, publicClient, now: () => new Date() },
          {
            executionId: d.executionId,
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
        if (!result.ok) {
          log.error({ executionId: d.executionId, error: result.error }, 'confirmer failed');
          throw new Error(result.error);
        }
        log.info({ executionId: d.executionId, status: result.value.status }, 'execution settled');
      }
    });
  })();
}
