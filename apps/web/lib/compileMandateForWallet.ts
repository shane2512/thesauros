// Shared by /api/mandate (a fresh compile of new text) and /api/policy/prepare (a re-compile of the
// latest mandate's text against whatever recipients/vaults exist right now). Recompiling on every
// prepare — rather than replaying a stale compiledDraft — is what makes "add a recipient, then sign
// the next policy version" actually pick up the new recipient: a recipient added after the mandate
// was last compiled is invisible to a stored draft, since compileMandate only ever sees the
// recipients/vaults that existed at compile time.
import { getAddress } from 'viem';
import { listRecipients, listVaultRows, type Db } from '@thesauros/db';
import { canonicalJson, zVaultKind, type Env } from '@thesauros/shared';
import { compileMandate, LiveServClient } from '@thesauros/reasoning';
import type { TemplateBinding } from '@thesauros/policy';

export async function bindingForWallet(
  database: Db,
  env: Env,
  wallet: { id: string; treasuryAddress: string },
): Promise<TemplateBinding> {
  const [recipients, vaults] = await Promise.all([
    listRecipients(database, wallet.id),
    listVaultRows(database, wallet.id),
  ]);
  return {
    chainId: env.CHAIN_ID as 5042002 | 5042,
    treasuryAddress: getAddress(wallet.treasuryAddress),
    usdcAddress: getAddress(env.USDC_ADDRESS),
    vaults: vaults.map((v) => ({
      id: v.id,
      name: v.name,
      address: getAddress(v.address),
      // `vaults.kind` is a free-text DB column (packages/db/src/schema.ts); fall back to the
      // original 'erc4626' default for any row that predates D-024 rather than throwing.
      kind: zVaultKind.catch('erc4626').parse(v.kind),
      maxAllocationBps: v.maxAllocationBps,
    })),
    recipients: recipients.map((r) => ({
      id: r.id,
      label: r.label,
      address: getAddress(r.address),
      maxPerTxMicroUsd: r.maxPerTx.toString(),
    })),
  };
}

export async function compileMandateText(
  env: Env,
  text: string,
  binding: TemplateBinding,
): Promise<{
  compiledDraft: unknown;
  sentences: string[];
  issues: unknown[];
  assumptions: string[];
  questions: string[];
}> {
  if (!env.SERV_API_KEY) throw new Error('SERV_API_KEY is not configured');
  const client = new LiveServClient({ apiKey: env.SERV_API_KEY, baseURL: env.SERV_BASE_URL });
  const outcome = await compileMandate({
    client,
    model: env.SERV_MODEL_PROPOSER,
    mandateText: text,
    binding,
  });
  return {
    compiledDraft: outcome.draft ? (JSON.parse(canonicalJson(outcome.draft)) as unknown) : null,
    sentences: outcome.sentences,
    issues: outcome.issues,
    assumptions: outcome.assumptions,
    questions: outcome.questions,
  };
}
