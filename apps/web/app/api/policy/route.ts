import { NextResponse } from 'next/server';
import { getAddress, verifyMessage } from 'viem';
import { z } from 'zod';
import {
  activatePolicyVersion,
  cancelApprovalsForPolicyChange,
  getLatestMandate,
  latestPolicyVersion,
} from '@thesauros/db';
import { hashCanonical, policyActivationMessage } from '@thesauros/shared';
import { requireWallet } from '@/lib/requireWallet';
import { issuePending, consumePending } from '@/lib/nonce';
import { getSession } from '@/lib/session';
import { db } from '@/lib/db';

const ACTIVATE_TTL_MS = 5 * 60 * 1000;

export async function GET(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  const database = db();
  const mandate = await getLatestMandate(database, auth.wallet.id);
  if (!mandate?.compiledDraft) {
    return NextResponse.json({ draft: null, mandateId: mandate?.id ?? null });
  }

  const nextVersion = (await latestPolicyVersion(database, auth.wallet.id)) + 1;
  const bodyHash = hashCanonical(mandate.compiledDraft);
  const message = policyActivationMessage({ version: nextVersion, bodyHash });
  const session = await getSession();
  await issuePending(session, 'policy-activate', message, ACTIVATE_TTL_MS);

  return NextResponse.json({
    mandateId: mandate.id,
    draft: mandate.compiledDraft,
    version: nextVersion,
    bodyHash,
    message,
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
  // The signed message pins version + bodyHash: if either drifted since GET issued the nonce, the
  // message the owner actually signed won't match what we'd rebuild here, so re-derive and compare.
  const expected = policyActivationMessage({ version, bodyHash });
  if (expected !== parsed.data.message) {
    return NextResponse.json(
      { error: 'policy changed since the nonce was issued; fetch again' },
      { status: 409 },
    );
  }

  const now = new Date();
  await activatePolicyVersion(database, {
    walletId: auth.wallet.id,
    version,
    mandateId: mandate.id,
    body: mandate.compiledDraft,
    bodyHash,
    signature: parsed.data.signature,
    now,
  });
  await cancelApprovalsForPolicyChange(database, auth.wallet.id, version, now);

  return NextResponse.json({ version, bodyHash });
}
