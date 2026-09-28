import { getAddress } from 'viem';
import type { Policy, Proposal } from '@thesauros/shared';
import type { BuildContext } from '../src/actionRegistry';
import type { SpendPermission } from '../src/spendPermission';

export const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
export const MANAGER = getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad');
export const TREASURY = getAddress('0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C');
export const AGENT = getAddress('0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14');
export const VAULT = getAddress('0x1111111111111111111111111111111111111111');
export const RECIPIENT = getAddress('0x2222222222222222222222222222222222222222');
/** Not in any Policy: used to prove an unresolved address can never become a call target. */
export const ATTACKER = getAddress('0x3333333333333333333333333333333333333333');

export const policy: Policy = {
  version: 1,
  walletId: 'wallet-1',
  chainId: 5042002,
  treasuryAddress: TREASURY,
  tokens: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
  vaults: [
    {
      id: 'v1',
      name: 'Thesauros Mock Vault',
      address: VAULT,
      asset: USDC,
      kind: 'erc4626',
      maxAllocationBps: 5_000,
    },
  ],
  recipients: [{ id: 'r1', label: 'Payroll', address: RECIPIENT, maxPerTxMicroUsd: 50_000_000n }],
  limits: { perTxMicroUsd: 100_000_000n, dailyMicroUsd: 500_000_000n, maxActionsPerHour: 10 },
  runwayBufferMicroUsd: 10_000_000n,
  approvalThresholdMicroUsd: 25_000_000n,
  depegThresholdBps: 100,
  vaultDrawdownBps: 500,
  autonomousKinds: ['pull_allowance', 'vault_deposit', 'vault_withdraw', 'pay_recipient', 'noop'],
  createdAt: '2026-09-20T00:00:00.000Z',
  signedBy: TREASURY,
  signature: '0xdead',
};

export const permission: SpendPermission = {
  account: TREASURY,
  spender: AGENT,
  token: USDC,
  allowance: 10_000_000n,
  period: 86_400,
  start: 1_800_000_000,
  end: 1_800_086_400,
  salt: 42n,
  extraData: '0x',
};

export const ctx: BuildContext = {
  agentWalletAddress: AGENT,
  spendPermissionManagerAddress: MANAGER,
  spendPermission: permission,
  agentUsdcBalance: 3_000_000n,
  vaultPositions: { v1: { shares: 2_000_000n, redeemableAssets: 2_200_000n } },
  allowMainnet: false,
};

const base = {
  expectedDeltas: [] as Proposal['expectedDeltas'],
  rationale: 'test',
  citedFactIds: [] as string[],
  confidence: 0.9,
  source: 'deterministic' as const,
};

export const proposals: Record<
  'pull' | 'deposit' | 'withdraw' | 'pay' | 'riskExit' | 'sweep' | 'noop',
  Proposal
> = {
  pull: { kind: 'pull_allowance', params: { amount: 1_000_000n }, ...base },
  deposit: { kind: 'vault_deposit', params: { vaultId: 'v1', amount: 1_000_000n }, ...base },
  withdraw: { kind: 'vault_withdraw', params: { vaultId: 'v1', amount: 1_000_000n }, ...base },
  pay: { kind: 'pay_recipient', params: { recipientId: 'r1', amount: 1_000_000n }, ...base },
  riskExit: { kind: 'risk_exit', params: { vaultId: 'v1', trigger: 'vault_drawdown' }, ...base },
  sweep: { kind: 'sweep_home', params: {}, ...base },
  noop: { kind: 'noop', params: {}, ...base },
};
