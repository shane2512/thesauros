// The mandate side of the engine: validatePolicyDraft, the templates, the English rendering and
// the deterministic verdict explainer.
import { describe, expect, it } from 'vitest';
import { SYSTEM_CEILINGS, type PolicyDraft } from '@thesauros/shared';
import { validatePolicyDraft } from '../src/validate';
import {
  MANDATE_TEMPLATES,
  MANDATE_TEMPLATE_NAMES,
  policyDraftFromTemplate,
} from '../src/templates';
import { renderPolicyAsSentences, ruleSentences } from '../src/sentences';
import { explainVerdict } from '../src/explain';
import { evaluate } from '../src/evaluate';
import { ADDR, input, payProposal, usdc, withdrawProposal } from './fixtures';

const binding = {
  chainId: 84532 as const,
  treasuryAddress: ADDR.treasury,
  usdcAddress: ADDR.usdc,
  vaults: [
    { id: 'v1', name: 'Thesauros Demo Vault', address: ADDR.vault, maxAllocationBps: 5_000 },
  ],
  recipients: [
    { id: 'alex', label: 'Alex', address: ADDR.alex, maxPerTxMicroUsd: usdc(2_000).toString() },
  ],
};

/** A valid draft to mutate one field at a time. */
const draft = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  const base = policyDraftFromTemplate('startup', binding);
  if (!base.ok) throw new Error('the startup template must be valid');
  return { ...base.value, ...over };
};

const issuesFor = (over: Record<string, unknown>) => {
  const r = validatePolicyDraft(draft(over));
  if (r.ok) throw new Error('expected issues');
  return r.error;
};
const paths = (over: Record<string, unknown>) => issuesFor(over).map((i) => i.path);
const codes = (over: Record<string, unknown>) => issuesFor(over).map((i) => i.code);

describe('validatePolicyDraft', () => {
  it('accepts a template-built draft', () => {
    expect(validatePolicyDraft(draft()).ok).toBe(true);
  });

  it('accepts a full, signed policy too', () => {
    expect(validatePolicyDraft(input().policy).ok).toBe(true);
  });

  it('reports schema problems with a path and a suggestion', () => {
    const r = validatePolicyDraft({ chainId: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error[0]?.code).toBe('SCHEMA');
    expect(r.error[0]?.suggestion).toMatch(/schema/);
    expect(r.error.some((i) => i.path.length > 0)).toBe(true);
  });

  it('rejects a negative amount at the schema edge (I12)', () => {
    const r = validatePolicyDraft(draft({ runwayBufferMicroUsd: -1n }));
    expect(r.ok).toBe(false);
  });

  it.each([
    ['no USDC token', { tokens: [] }, 'tokens', 'MISSING'],
    [
      'two USDC tokens',
      {
        tokens: [
          { symbol: 'USDC', address: ADDR.usdc, decimals: 6 },
          { symbol: 'USDC', address: ADDR.usdc, decimals: 6 },
        ],
      },
      'tokens',
      'DUPLICATE',
    ],
    [
      'a zero per-tx limit',
      { limits: { perTxMicroUsd: 0n, dailyMicroUsd: usdc(60_000), maxActionsPerHour: 10 } },
      'limits.perTxMicroUsd',
      'BELOW_FLOOR',
    ],
    [
      'a per-tx limit above the ceiling',
      {
        limits: {
          perTxMicroUsd: usdc(300_000),
          dailyMicroUsd: usdc(900_000),
          maxActionsPerHour: 10,
        },
      },
      'limits.perTxMicroUsd',
      'ABOVE_CEILING',
    ],
    [
      'a zero daily limit',
      { limits: { perTxMicroUsd: usdc(1), dailyMicroUsd: 0n, maxActionsPerHour: 10 } },
      'limits.dailyMicroUsd',
      'BELOW_FLOOR',
    ],
    [
      'a daily limit above the ceiling',
      {
        limits: {
          perTxMicroUsd: usdc(1_000),
          dailyMicroUsd: usdc(2_000_000),
          maxActionsPerHour: 10,
        },
      },
      'limits.dailyMicroUsd',
      'ABOVE_CEILING',
    ],
    [
      'a per-tx limit above the daily limit',
      {
        limits: { perTxMicroUsd: usdc(50_000), dailyMicroUsd: usdc(10_000), maxActionsPerHour: 10 },
      },
      'limits.perTxMicroUsd',
      'INCONSISTENT',
    ],
    [
      'too many actions per hour',
      {
        limits: { perTxMicroUsd: usdc(1_000), dailyMicroUsd: usdc(10_000), maxActionsPerHour: 50 },
      },
      'limits.maxActionsPerHour',
      'ABOVE_CEILING',
    ],
    [
      'an approval threshold above the daily limit',
      { approvalThresholdMicroUsd: usdc(90_000) },
      'approvalThresholdMicroUsd',
      'INCONSISTENT',
    ],
    [
      'a per-kind threshold above the daily limit',
      { approvalThresholdByKind: { vault_deposit: usdc(90_000) } },
      'approvalThresholdByKind.vault_deposit',
      'INCONSISTENT',
    ],
    ['a disarmed depeg guard', { depegThresholdBps: 0 }, 'depegThresholdBps', 'BELOW_FLOOR'],
    [
      'a depeg threshold above the ceiling',
      { depegThresholdBps: 900 },
      'depegThresholdBps',
      'ABOVE_CEILING',
    ],
    ['a disarmed drawdown guard', { vaultDrawdownBps: 0 }, 'vaultDrawdownBps', 'BELOW_FLOOR'],
    [
      'a drawdown threshold above the ceiling',
      { vaultDrawdownBps: 5_000 },
      'vaultDrawdownBps',
      'ABOVE_CEILING',
    ],
    [
      'an autonomous sweep_home',
      { autonomousKinds: ['noop', 'sweep_home'] },
      'autonomousKinds',
      'UNSAFE',
    ],
    [
      'duplicated autonomous kinds',
      { autonomousKinds: ['noop', 'noop'] },
      'autonomousKinds',
      'DUPLICATE',
    ],
  ])('rejects %s', (_label, over, path, code) => {
    expect(paths(over)).toContain(path);
    expect(codes(over)).toContain(code);
  });

  it('rejects more vaults than the ceiling allows', () => {
    const vaults = Array.from({ length: SYSTEM_CEILINGS.MAX_VAULTS + 1 }, (_, i) => ({
      id: `v${i}`,
      name: `Vault ${i}`,
      address: ADDR.vault,
      asset: ADDR.usdc,
      kind: 'erc4626',
      maxAllocationBps: 1_000,
    }));
    expect(paths({ vaults })).toContain('vaults');
  });

  it('rejects duplicate vault ids, duplicate vault addresses, a foreign asset and a 0% allocation', () => {
    const vault = {
      id: 'v1',
      name: 'V',
      address: ADDR.vault,
      asset: ADDR.usdc,
      kind: 'erc4626',
      maxAllocationBps: 5_000,
    };
    expect(paths({ vaults: [vault, { ...vault, address: ADDR.vault2 }] })).toContain('vaults.1.id');
    expect(paths({ vaults: [vault, { ...vault, id: 'v2' }] })).toContain('vaults.1.address');
    expect(paths({ vaults: [{ ...vault, asset: ADDR.attacker }] })).toContain('vaults.0.asset');
    expect(paths({ vaults: [{ ...vault, maxAllocationBps: 0 }] })).toContain(
      'vaults.0.maxAllocationBps',
    );
  });

  it('rejects more recipients than the ceiling allows', () => {
    const recipients = Array.from({ length: SYSTEM_CEILINGS.MAX_RECIPIENTS + 1 }, (_, i) => ({
      id: `r${i}`,
      label: `R${i}`,
      address: ADDR.alex,
      maxPerTxMicroUsd: usdc(1),
    }));
    expect(paths({ recipients })).toContain('recipients');
  });

  it('rejects duplicate recipient ids, duplicate addresses and the treasury as a payee', () => {
    const alex = { id: 'alex', label: 'Alex', address: ADDR.alex, maxPerTxMicroUsd: usdc(1_000) };
    expect(paths({ recipients: [alex, { ...alex, address: ADDR.priya }] })).toContain(
      'recipients.1.id',
    );
    expect(paths({ recipients: [alex, { ...alex, id: 'alex2' }] })).toContain(
      'recipients.1.address',
    );
    expect(paths({ recipients: [{ ...alex, address: ADDR.treasury }] })).toContain(
      'recipients.0.address',
    );
  });

  it('rejects recipient caps that can never work', () => {
    const alex = { id: 'alex', label: 'Alex', address: ADDR.alex, maxPerTxMicroUsd: usdc(1_000) };
    expect(paths({ recipients: [{ ...alex, maxPerTxMicroUsd: 0n }] })).toContain(
      'recipients.0.maxPerTxMicroUsd',
    );
    expect(paths({ recipients: [{ ...alex, maxPerTxMicroUsd: usdc(90_000) }] })).toContain(
      'recipients.0.maxPerTxMicroUsd',
    );
    expect(
      paths({
        recipients: [{ ...alex, schedule: { dayOfMonth: 1, amountMicroUsd: usdc(2_000) } }],
      }),
    ).toContain('recipients.0.schedule.amountMicroUsd');
  });

  it('accepts a schedule inside the recipient cap', () => {
    const alex = {
      id: 'alex',
      label: 'Alex',
      address: ADDR.alex,
      maxPerTxMicroUsd: usdc(3_000),
      schedule: { dayOfMonth: 1, amountMicroUsd: usdc(3_000) },
    };
    expect(validatePolicyDraft(draft({ recipients: [alex] })).ok).toBe(true);
  });

  it('accepts a draft with no per-kind thresholds at all', () => {
    expect(validatePolicyDraft(draft({ approvalThresholdByKind: undefined })).ok).toBe(true);
  });

  it('honours a caller-supplied, tighter set of ceilings', () => {
    const tighter = { ...SYSTEM_CEILINGS, MAX_PER_TX_MICRO_USD: usdc(10) };
    const r = validatePolicyDraft(draft(), tighter);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.map((i) => i.path)).toContain('limits.perTxMicroUsd');
  });

  it('collects every problem at once rather than stopping at the first', () => {
    expect(issuesFor({ depegThresholdBps: 0, vaultDrawdownBps: 0 }).length).toBeGreaterThanOrEqual(
      2,
    );
  });
});

describe('mandate templates', () => {
  it.each(MANDATE_TEMPLATE_NAMES)('%s builds a valid policy draft', (name) => {
    const r = policyDraftFromTemplate(name, binding);
    expect(r.ok).toBe(true);
  });

  it.each(MANDATE_TEMPLATE_NAMES)('%s stays inside every system ceiling', (name) => {
    const t = MANDATE_TEMPLATES[name];
    expect(BigInt(t.limits.perTxMicroUsd)).toBeLessThanOrEqual(
      SYSTEM_CEILINGS.MAX_PER_TX_MICRO_USD,
    );
    expect(BigInt(t.limits.dailyMicroUsd)).toBeLessThanOrEqual(SYSTEM_CEILINGS.MAX_DAILY_MICRO_USD);
    expect(t.limits.maxActionsPerHour).toBeLessThanOrEqual(SYSTEM_CEILINGS.MAX_ACTIONS_PER_HOUR);
    expect(t.depegThresholdBps).toBeLessThanOrEqual(SYSTEM_CEILINGS.MAX_DEPEG_THRESHOLD_BPS);
    expect(t.vaultDrawdownBps).toBeLessThanOrEqual(SYSTEM_CEILINGS.MAX_VAULT_DRAWDOWN_BPS);
    expect(BigInt(t.suggestedAllowanceMicroUsd)).toBeLessThanOrEqual(
      SYSTEM_CEILINGS.MAX_SPEND_PERMISSION_ALLOWANCE_MICRO_USD,
    );
  });

  it('no template makes sweep_home autonomous', () => {
    for (const name of MANDATE_TEMPLATE_NAMES) {
      expect(MANDATE_TEMPLATES[name].autonomousKinds).not.toContain('sweep_home');
    }
  });

  it('templates carry no addresses of their own (T3)', () => {
    expect(JSON.stringify(MANDATE_TEMPLATES)).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });

  it('reports issues when the binding itself is unsafe', () => {
    const r = policyDraftFromTemplate('creator', {
      ...binding,
      recipients: [
        { id: 'r', label: 'R', address: ADDR.treasury, maxPerTxMicroUsd: usdc(1).toString() },
      ],
    });
    expect(r.ok).toBe(false);
  });
});

describe('renderPolicyAsSentences', () => {
  it('describes the whole mandate in English', () => {
    const sentences = renderPolicyAsSentences(input().policy);
    const text = sentences.join('\n');
    expect(text).toContain('120000 USDC');
    expect(text).toContain('50000 USDC');
    expect(text).toContain('15000 USDC');
    expect(text).toContain('Alex');
    expect(text).toContain('50%');
    expect(text).toContain('1%');
    expect(sentences.every((s) => s.endsWith('.'))).toBe(true);
  });

  it('mentions each per-kind threshold override', () => {
    const text = renderPolicyAsSentences(input().policy).join('\n');
    expect(text).toContain('deposit into an approved vault');
    expect(text).toContain('60000 USDC or more');
  });

  it('describes a scheduled recipient', () => {
    const policy = input().policy;
    const text = renderPolicyAsSentences({
      ...policy,
      recipients: [
        { ...policy.recipients[0]!, schedule: { dayOfMonth: 1, amountMicroUsd: usdc(3_000) } },
      ],
    }).join('\n');
    expect(text).toContain('scheduled 3000 USDC on day 1');
  });

  it('says so when a mandate grants no autonomy, no vaults and no recipients', () => {
    const policy = input().policy;
    const text = renderPolicyAsSentences({
      ...policy,
      autonomousKinds: [],
      vaults: [],
      recipients: [],
      approvalThresholdByKind: undefined,
    } as PolicyDraft).join('\n');
    expect(text).toContain('everything needs your approval');
    expect(text).toContain('cannot deposit anywhere');
    expect(text).toContain('cannot pay anyone');
    expect(text).not.toContain('ask you only at');
  });

  it('has a sentence for every rule code', () => {
    expect(Object.keys(ruleSentences)).toHaveLength(23);
    expect(Object.values(ruleSentences).every((s) => s.length > 10)).toBe(true);
  });
});

describe('explainVerdict', () => {
  it('explains an ALLOW', () => {
    const text = explainVerdict(evaluate(input()));
    expect(text).toContain('Approved by your mandate.');
    expect(text).toContain('All 22 checks passed.');
    expect(text).toContain('Policy v3');
  });

  it('explains an ESCALATE with the rule sentence and the rule message', () => {
    const text = explainVerdict(evaluate(input({ proposal: withdrawProposal(usdc(20_000)) })));
    expect(text).toContain('Needs your approval.');
    expect(text).toContain(ruleSentences.R10);
    expect(text).toContain('approval threshold');
  });

  it('explains a DENY', () => {
    const text = explainVerdict(evaluate(input({ state: { frozen: true } })));
    expect(text).toContain('Blocked by your mandate.');
    expect(text).toContain(ruleSentences.R01);
  });

  it('names the rules an owner approval lifted', () => {
    const proposal = withdrawProposal(usdc(20_000));
    const base = input({ proposal });
    const verdict = evaluate({
      ...base,
      ownerApproval: {
        signer: ADDR.owner,
        proposalHash: evaluate(base).proposalHash,
        expiresAt: new Date(base.now.getTime() + 60_000),
      },
    });
    expect(explainVerdict(verdict)).toContain('Your approval lifted: R10.');
  });

  it('handles a rule result with no message', () => {
    const verdict = evaluate(input({ proposal: payProposal(usdc(1)) }));
    const text = explainVerdict({
      ...verdict,
      decision: 'DENY',
      results: [{ code: 'R00', result: 'DENY' }],
    });
    expect(text).toContain('R00:');
    expect(text).not.toContain('()');
  });
});
