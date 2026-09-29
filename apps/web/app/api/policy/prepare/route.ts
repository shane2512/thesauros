import { NextResponse } from 'next/server';
import { getLatestMandate, insertMandate, latestPolicyVersion } from '@thesauros/db';
import {
  getEnv,
  hashCanonical,
  policyActivationMessage,
  type PolicyDraft,
} from '@thesauros/shared';
import { renderPolicyAsSentences } from '@thesauros/policy';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { bindingForWallet, compileMandateText } from '@/lib/compileMandateForWallet';
import { issuePending } from '@/lib/nonce';
import { getSession } from '@/lib/session';
import { db } from '@/lib/db';

const ACTIVATE_TTL_MS = 5 * 60 * 1000;

/**
 * The literal activation message plus what it commits to — what PolicySign shows and signs. Split
 * from GET /api/policy (the ACTIVE policy view) because they answer different questions: this is
 * "what would signing do right now," that is "what did I already sign."
 *
 * Recompiles the latest mandate's TEXT against whatever recipients/vaults exist right now, rather
 * than replaying the stored compiledDraft: a recipient added after the mandate was last compiled is
 * invisible to a stale draft, so "add a recipient, then sign the next policy version" (the
 * Recipients screen's own flow) would otherwise silently sign a policy that still can't pay them.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const database = db();
  const latest = await getLatestMandate(database, auth.wallet.id);
  if (!latest) return apiError(409, 'no_draft', 'There is no compiled policy to sign.');

  const env = getEnv();
  if (!env.SERV_API_KEY) {
    return apiError(
      503,
      'not_configured',
      'Reasoning is not configured — mandate compilation is unavailable.',
    );
  }

  const binding = await bindingForWallet(database, env, auth.wallet);
  const outcome = await compileMandateText(env, latest.text, binding);
  if (!outcome.compiledDraft) {
    return apiError(
      409,
      'no_draft',
      'The mandate does not compile cleanly against the current recipients/vaults.',
    );
  }

  // A fresh mandate row: the one just activated (if any) stays the historical record of what was
  // actually signed, and this new row is what /api/policy's POST will activate.
  const mandate = await insertMandate(database, {
    walletId: auth.wallet.id,
    text: latest.text,
    template: latest.template,
    compiledDraft: outcome.compiledDraft,
    assumptions: outcome.assumptions,
    questions: outcome.questions,
  });

  const nextVersion = (await latestPolicyVersion(database, auth.wallet.id)) + 1;
  const bodyHash = hashCanonical(mandate.compiledDraft);
  const message = policyActivationMessage({ version: nextVersion, bodyHash });
  const session = await getSession();
  await issuePending(session, 'policy-activate', message, ACTIVATE_TTL_MS);

  return NextResponse.json({
    version: nextVersion,
    bodyHash,
    message,
    sentences: renderPolicyAsSentences(mandate.compiledDraft as PolicyDraft),
  });
}
