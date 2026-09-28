// Verdict + AllowReceipt schemas per POLICY_ENGINE.md §6-7. Shape only; the logic is in
// `packages/policy`.
import { z } from 'zod';
import { zHash, zHex } from './primitives';

/** The rule catalogue (POLICY_ENGINE §6). `ENGINE` is the fail-closed pseudo-rule (I5). */
export const RULE_CODES = [
  'R00',
  'R01',
  'R02',
  'R03',
  'R04',
  'R05',
  'R06',
  'R07',
  'R08',
  'R09',
  'R10',
  'R11',
  'R12',
  'R13',
  'R14',
  'R15',
  'R16',
  'R17',
  'R18',
  'R19',
  'R20',
  'R21',
  'ENGINE',
] as const;
export const zRuleCode = z.enum(RULE_CODES);
export type RuleCode = z.infer<typeof zRuleCode>;

export const zRuleResult = z.object({
  code: zRuleCode,
  result: z.enum(['PASS', 'ESCALATE', 'DENY']),
  message: z.string().optional(),
  /** True when a valid owner approval turned this rule's ESCALATE into a PASS (audit trail). */
  lifted: z.boolean().optional(),
});
export type RuleResult = z.infer<typeof zRuleResult>;

// Precedence DENY > ESCALATE > ALLOW (I5).
export const zVerdict = z.object({
  decision: z.enum(['ALLOW', 'ESCALATE', 'DENY']),
  results: z.array(zRuleResult),
  proposalHash: zHash,
  /** 0 when the input did not parse far enough to know the policy (always a DENY verdict). */
  policyVersion: z.number().int().nonnegative(),
  walletId: z.string(),
  evaluatedAt: z.string(),
});
export type Verdict = z.infer<typeof zVerdict>;

export const zAllowReceipt = z.object({
  proposalHash: zHash,
  policyVersion: z.number().int().positive(),
  walletId: z.string().min(1),
  nonce: z.string().uuid(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  /**
   * Hash of the exact `Call[]` the receipt authorises (`callsHash` from `@thesauros/wallet`).
   * Optional in the schema because the Policy Engine can issue a receipt before calls exist, but
   * the executor must pass an expectation and `verifyReceipt` then requires an exact match — this
   * is what stops a receipt for one `sweep_home` authorising a different one (same proposal hash,
   * different amounts).
   */
  callsHash: zHash.optional(),
  mac: zHex,
});
export type AllowReceipt = z.infer<typeof zAllowReceipt>;
