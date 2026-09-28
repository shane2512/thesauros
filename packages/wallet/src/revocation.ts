// 8.1 — out-of-band revoke detection (SECURITY §8): notice when the owner revoked a spend
// permission directly on-chain, without telling Thesauros, and freeze with no user action at all.
//
// The single `isRevoked` read is Base `SpendPermissionManager`-specific and has no Arc deployment
// yet (Phase 2 replaces the whole mechanism with the Circle Paymaster policy's own revoke) — that
// one call is the only thing here that changes shape in Phase 2. Everything else (looking up the
// active permission, freezing, cancelling pending approvals, the audit rows) is provider-agnostic
// and real today. A chain that cannot be read leaves the permission active (I5): `permission.scan`
// already treats an `Err` this way.
import type { PublicClient } from 'viem';
import {
  appendAudit,
  cancelPendingApprovals,
  getActiveSpendPermission,
  markSpendPermissionRevoked,
  setWalletFrozen,
  type AuditActor,
  type Db,
} from '@thesauros/db';
import { type Address, type Result, err, ok } from '@thesauros/shared';
import { parseSpendPermission } from './spendPermission';

const SPEND_PERMISSION_MANAGER_ABI = [
  {
    type: 'function',
    name: 'isRevoked',
    stateMutability: 'view',
    inputs: [
      {
        name: 'permission',
        type: 'tuple',
        components: [
          { name: 'account', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'allowance', type: 'uint160' },
          { name: 'period', type: 'uint48' },
          { name: 'start', type: 'uint48' },
          { name: 'end', type: 'uint48' },
          { name: 'salt', type: 'uint256' },
          { name: 'extraData', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export type RevocationOutcome =
  | { state: 'recorded'; permissionHash: string; froze: boolean; cancelledApprovals: number }
  | { state: 'unchanged' };

export type RevocationErrorCode = 'INVALID_PERMISSION' | 'READ_FAILED';
export type RevocationError = { code: RevocationErrorCode; message: string };

export type RecordRevocationArgs = {
  db: Db;
  publicClient: PublicClient;
  manager: string;
  walletId: string;
  actor: AuditActor;
  now: Date;
};

export async function recordRevocationIfRevoked(
  args: RecordRevocationArgs,
): Promise<Result<RevocationOutcome, RevocationError>> {
  const { db, publicClient, walletId, actor, now } = args;
  const row = await getActiveSpendPermission(db, walletId);
  if (!row) return ok({ state: 'unchanged' });

  const parsed = parseSpendPermission(row.permission);
  if (!parsed.ok) return err({ code: 'INVALID_PERMISSION', message: parsed.error });

  let revoked: boolean;
  try {
    revoked = (await publicClient.readContract({
      address: args.manager as Address,
      abi: SPEND_PERMISSION_MANAGER_ABI,
      functionName: 'isRevoked',
      args: [parsed.value],
    })) as boolean;
  } catch (e) {
    return err({ code: 'READ_FAILED', message: `isRevoked read failed: ${String(e)}` });
  }
  if (!revoked) return ok({ state: 'unchanged' });

  await markSpendPermissionRevoked(db, row.id, now);
  await setWalletFrozen(db, walletId, true, 'spend permission revoked on-chain', now);
  const cancelled = await cancelPendingApprovals(db, walletId, now);

  await appendAudit(db, {
    walletId,
    actor,
    event: 'SPEND_PERMISSION_REVOKED',
    entityType: 'spend_permission',
    entityId: row.id,
    payload: { detectedBy: 'onchain-scan', permissionHash: row.permissionHash },
    createdAt: now,
  });
  await appendAudit(db, {
    walletId,
    actor,
    event: 'FROZEN',
    entityType: 'wallet',
    entityId: walletId,
    payload: { reason: 'spend permission revoked on-chain' },
    createdAt: now,
  });
  for (const approval of cancelled) {
    await appendAudit(db, {
      walletId,
      actor,
      event: 'APPROVAL_CANCELLED',
      entityType: 'approval',
      entityId: approval.id,
      payload: { reason: 'spend permission revoked on-chain' },
      createdAt: now,
    });
  }

  return ok({
    state: 'recorded',
    permissionHash: row.permissionHash,
    froze: true,
    cancelledApprovals: cancelled.length,
  });
}
