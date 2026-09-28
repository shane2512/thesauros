import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAddress } from 'viem';
import { insertMandate, listRecipients, listVaultRows } from '@thesauros/db';
import { getEnv } from '@thesauros/shared';
import { compileMandate, LiveServClient } from '@thesauros/reasoning';
import type { TemplateBinding } from '@thesauros/policy';
import { requireWallet } from '@/lib/requireWallet';
import { db } from '@/lib/db';

const zBody = z.object({
  text: z.string().min(1).max(4000),
  template: z.enum(['startup', 'dao', 'creator', 'custom']).default('custom'),
});

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  const parsed = zBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request body' }, { status: 400 });

  const env = getEnv();
  if (!env.SERV_API_KEY) {
    return NextResponse.json(
      {
        error:
          'reasoning is not configured (SERV_API_KEY unset) — mandate compilation is unavailable',
      },
      { status: 503 },
    );
  }

  const database = db();
  const [recipients, vaults] = await Promise.all([
    listRecipients(database, auth.wallet.id),
    listVaultRows(database, auth.wallet.id),
  ]);

  const binding: TemplateBinding = {
    chainId: env.CHAIN_ID as 5042002 | 5042, // env schema only ever parses one of these two
    treasuryAddress: getAddress(auth.wallet.treasuryAddress),
    usdcAddress: getAddress(env.USDC_ADDRESS),
    vaults: vaults.map((v) => ({
      id: v.id,
      name: v.name,
      address: getAddress(v.address),
      maxAllocationBps: v.maxAllocationBps,
    })),
    recipients: recipients.map((r) => ({
      id: r.id,
      label: r.label,
      address: getAddress(r.address),
      maxPerTxMicroUsd: r.maxPerTx.toString(),
    })),
  };

  const client = new LiveServClient({ apiKey: env.SERV_API_KEY, baseURL: env.SERV_BASE_URL });
  const outcome = await compileMandate({
    client,
    model: env.SERV_MODEL_PROPOSER,
    mandateText: parsed.data.text,
    binding,
  });

  const mandate = await insertMandate(database, {
    walletId: auth.wallet.id,
    text: parsed.data.text,
    template: parsed.data.template,
    compiledDraft: outcome.draft ?? null,
    assumptions: outcome.assumptions,
    questions: outcome.questions,
  });

  return NextResponse.json({
    mandateId: mandate.id,
    draft: outcome.draft ?? null,
    sentences: outcome.sentences,
    issues: outcome.issues,
    assumptions: outcome.assumptions,
    questions: outcome.questions,
  });
}
