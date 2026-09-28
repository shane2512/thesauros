// 8.1 — `permission.scan` detects a revoke the owner sent OUT-OF-BAND (straight from their Coinbase
// wallet, never reported to Thesauros) and freezes the wallet with no user action at all.
//
// Real Postgres, real audit chain, real `recordRevocationIfRevoked`. The chain is a stub for one
// reason: `isRevoked` is a single `readContract` whose encoding is already covered by
// packages/wallet's spend-permission tests — what is under test here is what the WORKER does with
// the answer.
//
// I7 at runtime: `@thesauros/reasoning` throws on import in this suite, so if the scan's graph reached
// the reasoning layer every test below would fail.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type PublicClient } from 'viem';
import {
  getWalletById,
  insertAgentDecision,
  insertApproval,
  insertSpendPermission,
  listAuditPage,
  listSpendPermissions,
  schema,
  setWalletFrozen,
  verifyChain,
} from '@thesauros/db';
import { freshTestDb } from '../../../packages/db/test/helpers';
import { scanForRevocations } from '../src/jobs/permissionScan';

vi.mock('@thesauros/reasoning', () => {
  throw new Error('SERV/reasoning is down: revoke detection must not need it');
});

const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
const MANAGER = getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad');
/** Owner, agent and permission hash are all unique columns; one counter feeds them all. */
let seq = 0;
const nextAddress = () => getAddress(`0x${(++seq).toString(16).padStart(40, '0')}`);
const ONE = 1_000_000n;

let walletId: string;
const { db, pool } = await freshTestDb();

afterAll(async () => {
  await pool.end();
});

/** `isRevoked` answers `revoked`; every other read explodes, so nothing else may reach the chain. */
const chain = (answer: boolean | 'unreadable'): PublicClient =>
  ({
    readContract: (args: { functionName: string }) => {
      if (args.functionName !== 'isRevoked')
        return Promise.reject(new Error(`unexpected read: ${args.functionName}`));
      return answer === 'unreadable'
        ? Promise.reject(new Error('rpc is down'))
        : Promise.resolve(answer);
    },
  }) as unknown as PublicClient;

/** A wallet the scheduler considers active: provisioned, unfrozen, with an active policy. */
async function seedWallet(): Promise<string> {
  const ownerAddress = nextAddress();
  const [user] = await db.insert(schema.users).values({ ownerAddress }).returning();
  const [wallet] = await db
    .insert(schema.wallets)
    .values({
      userId: user!.id,
      chainId: 84532,
      treasuryAddress: ownerAddress,
      agentWalletAddress: nextAddress(),
      activePolicyVersion: 1,
    })
    .returning();
  await db.insert(schema.policies).values({
    walletId: wallet!.id,
    version: 1,
    body: { version: 1, walletId: wallet!.id },
    bodyHash: `0x${'11'.repeat(32)}`,
    status: 'active',
  });
  return wallet!.id;
}

async function seedPermission(id: string): Promise<void> {
  await insertSpendPermission(db, {
    walletId: id,
    permission: {
      account: nextAddress(),
      spender: nextAddress(),
      token: USDC,
      allowance: (5_000n * ONE).toString(),
      period: 86_400,
      start: 0,
      end: 1_900_000_000,
      salt: '1',
      extraData: '0x',
    },
    signature: `0x${'ab'.repeat(65)}`,
    permissionHash: `0x${'cd'.repeat(32)}`,
  });
}

// Each test gets its own wallet, and teardown FREEZES the old one so `listActiveWalletIds` stops
// returning it — cheaper than deleting rows the audit trigger will not let us delete anyway (I6).
beforeEach(async () => {
  walletId = await seedWallet();
});
afterEach(async () => {
  await setWalletFrozen(db, walletId, true, 'test teardown', new Date());
});

const scan = (answer: boolean | 'unreadable') =>
  scanForRevocations({ db, publicClient: chain(answer), manager: MANAGER });

describe('permission.scan', () => {
  it('freezes and audits a wallet whose permission was revoked out-of-band', async () => {
    await seedPermission(walletId);

    const counts = await scan(true);
    expect(counts).toEqual({ scanned: 1, recorded: 1, froze: 1 });

    const wallet = await getWalletById(db, walletId);
    expect(wallet?.frozen).toBe(true);
    expect(wallet?.frozenReason).toBe('spend permission revoked on-chain');

    const rows = await listSpendPermissions(db, walletId);
    expect(rows[0]?.status).toBe('revoked');
    expect(rows[0]?.revokedAt).toBeInstanceOf(Date);

    const audit = await listAuditPage(db, walletId, { limit: 50 });
    const revoked = audit.find((r) => r.event === 'SPEND_PERMISSION_REVOKED');
    expect(revoked?.actor).toBe('system');
    expect((revoked?.payload as { detectedBy?: string }).detectedBy).toBe('onchain-scan');
    expect(audit.some((r) => r.event === 'FROZEN')).toBe(true);
    expect((await verifyChain(db, walletId)).ok).toBe(true);
  });

  it('cancels pending approvals when it freezes', async () => {
    await seedPermission(walletId);
    const decision = await insertAgentDecision(db, {
      walletId,
      trigger: 'schedule',
      contextSnapshot: {},
      contextHash: `0x${'aa'.repeat(32)}`,
      proposalSource: 'serv',
      status: 'escalated',
      proposalHash: `0x${'ef'.repeat(32)}`,
    });
    await insertApproval(db, {
      walletId,
      decisionId: decision.id,
      proposalHash: `0x${'ef'.repeat(32)}`,
      message: 'Thesauros approval (test)',
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const counts = await scan(true);
    expect(counts.recorded).toBe(1);
    const audit = await listAuditPage(db, walletId, { limit: 50 });
    expect(audit.some((r) => r.event === 'APPROVAL_CANCELLED')).toBe(true);
  });

  it('is a no-op while the chain still says the permission is live', async () => {
    await seedPermission(walletId);
    expect(await scan(false)).toEqual({ scanned: 1, recorded: 0, froze: 0 });
    expect((await getWalletById(db, walletId))?.frozen).toBe(false);
    expect((await listSpendPermissions(db, walletId))[0]?.status).toBe('pending');
  });

  it('fails closed on an unreadable chain: nothing recorded, nothing frozen (I5)', async () => {
    await seedPermission(walletId);
    expect(await scan('unreadable')).toEqual({ scanned: 1, recorded: 0, froze: 0 });
    expect((await getWalletById(db, walletId))?.frozen).toBe(false);
    expect((await listSpendPermissions(db, walletId))[0]?.status).toBe('pending');
  });

  it('is idempotent: a second pass finds nothing left to record', async () => {
    await seedPermission(walletId);
    expect((await scan(true)).recorded).toBe(1);
    // The wallet is frozen now, so the scheduler no longer lists it at all.
    expect(await scan(true)).toEqual({ scanned: 0, recorded: 0, froze: 0 });
    // Even forced unfrozen, the already-revoked row is not re-recorded or re-audited.
    await setWalletFrozen(db, walletId, false, null, new Date());
    expect(await scan(true)).toEqual({ scanned: 1, recorded: 0, froze: 0 });
    const audit = await listAuditPage(db, walletId, { limit: 50 });
    expect(audit.filter((r) => r.event === 'SPEND_PERMISSION_REVOKED')).toHaveLength(1);
  });

  it('never reads the chain for a wallet with no permission at all', async () => {
    // `chain` rejects every read except isRevoked, and there is no permission to read one for.
    expect(await scan(true)).toEqual({ scanned: 1, recorded: 0, froze: 0 });
    expect((await getWalletById(db, walletId))?.frozen).toBe(false);
  });
});
