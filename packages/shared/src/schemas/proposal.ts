// Proposal schema per POLICY_ENGINE.md §3. Proposals reference IDs, never raw addresses (anti-poisoning).
import { z } from 'zod';
import { zAddress, zAmount } from './primitives';

export const PROPOSAL_KINDS = [
  'pull_allowance',
  'vault_deposit',
  'vault_withdraw',
  'pay_recipient',
  'sweep_home',
  'risk_exit',
  'noop',
] as const;
export const zProposalKind = z.enum(PROPOSAL_KINDS);
export type ProposalKind = z.infer<typeof zProposalKind>;

const common = {
  expectedDeltas: z.array(
    z.object({
      token: zAddress,
      holder: z.enum(['agent', 'treasury', 'recipient']),
      delta: z.union([z.bigint(), z.string().regex(/^-?\d+$/)]).transform((v) => BigInt(v)),
    }),
  ),
  rationale: z.string().max(600),
  citedFactIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  source: z.enum(['serv', 'deterministic', 'owner']),
};

const variant = <K extends ProposalKind, P extends z.ZodType>(kind: K, params: P) =>
  z.object({ kind: z.literal(kind), params, ...common }).strict();

// Unknown kinds fail to parse => R00 DENY (I5).
export const zProposal = z.discriminatedUnion('kind', [
  variant('pull_allowance', z.object({ amount: zAmount }).strict()),
  variant('vault_deposit', z.object({ vaultId: z.string(), amount: zAmount }).strict()),
  variant('vault_withdraw', z.object({ vaultId: z.string(), amount: zAmount }).strict()),
  variant(
    'pay_recipient',
    z
      .object({ recipientId: z.string(), amount: zAmount, obligationId: z.string().optional() })
      .strict(),
  ),
  variant('sweep_home', z.object({}).strict()),
  variant(
    'risk_exit',
    z.object({ vaultId: z.string(), trigger: z.enum(['vault_drawdown', 'asset_depeg']) }).strict(),
  ),
  variant('noop', z.object({}).strict()),
]);
export type Proposal = z.infer<typeof zProposal>;
