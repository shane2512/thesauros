// The shadow verifier (SERV_REASONING §4.7 / PHASES 6.1): a second, independent pass over the SAME
// context and the proposal the first pass produced. It never proposes a replacement action and it
// never reaches the executor directly — `runIteration` only feeds its verdict into `evaluate()`.
//
// A model failure here is UNSURE, never AGREE: an unreachable verifier must not silently waive R15.
import type { Context } from '@thesauros/context';
import type { Proposal } from '@thesauros/shared';
import { callJson, type CallMeta } from './call';
import { buildVerifierPrompt } from './prompts';
import { SERV_SCHEMAS, zServVerification } from './schemas';
import type { ServClient } from './serv/client';

export type VerifyInput = {
  client: ServClient;
  model: string;
  ctx: Context;
  proposal: Proposal;
  decimals: number;
};

export type VerifyOutcome = {
  verifier: { verdict: 'AGREE' | 'DISAGREE' | 'UNSURE'; reasons: string[] };
  checkedFactIds: string[];
  meta?: CallMeta;
};

export function describeAction(proposal: Proposal): string {
  switch (proposal.kind) {
    case 'noop':
      return 'do nothing';
    case 'pull_allowance':
      return `pull ${proposal.params.amount} from the spend allowance`;
    case 'vault_deposit':
      return `deposit ${proposal.params.amount} into vault ${proposal.params.vaultId}`;
    case 'vault_withdraw':
      return `withdraw ${proposal.params.amount} from vault ${proposal.params.vaultId}`;
    case 'pay_recipient':
      return `pay ${proposal.params.amount} to recipient ${proposal.params.recipientId}`;
    case 'risk_exit':
      return `exit vault ${proposal.params.vaultId} on ${proposal.params.trigger}`;
    case 'sweep_home':
      return 'sweep the treasury home';
  }
}

export async function verify(input: VerifyInput): Promise<VerifyOutcome> {
  const res = await callJson({
    client: input.client,
    task: 'verify',
    model: input.model,
    prompt: buildVerifierPrompt({ ctx: input.ctx, proposal: input.proposal }),
    schema: SERV_SCHEMAS.verify,
    parser: zServVerification,
  });

  if (!res.ok) {
    return {
      verifier: { verdict: 'UNSURE', reasons: [`verifier unavailable (${res.error.error.code})`] },
      checkedFactIds: [],
      meta: res.error.meta,
    };
  }

  const out = res.value.value;
  return {
    verifier: { verdict: out.verdict, reasons: out.reasons },
    checkedFactIds: out.checkedFactIds,
    meta: res.value.meta,
  };
}
