// `ensureApprovedOnchain` is one of only two functions in Phase 2 that can broadcast. These tests pin
// down exactly what it may emit: a single `approveWithSignature` to the manager, value 0, never twice.
import { describe, expect, it } from 'vitest';
import { decodeFunctionData, type Hex, type PublicClient } from 'viem';
import { SPEND_PERMISSION_MANAGER_ABI } from '../src/abi';
import { ensureApprovedOnchain, type ApprovalSender } from '../src/spendPermission';
import { AGENT, ATTACKER, MANAGER, permission } from './fixtures';

const SIG = `0x${'ab'.repeat(65)}` as Hex;

const client = (state: { revoked?: boolean; approved?: boolean; throws?: boolean }) =>
  ({
    readContract: async ({ functionName }: { functionName: string }) => {
      if (state.throws) throw new Error('rpc down');
      if (functionName === 'isRevoked') return state.revoked ?? false;
      if (functionName === 'isApproved') return state.approved ?? false;
      throw new Error(`unexpected read ${functionName}`);
    },
  }) as unknown as PublicClient;

function sender(address = AGENT, fail = false) {
  const sent: { to: string; data: Hex; value: bigint }[] = [];
  const tx: ApprovalSender = {
    getAddress: () => address,
    sendTransaction: async (t) => {
      if (fail) throw new Error('userOp reverted');
      sent.push(t);
      return '0xfeed' as Hex;
    },
    waitForTransactionReceipt: async () => ({ status: 'complete' }),
  };
  return { tx, sent };
}

describe('ensureApprovedOnchain', () => {
  it('broadcasts exactly one approveWithSignature to the manager', async () => {
    const { tx, sent } = sender();
    const r = await ensureApprovedOnchain({
      publicClient: client({}),
      sender: tx,
      manager: MANAGER,
      permission,
      signature: SIG,
    });
    expect(r.ok && r.value.status).toBe('approved');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(MANAGER);
    expect(sent[0]!.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: SPEND_PERMISSION_MANAGER_ABI, data: sent[0]!.data });
    expect(decoded.functionName).toBe('approveWithSignature');
    expect(decoded.args).toEqual([permission, SIG]);
  });

  it('is idempotent: no transaction when already approved', async () => {
    const { tx, sent } = sender();
    const r = await ensureApprovedOnchain({
      publicClient: client({ approved: true }),
      sender: tx,
      manager: MANAGER,
      permission,
      signature: SIG,
    });
    expect(r.ok && r.value.status).toBe('already-approved');
    expect(sent).toEqual([]);
  });

  it('refuses a revoked permission', async () => {
    const { tx, sent } = sender();
    const r = await ensureApprovedOnchain({
      publicClient: client({ revoked: true }),
      sender: tx,
      manager: MANAGER,
      permission,
      signature: SIG,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/revoked/);
    expect(sent).toEqual([]);
  });

  it('refuses to approve a permission whose spender is not this agent wallet', async () => {
    const { tx, sent } = sender(ATTACKER);
    const r = await ensureApprovedOnchain({
      publicClient: client({}),
      sender: tx,
      manager: MANAGER,
      permission,
      signature: SIG,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/spender/);
    expect(sent).toEqual([]);
  });

  it('fails closed (and sends nothing) when the RPC reads throw', async () => {
    const { tx, sent } = sender();
    const r = await ensureApprovedOnchain({
      publicClient: client({ throws: true }),
      sender: tx,
      manager: MANAGER,
      permission,
      signature: SIG,
    });
    expect(r.ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it('returns Err rather than throwing when the user operation reverts', async () => {
    const { tx } = sender(AGENT, true);
    const r = await ensureApprovedOnchain({
      publicClient: client({}),
      sender: tx,
      manager: MANAGER,
      permission,
      signature: SIG,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/approveWithSignature failed/);
  });
});
