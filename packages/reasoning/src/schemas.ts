// Schemas for what the model is allowed to say. Transform-free on purpose: these mirror the strict
// `json_schema` we send to SERV, and the mapping into domain types (bigint, addresses, source) is
// done by our own code afterwards — the model never produces a Proposal directly.
import { z } from 'zod';

const signedDecimal = z.string().regex(/^-?\d+(\.\d{1,6})?$/);
/** "" means "not applicable to this kind" — strict json_schema has no optional properties. */
const optionalDecimal = z.string().regex(/^(\d+(\.\d{1,6})?)?$/);

/**
 * `sweep_home` is deliberately absent: it is owner-initiated only (R03), so the model is never even
 * offered the vocabulary for it.
 */
export const SERV_PROPOSAL_KINDS = [
  'noop',
  'pull_allowance',
  'vault_deposit',
  'vault_withdraw',
  'pay_recipient',
  'risk_exit',
] as const;

export const zServProposal = z
  .object({
    kind: z.enum(SERV_PROPOSAL_KINDS),
    vaultId: z.string().max(64),
    recipientId: z.string().max(64),
    obligationId: z.string().max(64),
    amountUsdc: optionalDecimal,
    trigger: z.enum(['', 'vault_drawdown', 'asset_depeg']),
    expectedDeltas: z
      .array(
        z
          .object({
            holder: z.enum(['agent', 'treasury', 'recipient']),
            amountUsdc: signedDecimal,
          })
          .strict(),
      )
      .max(8),
    rationale: z.string().max(600),
    citedFactIds: z.array(z.string().max(64)).max(32),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type ServProposal = z.infer<typeof zServProposal>;

export const zServVerification = z
  .object({
    verdict: z.enum(['AGREE', 'DISAGREE', 'UNSURE']),
    reasons: z.array(z.string().max(300)).max(10),
    checkedFactIds: z.array(z.string().max(64)).max(32),
  })
  .strict();
export type ServVerification = z.infer<typeof zServVerification>;

export const zServScreen = z
  .object({
    suspected: z.boolean(),
    reasons: z.array(z.string().max(300)).max(10),
  })
  .strict();
export type ServScreen = z.infer<typeof zServScreen>;

export const zServMandate = z
  .object({
    // Empty string = "the mandate does not say": `compileMandate` turns that into an issue and a
    // question for the owner rather than letting the model invent a limit.
    runwayBufferUsdc: optionalDecimal,
    perTxUsdc: optionalDecimal,
    dailyUsdc: optionalDecimal,
    approvalThresholdUsdc: optionalDecimal,
    approvalThresholdVaultDepositUsdc: optionalDecimal,
    maxActionsPerHour: z.number().int().min(1).max(100),
    depegThresholdBps: z.number().int().min(0).max(10_000),
    vaultDrawdownBps: z.number().int().min(0).max(10_000),
    autonomousKinds: z.array(z.enum(SERV_PROPOSAL_KINDS)).max(8),
    vaults: z
      .array(
        z
          .object({ id: z.string().max(64), maxAllocationBps: z.number().int().min(0).max(10_000) })
          .strict(),
      )
      .max(5),
    recipients: z
      .array(
        z
          .object({
            id: z.string().max(64),
            maxPerTxUsdc: optionalDecimal,
            /** 0 = no schedule. */
            scheduleDayOfMonth: z.number().int().min(0).max(28),
            scheduleAmountUsdc: optionalDecimal,
          })
          .strict(),
      )
      .max(50),
    assumptions: z.array(z.string().max(300)).max(20),
    questions: z.array(z.string().max(300)).max(20),
  })
  .strict();
export type ServMandate = z.infer<typeof zServMandate>;

export const zServExplanation = z.object({ text: z.string().max(600) }).strict();
export type ServExplanation = z.infer<typeof zServExplanation>;

/**
 * SERV honours OpenAI strict `json_schema` (V-08), which requires every property to be listed in
 * `required` and `additionalProperties:false` everywhere. zod's own converter emits that for
 * `.strict()` objects; this just asserts it so a schema change cannot silently relax the forcing.
 */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
  assertStrict(out);
  return wire(out) as Record<string, unknown>;
}

/**
 * Strict structured output accepts only a subset of JSON Schema: `pattern`, `maxLength`, `maxItems`
 * and numeric bounds are rejected by OpenAI-compatible endpoints. They stay in the zod schema (which
 * is the validator that actually matters) and are stripped from the wire copy.
 */
const WIRE_KEYS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'anyOf',
  'description',
]);

function wire(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(wire);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (!WIRE_KEYS.has(k)) continue;
    out[k] = k === 'properties' ? mapValues(v as Record<string, unknown>) : wire(v);
  }
  return out;
}

const mapValues = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, wire(v)]));

function assertStrict(node: unknown): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) assertStrict(n);
    return;
  }
  const o = node as Record<string, unknown>;
  if (o['type'] === 'object') {
    const props = Object.keys((o['properties'] ?? {}) as Record<string, unknown>);
    const required = (o['required'] ?? []) as string[];
    if (o['additionalProperties'] !== false) {
      throw new Error('json_schema: additionalProperties must be false (strict mode)');
    }
    for (const p of props) {
      if (!required.includes(p)) throw new Error(`json_schema: property "${p}" must be required`);
    }
  }
  for (const v of Object.values(o)) assertStrict(v);
}

export const SERV_SCHEMAS = {
  propose: { name: 'proposal', schema: jsonSchemaOf(zServProposal) },
  verify: { name: 'verification', schema: jsonSchemaOf(zServVerification) },
  screen: { name: 'screen', schema: jsonSchemaOf(zServScreen) },
  compile: { name: 'mandate', schema: jsonSchemaOf(zServMandate) },
  explain: { name: 'explanation', schema: jsonSchemaOf(zServExplanation) },
} as const;
