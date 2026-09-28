// Thin typed repositories. More are added by the phase that needs them.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { spendPermissions, users, wallets } from './schema';

export type User = typeof users.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;
export type SpendPermissionRow = typeof spendPermissions.$inferSelect;

/** Create the user on first login, else bump last_login_at. ownerAddress must already be checksummed. */
export async function upsertUserByAddress(db: Db, ownerAddress: string, now: Date): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({ ownerAddress, lastLoginAt: now })
    .onConflictDoUpdate({ target: users.ownerAddress, set: { lastLoginAt: now } })
    .returning();
  if (!row) throw new Error('upsertUserByAddress: no row returned');
  return row;
}

/**
 * The owner's wallet row, created on first sign-in. `treasuryAddress` is the owner's own smart wallet
 * (the account that grants the spend permission and receives every sweep home); the agent wallet is
 * provisioned separately. Idempotent: an existing row is returned untouched.
 */
export async function ensureWalletForUser(
  db: Db,
  userId: string,
  chainId: number,
  treasuryAddress: string,
): Promise<Wallet> {
  const existing = await getWalletByUserId(db, userId);
  if (existing) return existing;
  const [row] = await db
    .insert(wallets)
    .values({ userId, chainId, treasuryAddress })
    .onConflictDoNothing()
    .returning();
  const wallet = row ?? (await getWalletByUserId(db, userId));
  if (!wallet) throw new Error('ensureWalletForUser: no row');
  return wallet;
}

export async function getUserById(db: Db, id: string): Promise<User | undefined> {
  return (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
}

/**
 * S11 "Delete personal data": clears the PII fields this table owns. The owner's address stays —
 * it is the sign-in identity, not incidental personal data — and audit_log rows are never touched
 * (I6, append-only; they are retained, anonymized only in that they no longer join to a display name).
 */
export async function scrubUserPersonalData(db: Db, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ displayName: null, telegramChatId: null })
    .where(eq(users.id, userId));
}

/** 8.5 Settings: link or unlink the owner's Telegram chat id (`null` unlinks). */
export async function setTelegramChatId(
  db: Db,
  userId: string,
  chatId: string | null,
): Promise<void> {
  await db.update(users).set({ telegramChatId: chatId }).where(eq(users.id, userId));
}

export async function getWalletByUserId(db: Db, userId: string): Promise<Wallet | undefined> {
  return (await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1))[0];
}

/** The permission the worker should be using: newest that is still pending or approved on-chain. */
export async function getActiveSpendPermission(
  db: Db,
  walletId: string,
): Promise<SpendPermissionRow | undefined> {
  return (
    await db
      .select()
      .from(spendPermissions)
      .where(
        and(
          eq(spendPermissions.walletId, walletId),
          inArray(spendPermissions.status, ['pending', 'approved_onchain']),
        ),
      )
      .orderBy(desc(spendPermissions.createdAt))
      .limit(1)
  )[0];
}

export async function listSpendPermissions(
  db: Db,
  walletId: string,
): Promise<SpendPermissionRow[]> {
  return db
    .select()
    .from(spendPermissions)
    .where(eq(spendPermissions.walletId, walletId))
    .orderBy(desc(spendPermissions.createdAt));
}

/**
 * Store an owner-signed permission. The caller must have validated it (ceilings, spender, token) and
 * verified the signature first — this is a thin writer, not a gate.
 */
export async function insertSpendPermission(
  db: Db,
  row: {
    walletId: string;
    permission: unknown;
    signature: string;
    permissionHash: string;
  },
): Promise<SpendPermissionRow> {
  const [inserted] = await db.insert(spendPermissions).values(row).returning();
  if (!inserted) throw new Error('insertSpendPermission: no row returned');
  return inserted;
}

export async function markSpendPermissionApproved(
  db: Db,
  id: string,
  approvedTxHash: string,
): Promise<void> {
  await db
    .update(spendPermissions)
    .set({ status: 'approved_onchain', approvedTxHash })
    .where(eq(spendPermissions.id, id));
}

export async function markSpendPermissionRevoked(db: Db, id: string, at: Date): Promise<void> {
  await db
    .update(spendPermissions)
    .set({ status: 'revoked', revokedAt: at })
    .where(eq(spendPermissions.id, id));
}
