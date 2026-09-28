// 8.1 — `permission.scan`: notice a spend permission the owner revoked WITHOUT telling Thesauros.
//
// SECURITY §8 lists "owner can also revoke directly in their Coinbase wallet" as a recovery path,
// and §4's flow ends with the owner's own wallet sending `revoke(permission)`. Nothing guarantees
// they then come back and hit `/api/spend-permission/revoked` — they may never open the app again.
// Until Thesauros reads the chain for itself, the dashboard keeps claiming the agent is live and the
// loop keeps proposing actions that can only fail at the manager.
//
// So every ACTIVE_SCAN_CRON this job reads `isRevoked` for each wallet with a non-revoked permission
// and, when the chain disagrees with the database, runs the SAME `recordRevocationIfRevoked` the
// owner-report route runs: audit, mark revoked, freeze, cancel pending approvals.
//
// A separate queue rather than a hitch-hike on `risk.scan`: risk.scan `continue`s past any wallet
// whose `gather` failed, and a revoke is exactly the kind of thing that makes gather fail, so the
// detection would be skipped precisely when it matters most.
//
// I7: this module imports no reasoning and no SERV (enforced by `owner-path-no-reasoning`). It runs
// with the whole reasoning layer dead.
import type { PgBoss } from 'pg-boss';
import type { PublicClient } from 'viem';
import { getAddress } from 'viem';
import { listActiveWalletIds, type Db } from '@thesauros/db';
import { createLogger, type Env } from '@thesauros/shared';
import { recordRevocationIfRevoked } from '@thesauros/wallet';

export const PERMISSION_SCAN_QUEUE = 'permission.scan';
/** Every 5 minutes. A revoke is not a race — the executor's own `isRevoked`/frozen checks are. */
export const PERMISSION_SCAN_CRON = '*/5 * * * *';

/** One pass. Exported so a test can run it without pg-boss. */
export async function scanForRevocations(deps: {
  db: Db;
  publicClient: PublicClient;
  manager: string;
  now?: () => Date;
}): Promise<{ scanned: number; recorded: number; froze: number }> {
  const log = createLogger(PERMISSION_SCAN_QUEUE);
  const now = deps.now ?? (() => new Date());
  const manager = getAddress(deps.manager);
  const counts = { scanned: 0, recorded: 0, froze: 0 };

  for (const walletId of await listActiveWalletIds(deps.db)) {
    counts.scanned += 1;
    const outcome = await recordRevocationIfRevoked({
      db: deps.db,
      publicClient: deps.publicClient,
      manager,
      walletId,
      actor: 'system',
      now: now(),
    });
    if (!outcome.ok) {
      // Fail closed and quietly: a chain we cannot read leaves the permission active, which is the
      // state that keeps the executor's own guards in charge (I5).
      log.warn(
        { walletId, code: outcome.error.code },
        'permission.scan could not check this wallet',
      );
      continue;
    }
    if (outcome.value.state !== 'recorded') continue;
    counts.recorded += 1;
    if (outcome.value.froze) counts.froze += 1;
    log.error(
      {
        walletId,
        permissionHash: outcome.value.permissionHash,
        froze: outcome.value.froze,
        cancelledApprovals: outcome.value.cancelledApprovals,
      },
      'spend permission was revoked on-chain out-of-band; wallet frozen',
    );
  }
  return counts;
}

export async function registerPermissionScanJob(deps: {
  boss: PgBoss;
  db: Db;
  env: Env;
  publicClient: PublicClient;
  now?: () => Date;
}): Promise<void> {
  await deps.boss.createQueue(PERMISSION_SCAN_QUEUE);
  await deps.boss.work(PERMISSION_SCAN_QUEUE, async () => {
    await scanForRevocations({
      db: deps.db,
      publicClient: deps.publicClient,
      manager: deps.env.SPEND_PERMISSION_MANAGER_ADDRESS,
      ...(deps.now ? { now: deps.now } : {}),
    });
  });
  await deps.boss.schedule(PERMISSION_SCAN_QUEUE, PERMISSION_SCAN_CRON);
}
