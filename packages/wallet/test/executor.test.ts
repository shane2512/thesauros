// execute() / confirmExecution() against a real Postgres (I10's idempotency lives in the DB) and a
// fake Circle client / TxSender (no network — Phase 2's live verification is separate, manual).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getAddress, type PublicClient } from 'viem';
import { schema } from '@thesauros/db';
import { err, ok } from '@thesauros/shared';
import { freshTestDb } from '../../db/test/helpers';
import { confirmExecution, execute, type TxSender } from '../src';
import { ctx, policy, proposals, RECIPIENT, USDC } from './fixtures';

const NOW = () => new Date('2026-09-28T00:00:00.000Z');
const KEY = new Uint8Array(32).fill(7);

const { db, pool } = await freshTestDb();
afterAll(async () => pool.end());

let walletId: string;
let decisionId: string;
let seq = 0;

beforeEach(async () => {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      ownerAddress: getAddress(`0x${(0xbeef0000n + BigInt(seq)).toString(16).padStart(40, '0')}`),
    })
    .returning();
  const [wallet] = await db
    .insert(schema.wallets)
    .values({
      userId: user!.id,
      chainId: 5042002,
      treasuryAddress: policy.treasuryAddress,
      agentWalletAddress: getAddress(`0xaaaa0000${seq.toString(16).padStart(32, '0')}`),
    })
    .returning();
  walletId = wallet!.id;
  const [decision] = await db
    .insert(schema.agentDecisions)
    .values({
      walletId,
      trigger: 'schedule',
      contextSnapshot: {},
      contextHash: `0x${'aa'.repeat(32)}`,
      proposalSource: 'deterministic',
      status: 'noop',
    })
    .returning();
  decisionId = decision!.id;
});

const receipt = (nonce: string, proposalHash = `0x${'11'.repeat(32)}` as const) => ({
  proposalHash,
  policyVersion: 1,
  walletId: 'wallet-1',
  nonce,
  issuedAt: NOW().toISOString(),
  expiresAt: new Date(NOW().getTime() + 60_000).toISOString(),
  mac: '0x00' as const,
});

const okSender = (providerTxId = 'circle-tx-1'): TxSender => ({
  getAddress: () => ctx.agentWalletAddress,
  send: async () => ok({ providerTxId }),
});
const failingSender = (message: string): TxSender => ({
  getAddress: () => ctx.agentWalletAddress,
  send: async () => err(message),
});

describe('execute', () => {
  it('sends the built calls and records a submitted execution', async () => {
    const built = { proposal: proposals.pay, hash: undefined as string | undefined };
    const { callsHash, buildCalls } = await import('../src');
    const calls = buildCalls(built.proposal, policy, ctx);
    if (!calls.ok) throw new Error('expected calls');
    const hash = callsHash(calls.value);

    const r = await execute(
      { db, sender: okSender('circle-tx-42'), receiptKey: KEY, now: NOW },
      {
        walletId,
        decisionId,
        proposal: proposals.pay,
        policy,
        receipt: receipt('nonce-1'),
        buildContext: ctx,
        simulatedCallsHash: hash,
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('submitted');
    expect(r.value.providerTxId).toBe('circle-tx-42');
  });

  it('refuses to send when the rebuilt calls do not match the simulated hash (I5)', async () => {
    const r = await execute(
      { db, sender: okSender(), receiptKey: KEY, now: NOW },
      {
        walletId,
        decisionId,
        proposal: proposals.pay,
        policy,
        receipt: receipt('nonce-2'),
        buildContext: ctx,
        simulatedCallsHash: `0x${'ff'.repeat(32)}`,
      },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('CALLS_MISMATCH');
  });

  it('is idempotent: replaying the same receipt nonce returns the original outcome, never sends twice', async () => {
    const { callsHash, buildCalls } = await import('../src');
    const calls = buildCalls(proposals.pay, policy, ctx);
    if (!calls.ok) throw new Error('expected calls');
    const hash = callsHash(calls.value);
    let sendCount = 0;
    const countingSender: TxSender = {
      getAddress: () => ctx.agentWalletAddress,
      send: async () => {
        sendCount += 1;
        return ok({ providerTxId: 'circle-tx-once' });
      },
    };
    const args = {
      walletId,
      decisionId,
      proposal: proposals.pay,
      policy,
      receipt: receipt('nonce-3'),
      buildContext: ctx,
      simulatedCallsHash: hash,
    };
    const first = await execute({ db, sender: countingSender, receiptKey: KEY, now: NOW }, args);
    const second = await execute({ db, sender: countingSender, receiptKey: KEY, now: NOW }, args);
    expect(first.ok && second.ok).toBe(true);
    expect(sendCount).toBe(1);
    if (first.ok && second.ok) expect(second.value.providerTxId).toBe(first.value.providerTxId);
  });

  it('marks the execution failed and returns Err when the sender fails', async () => {
    const { callsHash, buildCalls } = await import('../src');
    const calls = buildCalls(proposals.sweep, policy, ctx);
    if (!calls.ok) throw new Error('expected calls');
    const hash = callsHash(calls.value);
    const r = await execute(
      { db, sender: failingSender('Circle rejected the transaction'), receiptKey: KEY, now: NOW },
      {
        walletId,
        decisionId,
        proposal: proposals.sweep,
        policy,
        receipt: receipt('nonce-4'),
        buildContext: ctx,
        simulatedCallsHash: hash,
      },
    );
    expect(r.ok).toBe(false);
  });
});

describe('confirmExecution', () => {
  const fakePublicClient = (blockHash: `0x${string}`, logs: unknown[]): PublicClient =>
    ({
      getTransactionReceipt: async () => ({ blockHash }),
      getLogs: async () => logs,
    }) as unknown as PublicClient;

  const transferLog = (from: string, to: string, value: bigint) => ({
    args: { from: getAddress(from), to: getAddress(to), value },
  });

  it('confirms once Circle reports success and the measured delta matches', async () => {
    const client = {
      getTransaction: async () => ({
        data: { transaction: { state: 'CONFIRMED', txHash: `0x${'22'.repeat(32)}` } },
      }),
    } as unknown as Parameters<typeof confirmExecution>[0]['client'];
    const publicClient = fakePublicClient(`0x${'33'.repeat(32)}` as `0x${string}`, [
      transferLog(ctx.agentWalletAddress, RECIPIENT, 1_000_000n),
    ]);
    const r = await confirmExecution(
      { db, client, publicClient, now: NOW, pollIntervalMs: 1 },
      {
        executionId: 'exec-1',
        providerTxId: 'circle-tx-1',
        token: USDC,
        holders: {
          agent: ctx.agentWalletAddress,
          treasury: policy.treasuryAddress,
          recipient: RECIPIENT,
        },
        expectedDeltas: [
          { token: USDC, holder: 'agent', delta: -1_000_000n },
          { token: USDC, holder: 'recipient', delta: 1_000_000n },
        ],
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('confirmed');
  });

  it('fails when the measured delta does not match what was expected', async () => {
    const client = {
      getTransaction: async () => ({
        data: { transaction: { state: 'CONFIRMED', txHash: `0x${'22'.repeat(32)}` } },
      }),
    } as unknown as Parameters<typeof confirmExecution>[0]['client'];
    const publicClient = fakePublicClient(`0x${'33'.repeat(32)}` as `0x${string}`, [
      transferLog(ctx.agentWalletAddress, RECIPIENT, 500_000n),
    ]);
    const r = await confirmExecution(
      { db, client, publicClient, now: NOW, pollIntervalMs: 1 },
      {
        executionId: 'exec-2',
        providerTxId: 'circle-tx-2',
        token: USDC,
        holders: {
          agent: ctx.agentWalletAddress,
          treasury: policy.treasuryAddress,
          recipient: RECIPIENT,
        },
        expectedDeltas: [{ token: USDC, holder: 'recipient', delta: 1_000_000n }],
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('failed');
      expect(r.value.reason).toContain('does not match expected');
    }
  });

  it('fails without polling forever when Circle reports a terminal failure', async () => {
    const client = {
      getTransaction: async () => ({
        data: { transaction: { state: 'FAILED', errorReason: 'INSUFFICIENT_NATIVE_TOKEN' } },
      }),
    } as unknown as Parameters<typeof confirmExecution>[0]['client'];
    const publicClient = fakePublicClient(`0x${'33'.repeat(32)}` as `0x${string}`, []);
    const r = await confirmExecution(
      { db, client, publicClient, now: NOW, pollIntervalMs: 1 },
      {
        executionId: 'exec-3',
        providerTxId: 'circle-tx-3',
        token: USDC,
        holders: { agent: ctx.agentWalletAddress, treasury: policy.treasuryAddress },
        expectedDeltas: [],
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('failed');
      expect(r.value.reason).toBe('INSUFFICIENT_NATIVE_TOKEN');
    }
  });
});
