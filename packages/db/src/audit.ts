// I6 — append-only, hash-chained audit log. Writes go only through appendAudit(); UPDATE/DELETE/TRUNCATE
// are blocked by the audit_log_no_mutation trigger (migration 0001).
//
// Chain: one chain per wallet_id, plus one "system" chain for rows with no wallet (wallet_id IS NULL).
// row_hash = sha256(canonicalJson({walletId, actor, event, entityType, entityId, payload, createdAt, prevHash})).
// created_at is generated in app code and stored verbatim, so the hashed value always matches the stored one.
// The chain is serialized per chain key with pg_advisory_xact_lock, so concurrent appends cannot fork it.
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { canonicalJson, err, hashCanonical, ok, type Result } from '@thesauros/shared';
import type { Db } from './client';
import { auditLog } from './schema';

export type AuditRow = typeof auditLog.$inferSelect;

/** prev_hash of the first row of any chain. */
export const AUDIT_GENESIS_PREV_HASH = `0x${'00'.repeat(32)}` as const;
/** Advisory-lock namespace so audit locks never collide with other per-wallet locks (e.g. the decision loop). */
const AUDIT_LOCK_NAMESPACE = 0x4155_4454; // 'AUDT'
/** Lock/chain key used for rows with no wallet_id. */
const SYSTEM_CHAIN_KEY = 'audit:system';

export type AuditActor = 'agent' | 'owner' | 'system';

export interface AuditEntry {
  /** null/undefined ⇒ the system chain. */
  walletId?: string | null;
  actor: AuditActor;
  event: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Anything canonical-JSON-serializable. Must contain no secrets (SECURITY §6). */
  payload: unknown;
  /** Injected clock; defaults to now. Stored and hashed verbatim. */
  createdAt?: Date;
}

export type AuditError =
  | { code: 'SECRET_IN_PAYLOAD'; message: string; paths: string[] }
  | { code: 'WRITE_FAILED'; message: string };

// SECURITY §6 redaction paths + the seed/mnemonic family. Deliberately NOT "token" (USDC token fields are
// everywhere in this domain) — key material is caught by the patterns below.
const SECRET_KEY_RE =
  /priv(ate)?[_-]?key|secret|mnemonic|seed[_-]?phrase|passphrase|password|api[_-]?key|signature|authorization|cookie/i;

/** Paths of payload keys that look like secrets. */
export function findSecretKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findSecretKeys(v, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const p = path ? `${path}.${k}` : k;
    if (SECRET_KEY_RE.test(k)) out.push(p);
    else out.push(...findSecretKeys(v, p));
  }
  return out;
}

const chainFilter = (walletId: string | null): SQL =>
  walletId === null ? isNull(auditLog.walletId) : eq(auditLog.walletId, walletId);

function rowHashOf(r: {
  walletId: string | null;
  actor: string;
  event: string;
  entityType: string | null;
  entityId: string | null;
  payload: unknown;
  createdAt: Date;
  prevHash: string;
}): string {
  return hashCanonical({
    walletId: r.walletId,
    actor: r.actor,
    event: r.event,
    entityType: r.entityType,
    entityId: r.entityId,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
    prevHash: r.prevHash,
  });
}

/**
 * Append one audit row. Fails closed (I5): never throws, returns Err — the caller decides to abort.
 * Refuses payloads containing secret-looking keys rather than scrubbing them, so the offending call site
 * is fixed instead of silently writing half a record.
 */
export async function appendAudit(
  db: Db,
  entry: AuditEntry,
): Promise<Result<AuditRow, AuditError>> {
  const secrets = findSecretKeys(entry.payload);
  if (secrets.length > 0)
    return err({
      code: 'SECRET_IN_PAYLOAD',
      message: `audit payload contains secret-looking keys: ${secrets.join(', ')}`,
      paths: secrets,
    });

  const walletId = entry.walletId ?? null;
  const entityType = entry.entityType ?? null;
  const entityId = entry.entityId ?? null;
  const createdAt = entry.createdAt ?? new Date();
  // Normalize through canonical JSON so bigint/Date become strings and the stored jsonb reads back
  // byte-identically to what we hash.
  const payload: unknown = JSON.parse(canonicalJson(entry.payload));

  try {
    return ok(
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${AUDIT_LOCK_NAMESPACE}, hashtext(${walletId ?? SYSTEM_CHAIN_KEY}))`,
        );
        const [prev] = await tx
          .select({ rowHash: auditLog.rowHash })
          .from(auditLog)
          .where(chainFilter(walletId))
          .orderBy(desc(auditLog.id))
          .limit(1);
        const prevHash = prev?.rowHash ?? AUDIT_GENESIS_PREV_HASH;
        const base = {
          walletId,
          actor: entry.actor,
          event: entry.event,
          entityType,
          entityId,
          payload,
          createdAt,
        };
        const [row] = await tx
          .insert(auditLog)
          .values({ ...base, prevHash, rowHash: rowHashOf({ ...base, prevHash }) })
          .returning();
        if (!row) throw new Error('appendAudit: insert returned no row');
        return row;
      }),
    );
  } catch (e) {
    return err({ code: 'WRITE_FAILED', message: String(e) });
  }
}

/**
 * Audit rows for one entity, oldest first. Read-only; used by `/api/decisions/:id` and by the
 * NFR-4 replay, which reconstructs a decision from the immutable chain rather than from the
 * mutable tables.
 */
export async function listAuditForEntity(
  db: Db,
  entityType: string,
  entityId: string,
): Promise<AuditRow[]> {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(asc(auditLog.id));
}

/**
 * One page of a chain, oldest-first, for the S10 export (task 7.7). Cursor-paginated by row id
 * rather than streamed: a hackathon-scale wallet's chain is small enough that "the next 1000 rows"
 * is a fine unit of work.
 * ponytail: offset-free keyset pagination is already O(1) per page; no further work needed unless a
 * single export needs to span millions of rows, at which point this should become a real stream.
 */
export async function listAuditPage(
  db: Db,
  walletId: string | null,
  opts: { limit: number; afterId?: number },
): Promise<AuditRow[]> {
  const conds = [chainFilter(walletId)];
  if (opts.afterId !== undefined) conds.push(sql`${auditLog.id} > ${opts.afterId}`);
  return db
    .select()
    .from(auditLog)
    .where(and(...conds))
    .orderBy(asc(auditLog.id))
    .limit(opts.limit);
}

export interface ChainBreak {
  rowId: number;
  reason: 'prev_hash_mismatch' | 'row_hash_mismatch';
  expected: string;
  actual: string;
}

/**
 * Recompute one chain. Ok ⇒ {rows, head} (head is the last row_hash, usable as an external anchor).
 * Err ⇒ the id of the FIRST row that does not verify, and why.
 * ponytail: loads the whole chain; paginate if a wallet ever exceeds ~1e5 rows.
 */
export async function verifyChain(
  db: Db,
  walletId: string | null,
): Promise<Result<{ rows: number; head: string }, ChainBreak>> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(chainFilter(walletId))
    .orderBy(asc(auditLog.id));
  let prevHash: string = AUDIT_GENESIS_PREV_HASH;
  for (const r of rows) {
    if (r.prevHash !== prevHash)
      return err({
        rowId: r.id,
        reason: 'prev_hash_mismatch',
        expected: prevHash,
        actual: r.prevHash,
      });
    const expected = rowHashOf({ ...r, prevHash });
    if (r.rowHash !== expected)
      return err({ rowId: r.id, reason: 'row_hash_mismatch', expected, actual: r.rowHash });
    prevHash = r.rowHash;
  }
  return ok({ rows: rows.length, head: prevHash });
}
