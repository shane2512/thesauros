// RFB 5 / I13 — `screening.scan` re-screens every recipient on a cadence and clamps risk tier
// drift into `recipients.riskTier`, never touching execution. Real Postgres, real audit chain, a
// FixtureServClient standing in for the reasoning layer (no network).
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { FixtureServClient } from '@thesauros/reasoning';
import {
  getWalletById,
  listAuditPage,
  listRecipients,
  schema,
  setWalletFrozen,
} from '@thesauros/db';
import { freshTestDb } from '../../../packages/db/test/helpers';
import { scanForCounterpartyRisk } from '../src/jobs/screening';

let seq = 0;
const nextAddress = () => getAddress(`0x${(++seq).toString(16).padStart(40, '0')}`);

let walletId: string;
const { db, pool } = await freshTestDb();

afterAll(async () => {
  await pool.end();
});

async function seedWallet(): Promise<string> {
  const ownerAddress = nextAddress();
  const [user] = await db.insert(schema.users).values({ ownerAddress }).returning();
  const [wallet] = await db
    .insert(schema.wallets)
    .values({
      userId: user!.id,
      chainId: 5042002,
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

async function seedRecipient(id: string): Promise<string> {
  const [row] = await db
    .insert(schema.recipients)
    .values({
      walletId: id,
      label: 'Alex (contractor)',
      address: nextAddress(),
      maxPerTx: 1_000_000n,
      schedule: null,
      addedSignature: `0x${'ab'.repeat(65)}`,
    })
    .returning();
  return row!.id;
}

beforeEach(async () => {
  walletId = await seedWallet();
});
afterEach(async () => {
  await setWalletFrozen(db, walletId, true, 'test teardown', new Date());
});

const scan = (client: FixtureServClient) =>
  scanForCounterpartyRisk({ db, client, model: 'gpt-5.4-mini' });

describe('screening.scan', () => {
  it('screens a never-screened recipient and records the tier', async () => {
    await seedRecipient(walletId);
    const counts = await scan(
      new FixtureServClient([], { counterparty: '{"tier":"low","reasons":["no signal"]}' }),
    );
    expect(counts).toEqual({ scanned: 1, screened: 1, changed: 0 });
    const [recipient] = await listRecipients(db, walletId);
    expect(recipient?.riskTier).toBe('low');
    expect(recipient?.lastScreenedAt).toBeInstanceOf(Date);
  });

  it('audits and bumps the tier when it changes', async () => {
    await seedRecipient(walletId);
    const counts = await scan(
      new FixtureServClient([], { counterparty: '{"tier":"high","reasons":["sanctions match"]}' }),
    );
    expect(counts).toEqual({ scanned: 1, screened: 1, changed: 1 });
    const audit = await listAuditPage(db, walletId, { limit: 50 });
    const changed = audit.find((r) => r.event === 'RECIPIENT_RISK_TIER_CHANGED');
    expect(changed).toBeDefined();
    expect((changed?.payload as { to?: string }).to).toBe('high');
  });

  it('does not re-screen a recently-screened recipient', async () => {
    await seedRecipient(walletId);
    const client = new FixtureServClient([], { counterparty: '{"tier":"low","reasons":[]}' });
    await scan(client);
    const secondPass = await scan(client);
    expect(secondPass).toEqual({ scanned: 1, screened: 0, changed: 0 });
  });

  it('leaves the stored tier untouched when SERV gives no verdict (I5)', async () => {
    await seedRecipient(walletId);
    const counts = await scan(new FixtureServClient());
    expect(counts).toEqual({ scanned: 1, screened: 0, changed: 0 });
    const [recipient] = await listRecipients(db, walletId);
    expect(recipient?.riskTier).toBe('low');
    expect(recipient?.lastScreenedAt).toBeNull();
  });

  it('never touches wallets that are not active', async () => {
    await seedRecipient(walletId);
    await setWalletFrozen(db, walletId, true, 'frozen for this test', new Date());
    const counts = await scan(
      new FixtureServClient([], { counterparty: '{"tier":"low","reasons":[]}' }),
    );
    expect(counts).toEqual({ scanned: 0, screened: 0, changed: 0 });
    // afterEach re-freezes the already-frozen wallet, which is harmless.
    await getWalletById(db, walletId);
  });
});
