import { buildContext, type Context, type ContextInput } from '@thesauros/context';
import type { Address } from '@thesauros/shared';
import type { ServProposal } from '../src/schemas';

export const USDC: Address = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const VAULT: Address = '0x3741f0da6dFFfFD8Be2353e326a49E41a3396485';
export const TREASURY: Address = '0xE72B889052382487604b7A92E8F7fB1a5937F242';
export const ALEX: Address = '0x1111111111111111111111111111111111111111';
export const PRIYA: Address = '0x2222222222222222222222222222222222222222';

export const NOW = new Date('2026-09-20T10:00:00Z');

export function contextInput(overrides: Partial<ContextInput> = {}): ContextInput {
  return {
    now: NOW,
    decimals: 6,
    policySummary: [
      'Keep at least 120,000 USDC liquid at all times.',
      'Ask me before anything over 15,000 USDC.',
    ],
    allowedKinds: [
      'pull_allowance',
      'vault_deposit',
      'vault_withdraw',
      'pay_recipient',
      'risk_exit',
      'noop',
    ],
    balances: {
      treasuryUsdc: 182_000_000000n,
      agentUsdc: 10_000_000000n,
      allowanceRemaining: 10_000_000000n,
      allowancePeriodEnds: new Date('2026-09-21T00:00:00Z'),
    },
    vaults: [
      {
        id: 'v1',
        name: 'Thesauros Demo USDC Vault',
        positionBaseUnits: 0n,
        apyPct: '4.10',
        apySource: 'demo',
      },
    ],
    recipients: [
      { id: 'r_alex', label: 'Alex (contractor)', scheduleDayOfMonth: 1 },
      { id: 'r_priya', label: 'Priya (designer)', scheduleDayOfMonth: 1 },
    ],
    obligations: [
      {
        id: '1',
        recipientId: 'r_alex',
        dueDate: new Date('2026-10-01T00:00:00Z'),
        amountBaseUnits: 3_000_000000n,
      },
    ],
    priceUsdc: { microUsd: 1_000_100n, publishedAt: new Date('2026-09-20T09:59:48Z') },
    outflowsLast24hBaseUnits: 0n,
    riskTriggers: [],
    untrusted: [],
    ...overrides,
  };
}

export const ctx = (overrides: Partial<ContextInput> = {}): Context =>
  buildContext(contextInput(overrides));

/** A well-formed model answer; spread over it to build the compromised variants. */
export function servProposal(overrides: Partial<ServProposal> = {}): ServProposal {
  return {
    kind: 'vault_deposit',
    vaultId: 'v1',
    recipientId: '',
    obligationId: '',
    amountUsdc: '10000',
    trigger: '',
    expectedDeltas: [
      { holder: 'agent', amountUsdc: '-10000' },
      { holder: 'treasury', amountUsdc: '0' },
    ],
    rationale: 'Idle balance above the buffer; depositing into the allowlisted vault.',
    citedFactIds: ['F_BAL_AGENT_USDC', 'F_BAL_TREASURY_USDC'],
    confidence: 0.9,
    ...overrides,
  };
}

export const jsonOf = (v: unknown) => JSON.stringify(v);
