// 8.6 — `report.weekly`: yield earned, payments made, blocked events, once a week per wallet.
//
// `computeWeeklyReport` is the pure-ish, testable half (injected `windowEnd`, same pattern as every
// other job in this codebase — PHASES 6). `registerWeeklyReportJob` is the thin pg-boss adapter.
//
// Yield: no rate source is wired yet (D-72), so there is no existing APY calc to reuse — this reads
// the two vault snapshots that bracket the window and isolates the price-appreciation portion of the
// END-of-week position:
//   yield = positionAssets_end - positionAssets_end * sharePrice_start / sharePrice_end
// which is algebraically shares_end * (sharePrice_end - sharePrice_start) without needing to know the
// share scale. ponytail: this ignores deposit/withdrawal TIMING within the week (a deposit on day 6
// is credited a full week of "yield" on its own principal, which is 0); a precise figure needs
// per-transaction share-cost tracking. Upgrade path: derive shares from ledger deltas instead of
// snapshot deltas once that bookkeeping exists.
import type { PgBoss } from 'pg-boss';
import {
  deniedVerdictCountSince,
  getUserIdForWallet,
  insertNotification,
  listActiveWalletIds,
  listVaultRows,
  paymentsSummarySince,
  vaultSnapshotAsOf,
  type Db,
} from '@thesauros/db';
import { createLogger } from '@thesauros/shared';

export const WEEKLY_REPORT_QUEUE = 'report.weekly';
/** Monday 08:00 UTC. */
export const WEEKLY_REPORT_CRON = '0 8 * * 1';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const log = createLogger(WEEKLY_REPORT_QUEUE);

export type WeeklyReport = {
  walletId: string;
  windowStart: string;
  windowEnd: string;
  yieldMicroUsd: bigint;
  paymentsMicroUsd: bigint;
  paymentsCount: number;
  blockedCount: number;
};

/** One wallet, one window `[windowEnd - 7d, windowEnd)`. Exported for tests. */
export async function computeWeeklyReport(
  db: Db,
  walletId: string,
  windowEnd: Date,
): Promise<WeeklyReport> {
  const windowStart = new Date(windowEnd.getTime() - WEEK_MS);

  let yieldMicroUsd = 0n;
  for (const v of await listVaultRows(db, walletId)) {
    const start = await vaultSnapshotAsOf(db, walletId, v.id, windowStart);
    const end = await vaultSnapshotAsOf(db, walletId, v.id, windowEnd);
    if (!start || !end || end.sharePrice <= 0n) continue;
    yieldMicroUsd += end.positionAssets - (end.positionAssets * start.sharePrice) / end.sharePrice;
  }

  const payments = await paymentsSummarySince(db, walletId, windowStart, windowEnd);
  const blockedCount = await deniedVerdictCountSince(db, walletId, windowStart, windowEnd);

  return {
    walletId,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    yieldMicroUsd,
    paymentsMicroUsd: payments.totalMicroUsd,
    paymentsCount: payments.count,
    blockedCount,
  };
}

const usd = (microUsd: bigint) => (Number(microUsd) / 1_000_000).toFixed(2);

/** Writes the notification (type 'report'); the payload IS the exportable artifact (task 8.6). */
export async function runWeeklyReport(db: Db, walletId: string, windowEnd: Date): Promise<void> {
  const report = await computeWeeklyReport(db, walletId, windowEnd);
  const userId = await getUserIdForWallet(db, walletId);
  if (!userId) return;
  await insertNotification(db, {
    userId,
    walletId,
    type: 'report',
    title: 'Weekly treasury report',
    body: `Yield $${usd(report.yieldMicroUsd)} · ${report.paymentsCount} payment(s) totalling $${usd(report.paymentsMicroUsd)} · ${report.blockedCount} blocked`,
    payload: {
      ...report,
      yieldMicroUsd: report.yieldMicroUsd.toString(),
      paymentsMicroUsd: report.paymentsMicroUsd.toString(),
    },
  });
}

export async function registerWeeklyReportJob(deps: {
  boss: PgBoss;
  db: Db;
  now?: () => Date;
}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  await deps.boss.createQueue(WEEKLY_REPORT_QUEUE);
  await deps.boss.work(WEEKLY_REPORT_QUEUE, async () => {
    const at = now();
    for (const walletId of await listActiveWalletIds(deps.db)) {
      try {
        await runWeeklyReport(deps.db, walletId, at);
      } catch (e) {
        // Best-effort (RULES): a report failure is observability, never a gate. Log and continue
        // with the next wallet rather than losing the whole week's run over one bad wallet.
        log.warn({ walletId, err: String(e) }, 'weekly report failed for this wallet');
      }
    }
  });
  await deps.boss.schedule(WEEKLY_REPORT_QUEUE, WEEKLY_REPORT_CRON);
}
