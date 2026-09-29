import { NextResponse } from 'next/server';
import { getAddress, verifyMessage } from 'viem';
import { z } from 'zod';
import {
  activatePolicyVersion,
  cancelApprovalsForPolicyChange,
  getActivePolicyBody,
  getLatestMandate,
  latestPolicyVersion,
} from '@thesauros/db';
import { hashCanonical, policyActivationMessage, type PolicyDraft } from '@thesauros/shared';
import { renderPolicyAsSentences } from '@thesauros/policy';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { consumePending } from '@/lib/nonce';
import { getSession } from '@/lib/session';
import { db } from '@/lib/db';

/** The ACTIVE policy, for read-only sentences + the opt-in JSON view. `/api/policy/prepare` is the
 * "what would signing do" endpoint; this is "what did I already sign." Null fields mean no policy
 * is active yet. */
export async function GET(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const active = await getActivePolicyBody(db(), auth.wallet.id);
  if (!active) return NextResponse.json({ version: null, sentences: [], body: null });

  return NextResponse.json({
    version: active.version,
    sentences: renderPolicyAsSentences(active.body as PolicyDraft),
    body: active.body,
  });
}

const zBody = z.object({ signature: z.string(), message: z.string() });

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  const parsed = zBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request body' }, { status: 400 });

  const session = await getSession();
  const pendingCheck = await consumePending(session, 'policy-activate', parsed.data.message);
  if (!pendingCheck.ok) return NextResponse.json({ error: pendingCheck.error }, { status: 409 });

  const validSig = await verifyMessage({
    address: getAddress(auth.ownerAddress),
    message: parsed.data.message,
    signature: parsed.data.signature as `0x${string}`,
  }).catch(() => false);
  if (!validSig) return NextResponse.json({ error: 'signature does not verify' }, { status: 401 });

  const database = db();
  const mandate = await getLatestMandate(database, auth.wallet.id);
  if (!mandate?.compiledDraft) {
    return NextResponse.json({ error: 'no compiled mandate draft to activate' }, { status: 409 });
  }
  const version = (await latestPolicyVersion(database, auth.wallet.id)) + 1;
  const bodyHash = hashCanonical(mandate.compiledDraft);
  // The signed message pins version + bodyHash: if either drifted since /api/policy/prepare issued
  // the nonce, the message the owner actually signed won't match what we'd rebuild here.
  const expected = policyActivationMessage({ version, bodyHash });
  if (expected !== parsed.data.message) {
    return NextResponse.json(
      { error: 'policy changed since the nonce was issued; fetch again' },
      { status: 409 },
    );
  }

  const now = new Date();
  // zPolicyDraft makes version/walletId/createdAt/signedBy/signature optional precisely because a
  // draft predates activation (packages/shared/src/schemas/policy.ts); the Policy Engine only ever
  // evaluates a full, signed Policy, so this is where those five envelope fields get added.
  const fullPolicy = {
    ...(mandate.compiledDraft as Record<string, unknown>),
    version,
    walletId: auth.wallet.id,
    createdAt: now.toISOString(),
    signedBy: auth.ownerAddress,
    signature: parsed.data.signature,
  };
  await activatePolicyVersion(database, {
    walletId: auth.wallet.id,
    version,
    mandateId: mandate.id,
    body: fullPolicy,
    bodyHash,
    signature: parsed.data.signature,
    now,
  });
  await cancelApprovalsForPolicyChange(database, auth.wallet.id, version, now);

  return NextResponse.json({ version, bodyHash });
}
