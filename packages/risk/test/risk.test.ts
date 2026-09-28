// Unit tests for the risk gate. No network: the simulation itself is exercised against a real
// anvil fork in packages/wallet/test/fork (opt-in), because a mocked EVM proves nothing.
import { describe, expect, it } from 'vitest';
import { encodeFunctionData, getAddress, maxUint256, type PublicClient } from 'viem';
import { APPROVE_ABI, extractApprovals, mockPriceFeedAdapter, detectRiskTriggers } from '../src';

const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
const VAULT = getAddress('0x3741f0da6dFFfFD8Be2353e326a49E41a3396485');
const FEED = getAddress('0xea0183F799ffCfE2f5bFd831EBfdc9f064fddf69');

const approveCall = (spender: `0x${string}`, value: bigint) => ({
  to: USDC,
  data: encodeFunctionData({ abi: APPROVE_ABI, functionName: 'approve', args: [spender, value] }),
  value: 0n,
});

describe('extractApprovals (R18 plumbing)', () => {
  it('decodes an exact-amount approval', () => {
    expect(extractApprovals([approveCall(VAULT, 1_000_000n)])).toEqual([
      { token: USDC, spender: VAULT, amount: 1_000_000n },
    ]);
  });

  it('decodes an unbounded approval as maxUint256 so R18 can deny it', () => {
    const [approval] = extractApprovals([approveCall(VAULT, maxUint256)]);
    expect(approval?.amount).toBe(maxUint256);
  });

  it('ignores calls that are not approvals', () => {
    expect(extractApprovals([{ to: VAULT, data: '0xdeadbeef', value: 0n }])).toEqual([]);
  });

  it('treats calldata that starts with the approve selector but does not decode as unbounded', () => {
    // Fail closed (I5): an approval we cannot read is not an approval we may vouch for.
    const [approval] = extractApprovals([{ to: USDC, data: '0x095ea7b300', value: 0n }]);
    expect(approval?.amount).toBe(maxUint256);
  });
});

describe('detectRiskTriggers', () => {
  const base = { vaultDrawdownBps: 100, depegThresholdBps: 50 };

  it('fires vault_drawdown exactly at the threshold and not one bp below', () => {
    const at = detectRiskTriggers({
      ...base,
      vaults: [{ vaultId: 'v1', previous: 10_000n, current: 9_900n }], // −100 bps
    });
    expect(at.map((t) => t.trigger)).toEqual(['vault_drawdown']);

    const below = detectRiskTriggers({
      ...base,
      vaults: [{ vaultId: 'v1', previous: 10_000n, current: 9_901n }], // −99 bps
    });
    expect(below).toEqual([]);
  });

  it('never fires on a rising share price or a first snapshot', () => {
    expect(
      detectRiskTriggers({ ...base, vaults: [{ vaultId: 'v1', previous: 1n, current: 2n }] }),
    ).toEqual([]);
    expect(detectRiskTriggers({ ...base, vaults: [{ vaultId: 'v1', current: 1n }] })).toEqual([]);
    expect(
      detectRiskTriggers({ ...base, vaults: [{ vaultId: 'v1', previous: 0n, current: 0n }] }),
    ).toEqual([]);
  });

  it('flags every vault when the asset depegs, in either direction', () => {
    const down = detectRiskTriggers({
      ...base,
      vaults: [
        { vaultId: 'v1', current: 1n },
        { vaultId: 'v2', current: 1n },
      ],
      assetMicroUsd: 994_000n,
    });
    expect(down.map((t) => [t.vaultId, t.trigger])).toEqual([
      ['v1', 'asset_depeg'],
      ['v2', 'asset_depeg'],
    ]);
    expect(
      detectRiskTriggers({
        ...base,
        vaults: [{ vaultId: 'v1', current: 1n }],
        assetMicroUsd: 1_006_000n,
      }),
    ).toHaveLength(1);
    expect(
      detectRiskTriggers({
        ...base,
        vaults: [{ vaultId: 'v1', current: 1n }],
        assetMicroUsd: 999_951n,
      }),
    ).toEqual([]);
  });

  it('is deterministic and total', () => {
    const input = {
      ...base,
      vaults: [{ vaultId: 'v1', previous: 1_000_000n, current: 900_000n }],
      assetMicroUsd: 500_000n,
    };
    expect(detectRiskTriggers(input)).toEqual(detectRiskTriggers(input));
    expect(detectRiskTriggers({ ...base, vaults: [] })).toEqual([]);
  });
});

describe('mockPriceFeedAdapter (I11 fence)', () => {
  const publicClient = {} as PublicClient;
  const args = { publicClient, feed: FEED, token: USDC, chainId: 84532, demoMode: true };

  it('is refused without DEMO_MODE', () => {
    expect(mockPriceFeedAdapter({ ...args, demoMode: false }).ok).toBe(false);
  });

  it('is refused on any chain other than Base Sepolia', () => {
    for (const chainId of [1, 8453, 84531, 0]) {
      expect(mockPriceFeedAdapter({ ...args, chainId }).ok).toBe(false);
    }
  });

  it('refuses to price a token it was not configured for', async () => {
    const adapter = mockPriceFeedAdapter(args);
    expect(adapter.ok).toBe(true);
    if (!adapter.ok) return;
    const other = await adapter.value.getPrice(VAULT);
    expect(other.ok).toBe(false);
  });

  it('marks every quote as demo data (I11 banner) and never throws on a bad read', async () => {
    const failing = {
      readContract: () => Promise.reject(new Error('rpc down')),
    } as unknown as PublicClient;
    const adapter = mockPriceFeedAdapter({ ...args, publicClient: failing });
    expect(adapter.ok).toBe(true);
    if (!adapter.ok) return;
    expect((await adapter.value.getPrice(USDC)).ok).toBe(false);

    const good = {
      readContract: () => Promise.resolve([1_000_000n, 1_700_000_000n]),
    } as unknown as PublicClient;
    const ok = mockPriceFeedAdapter({ ...args, publicClient: good });
    if (!ok.ok) throw new Error('adapter should build');
    const quote = await ok.value.getPrice(USDC);
    expect(quote.ok && quote.value.demo).toBe(true);
    expect(quote.ok && quote.value.microUsd).toBe(1_000_000n);
  });

  it('refuses a non-positive price rather than pricing funds at zero', async () => {
    const zero = { readContract: () => Promise.resolve([0n, 1n]) } as unknown as PublicClient;
    const adapter = mockPriceFeedAdapter({ ...args, publicClient: zero });
    if (!adapter.ok) throw new Error('adapter should build');
    expect((await adapter.value.getPrice(USDC)).ok).toBe(false);
  });
});
