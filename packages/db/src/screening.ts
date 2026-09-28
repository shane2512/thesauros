// RFB 5 (I13) — the continuous-screening scheduler's write path. `screens` is append-only history;
// `recipients.riskTier`/`lastScreenedAt` cache the latest result for the Policy Engine to read.
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { recipients, screens } from './schema';

export type ScreenRow = typeof screens.$inferSelect;
export type RiskTier = ScreenRow['riskTier'];

/**
 * Writes one append-only `screens` row and updates the recipient's cached tier in the same
 * transaction — a reader must never see the history and the cache disagree.
 */
export async function recordCounterpartyScreen(
  db: Db,
  args: { recipientId: string; tier: RiskTier; evidence: unknown; screenedAt: Date },
): Promise<ScreenRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(screens)
      .values({
        recipientId: args.recipientId,
        riskTier: args.tier,
        evidence: args.evidence,
        screenedAt: args.screenedAt,
      })
      .returning();
    if (!row) throw new Error('recordCounterpartyScreen: no row returned');
    await tx
      .update(recipients)
      .set({ riskTier: args.tier, lastScreenedAt: args.screenedAt })
      .where(eq(recipients.id, args.recipientId));
    return row;
  });
}

export async function listScreensForRecipient(db: Db, recipientId: string): Promise<ScreenRow[]> {
  return db.select().from(screens).where(eq(screens.recipientId, recipientId));
}
