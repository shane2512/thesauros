// Builders for Policy Engine tests. The default scenario is deliberately an ALLOW: every test then
// breaks exactly one thing and asserts what that one thing does.
import {
  zEvaluationInput,
  type Address,
  type Delta,
  type EvaluationInput,
  type ParsedEvaluationInput,
  type Policy,
  type Proposal,
  type ProposalKind,
} from '@thesauros/shared';

/** Base units (and micro-USD at $1.00) — 6 decimals, bigint only (I12). */
export const usdc = (whole: number | bigint): bigint => BigInt(whole) * 1_000_000n;

export const ADDR = {
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  vault: '0x3741f0da6dFFfFD8Be2353e326a49E41a3396485',
  vault2: '0xea0183F799ffCfE2f5bFd831EBfdc9f064fddf69',
  treasury: '0xE72B889052382487604b7A92E8F7fB1a5937F242',
  agent: '0xE967db385aF313Cc6CA006a745fc929A201F58A2',
  owner: '0xC388F1602dF570289825ac907a1C3D80A2916924',
  alex: '0x1111111111111111111111111111111111111111',
  priya: '0x2222222222222222222222222222222222222222',
  /** One hex character away from Alex — the address-poisoning lookalike (T3). */
  alexLookalike: '0x1111111111111111111111111111111111111112',
  attacker: '0xBAd0000000000000000000000000000000000Bad',
} as const;

export const NOW = new Date('2026-09-21T12:00:00.000Z');
export const HASH_ZERO = `0x${'0'.repeat(64)}` as const;

/** The DEMO.md "Startup Operating" mandate, bound to the demo addresses. */
export function policy(over: Partial<Policy> = {}): Policy {
  return {
    version: 3,
    walletId: 'wallet-1',
    chainId: 84532,
    treasuryAddress: ADDR.treasury,
    tokens: [{ symbol: 'USDC', address: ADDR.usdc, decimals: 6 }],
    vaults: [
      {
        id: 'v1',
        name: 'Thesauros Demo Vault',
        address: ADDR.vault,
        asset: ADDR.usdc,
        kind: 'erc4626',
        maxAllocationBps: 5_000,
      },
    ],
    recipients: [
      { id: 'alex', label: 'Alex', address: ADDR.alex, maxPerTxMicroUsd: usdc(5_000) },
      { id: 'priya', label: 'Priya', address: ADDR.priya, maxPerTxMicroUsd: usdc(5_000) },
    ],
    limits: {
      perTxMicroUsd: usdc(50_000),
      dailyMicroUsd: usdc(60_000),
      maxActionsPerHour: 10,
    },
    runwayBufferMicroUsd: usdc(120_000),
    approvalThresholdMicroUsd: usdc(15_000),
    approvalThresholdByKind: { vault_deposit: usdc(60_000), pull_allowance: usdc(60_000) },
    depegThresholdBps: 50,
    vaultDrawdownBps: 100,
    autonomousKinds: [
      'pull_allowance',
      'vault_deposit',
      'vault_withdraw',
      'pay_recipient',
      'risk_exit',
      'noop',
    ],
    createdAt: '2026-09-20T09:00:00.000Z',
    signedBy: ADDR.owner,
    signature: '0xdeadbeef',
    ...over,
  };
}

type Deltas = Proposal['expectedDeltas'];
type OfKind<K extends ProposalKind> = Extract<Proposal, { kind: K }>;

/** A payment proposal and the deltas it promises. */
export function payProposal(
  amount = usdc(3_000),
  over: Partial<OfKind<'pay_recipient'>> = {},
): OfKind<'pay_recipient'> {
  return {
    kind: 'pay_recipient',
    params: { recipientId: 'alex', amount },
    expectedDeltas: [
      { token: ADDR.usdc, holder: 'agent', delta: -amount },
      { token: ADDR.usdc, holder: 'recipient', delta: amount },
    ],
    rationale: 'Alex is due 3,000 USDC today.',
    citedFactIds: ['F_OBLIGATION_1', 'F_AGENT_USDC'],
    confidence: 0.9,
    source: 'serv',
    ...over,
  } as OfKind<'pay_recipient'>;
}

export function depositProposal(
  amount = usdc(44_000),
  over: Partial<OfKind<'vault_deposit'>> = {},
): OfKind<'vault_deposit'> {
  return {
    kind: 'vault_deposit',
    params: { vaultId: 'v1', amount },
    expectedDeltas: [{ token: ADDR.usdc, holder: 'agent', delta: -amount }],
    rationale: 'Idle USDC above the runway buffer earns in the approved vault.',
    citedFactIds: ['F_AGENT_USDC'],
    confidence: 0.85,
    source: 'serv',
    ...over,
  } as OfKind<'vault_deposit'>;
}

export function pullProposal(
  amount = usdc(50_000),
  over: Partial<OfKind<'pull_allowance'>> = {},
): OfKind<'pull_allowance'> {
  return {
    kind: 'pull_allowance',
    params: { amount },
    expectedDeltas: [
      { token: ADDR.usdc, holder: 'treasury', delta: -amount },
      { token: ADDR.usdc, holder: 'agent', delta: amount },
    ],
    rationale: 'Pull the daily allowance to fund payroll and yield.',
    citedFactIds: ['F_ALLOWANCE_REMAINING'],
    confidence: 0.9,
    source: 'serv',
    ...over,
  } as OfKind<'pull_allowance'>;
}

export function withdrawProposal(
  amount = usdc(20_000),
  over: Partial<OfKind<'vault_withdraw'>> = {},
): OfKind<'vault_withdraw'> {
  return {
    kind: 'vault_withdraw',
    params: { vaultId: 'v1', amount },
    expectedDeltas: [{ token: ADDR.usdc, holder: 'agent', delta: amount }],
    rationale: 'Protect runway before the large payment.',
    citedFactIds: ['F_VAULT_V1'],
    confidence: 0.8,
    source: 'serv',
    ...over,
  } as OfKind<'vault_withdraw'>;
}

export function riskExitProposal(over: Partial<OfKind<'risk_exit'>> = {}): OfKind<'risk_exit'> {
  return {
    kind: 'risk_exit',
    params: { vaultId: 'v1', trigger: 'vault_drawdown' },
    expectedDeltas: [{ token: ADDR.usdc, holder: 'agent', delta: usdc(44_000) }],
    rationale: 'Vault share price fell 3%; exiting.',
    citedFactIds: ['F_VAULT_V1'],
    confidence: 0.95,
    source: 'deterministic',
    ...over,
  } as OfKind<'risk_exit'>;
}

export function sweepProposal(over: Partial<OfKind<'sweep_home'>> = {}): OfKind<'sweep_home'> {
  return {
    kind: 'sweep_home',
    params: {},
    expectedDeltas: [
      { token: ADDR.usdc, holder: 'agent', delta: -usdc(50_000) },
      { token: ADDR.usdc, holder: 'treasury', delta: usdc(50_000) },
    ],
    rationale: 'Owner asked for everything to come home.',
    citedFactIds: [],
    confidence: 1,
    source: 'owner',
    ...over,
  } as OfKind<'sweep_home'>;
}

export function noopProposal(over: Partial<OfKind<'noop'>> = {}): OfKind<'noop'> {
  return {
    kind: 'noop',
    params: {},
    expectedDeltas: [],
    rationale: 'Nothing to do.',
    citedFactIds: [],
    confidence: 1,
    source: 'serv',
    ...over,
  } as OfKind<'noop'>;
}

/** A simulation that agrees with whatever the proposal promised. */
export function simulationFor(proposal: Proposal): NonNullable<EvaluationInput['simulation']> {
  const approvals =
    proposal.kind === 'vault_deposit'
      ? [{ token: ADDR.usdc, spender: ADDR.vault, amount: proposal.params.amount }]
      : [];
  return { ok: true, deltas: [...(proposal.expectedDeltas as Deltas)], approvals };
}

/** `approvals` may be omitted in a test; `input()` fills in the empty list. */
export type SimulationPatch = {
  ok: boolean;
  deltas: Delta[];
  approvals?: { token: Address; spender: Address; amount: bigint }[];
  error?: string;
};

export type InputPatch = {
  policy?: Partial<Policy>;
  proposal?: Proposal;
  now?: Date;
  chainId?: 84532 | 8453;
  allowMainnet?: boolean;
  demoStableParity?: boolean;
  state?: Partial<EvaluationInput['state']>;
  ledger?: Partial<EvaluationInput['ledger']>;
  simulation?: SimulationPatch | null;
  verifier?: EvaluationInput['verifier'];
  screen?: EvaluationInput['screen'];
  contextFactIds?: string[];
  ownerApproval?: EvaluationInput['ownerApproval'];
};

/**
 * The default scenario: a healthy wallet paying Alex 3,000 USDC. Evaluates to ALLOW, so any test
 * can break exactly one field and see what that field alone does.
 */
export function input(patch: InputPatch = {}): EvaluationInput {
  const proposal = patch.proposal ?? payProposal();
  const p = policy(patch.policy);
  return {
    policy: p,
    proposal,
    now: patch.now ?? NOW,
    chainId: patch.chainId ?? 84532,
    allowMainnet: patch.allowMainnet ?? false,
    demoStableParity: patch.demoStableParity ?? false,
    state: {
      frozen: false,
      breakerOpen: false,
      agentUsdc: usdc(50_000),
      treasuryUsdc: usdc(150_000),
      allowanceRemaining: usdc(50_000),
      vaultPositions: { v1: usdc(0) },
      prices: {
        [ADDR.usdc]: { microUsd: 1_000_000n, publishedAt: new Date(NOW.getTime() - 10_000) },
      },
      contractHasCode: { [ADDR.vault]: true, [ADDR.vault2]: true },
      riskTriggers: [],
      ...patch.state,
    },
    ledger: {
      outflowsLast24hMicroUsd: 0n,
      actionsLastHour: 0,
      recentProposalHashes: [],
      ...patch.ledger,
    },
    simulation:
      patch.simulation === undefined
        ? simulationFor(proposal)
        : patch.simulation === null
          ? null
          : { approvals: [], ...patch.simulation },
    verifier: patch.verifier === undefined ? { verdict: 'AGREE', reasons: [] } : patch.verifier,
    screen: patch.screen ?? { injectionSuspected: false, signals: [] },
    contextFactIds: patch.contextFactIds ?? [
      'F_OBLIGATION_1',
      'F_AGENT_USDC',
      'F_ALLOWANCE_REMAINING',
      'F_VAULT_V1',
    ],
    ownerApproval: patch.ownerApproval ?? null,
  };
}

/** The same scenario after schema parsing — what an individual rule sees. */
export function parsedInput(patch: InputPatch = {}): ParsedEvaluationInput {
  return zEvaluationInput.parse(input(patch));
}

export const ALL_KINDS: readonly ProposalKind[] = [
  'pull_allowance',
  'vault_deposit',
  'vault_withdraw',
  'pay_recipient',
  'sweep_home',
  'risk_exit',
  'noop',
];

export const proposalForKind = (kind: ProposalKind): Proposal =>
  ({
    pull_allowance: pullProposal(),
    vault_deposit: depositProposal(),
    vault_withdraw: withdrawProposal(),
    pay_recipient: payProposal(),
    sweep_home: sweepProposal(),
    risk_exit: riskExitProposal(),
    noop: noopProposal(),
  })[kind];
