// RFB 5 / I13 — `screening.scan`: continuous compliance re-screening, not a one-time onboarding
// gate. Every cadence, every active wallet's recipients whose last screen is stale (or who have
// never been screened) get a fresh verdict from the reasoning layer, written to the append-only
// `screens` table and cached on `recipients.riskTier` for `packages/policy`'s R22 to read.
//
// This is a normal worker job, not an owner-path module: it is explicitly allowed to use reasoning
// (unlike `permission.scan`, whose whole point is to work with reasoning dead). It never reaches
// `executor.ts` — a risk-tier verdict clamps a cap the Policy Engine enforces, it never moves money.
import type { PgBoss } from 'pg-boss';
import {
  appendAudit,
  listActiveWalletIds,
  listRecipients,
  recordCounterpartyScreen,
  type Db,
} from '@thesauros/db';
import { screenCounterparty, type ServClient } from '@thesauros/reasoning';
import { createLogger } from '@thesauros/shared';

export const SCREENING_SCAN_QUEUE = 'screening.scan';
/** Every 30 minutes; each recipient itself is only actually re-screened once per SCREEN_STALE_MS. */
export const SCREENING_SCAN_CRON = '*/30 * * * *';
/** How long a screen stays fresh before the next scan re-screens it (RFB 5: not a one-time gate). */
export const SCREEN_STALE_MS = 24 * 3_600_000;

const log = createLogger(SCREENING_SCAN_QUEUE);

export type ScreeningDeps = {
  db: Db;
  client: ServClient;
  model: string;
  now?: () => Date;
};

/** One pass. Exported so a test can run it without pg-boss. */
export async function scanForCounterpartyRisk(
  deps: ScreeningDeps,
): Promise<{ scanned: number; screened: number; changed: number }> {
  const now = deps.now ?? (() => new Date());
  const counts = { scanned: 0, screened: 0, changed: 0 };

  for (const walletId of await listActiveWalletIds(deps.db)) {
    for (const recipient of await listRecipients(deps.db, walletId)) {
      counts.scanned += 1;
      const staleSince = now().getTime() - SCREEN_STALE_MS;
      if (recipient.lastScreenedAt && recipient.lastScreenedAt.getTime() > staleSince) continue;

      const outcome = await screenCounterparty({
        client: deps.client,
        model: deps.model,
        label: recipient.label,
        address: recipient.address,
        chainId: recipient.chainId,
        previousTier: recipient.riskTier,
        // Honest about what's actually gathered today: tenure on the allowlist. Richer signals
        // (sanctions-list lookups, on-chain activity analysis) are future work, not faked here.
        signals: [`on the allowlist since ${recipient.createdAt.toISOString().slice(0, 10)}`],
      });

      if (!outcome.ok) {
        log.warn(
          { recipientId: recipient.id, reason: outcome.reason },
          'screening.scan: no verdict this cycle',
        );
        continue;
      }
      counts.screened += 1;

      const at = now();
      await recordCounterpartyScreen(deps.db, {
        recipientId: recipient.id,
        tier: outcome.tier,
        evidence: { reasons: outcome.reasons, requestIds: outcome.meta?.requestIds ?? [] },
        screenedAt: at,
      });

      if (outcome.tier !== recipient.riskTier) {
        counts.changed += 1;
        await appendAudit(deps.db, {
          walletId,
          actor: 'system',
          event: 'RECIPIENT_RISK_TIER_CHANGED',
          entityType: 'recipient',
          entityId: recipient.id,
          payload: { from: recipient.riskTier, to: outcome.tier, reasons: outcome.reasons },
          createdAt: at,
        });
        log.warn(
          { walletId, recipientId: recipient.id, from: recipient.riskTier, to: outcome.tier },
          'recipient risk tier changed',
        );
      }
    }
  }
  return counts;
}

export async function registerScreeningJob(deps: {
  boss: PgBoss;
  db: Db;
  client?: ServClient;
  model: string;
  now?: () => Date;
}): Promise<void> {
  await deps.boss.createQueue(SCREENING_SCAN_QUEUE);
  await deps.boss.work(SCREENING_SCAN_QUEUE, async () => {
    if (!deps.client) {
      log.warn('no reasoning client configured; screening.scan is a no-op this cycle');
      return;
    }
    await scanForCounterpartyRisk({
      db: deps.db,
      client: deps.client,
      model: deps.model,
      ...(deps.now ? { now: deps.now } : {}),
    });
  });
  await deps.boss.schedule(SCREENING_SCAN_QUEUE, SCREENING_SCAN_CRON);
}
