import { NextResponse } from 'next/server';
import { z } from 'zod';
import { insertMandate } from '@thesauros/db';
import { getEnv } from '@thesauros/shared';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { bindingForWallet, compileMandateText } from '@/lib/compileMandateForWallet';
import { db } from '@/lib/db';

const zBody = z.object({
  text: z.string().min(1).max(4000),
  template: z.enum(['startup', 'dao', 'creator', 'custom']).default('custom'),
});

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const parsed = zBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'Invalid request body.');

  const env = getEnv();
  if (!env.SERV_API_KEY) {
    return apiError(
      503,
      'not_configured',
      'Reasoning is not configured (SERV_API_KEY unset) — mandate compilation is unavailable.',
    );
  }

  const database = db();
  const binding = await bindingForWallet(database, env, auth.wallet);
  const outcome = await compileMandateText(env, parsed.data.text, binding);

  const mandate = await insertMandate(database, {
    walletId: auth.wallet.id,
    text: parsed.data.text,
    template: parsed.data.template,
    compiledDraft: outcome.compiledDraft,
    assumptions: outcome.assumptions,
    questions: outcome.questions,
  });

  return NextResponse.json({
    mandateId: mandate.id,
    draft: mandate.compiledDraft,
    sentences: outcome.sentences,
    issues: outcome.issues,
    assumptions: outcome.assumptions,
    questions: outcome.questions,
  });
}
