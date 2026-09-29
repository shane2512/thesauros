import { NextResponse } from 'next/server';
import { getAddress, verifyMessage } from 'viem';
import { z } from 'zod';
import { getApproval, decideApproval, appendAudit } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { boss, APPROVALS_EXECUTE_QUEUE } from '@/lib/boss';
import { db } from '@/lib/db';

// Rejecting only ever prevents an action, so it needs no signature — it can't move money either
// way, and requiring one would add friction with no security benefit. Approving does need one: it
// lifts an ESCALATE rule, which is a real decision the owner has to actually stand behind.
const zBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  signature: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const { id } = await params;
  const parsed = zBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'Invalid request body.');

  const database = db();
  const approval = await getApproval(database, id);
  if (!approval || approval.walletId !== auth.wallet.id) {
    return apiError(404, 'not_found', 'Approval not found.');
  }
  if (approval.status !== 'pending') {
    return apiError(409, 'not_pending', `This was already ${approval.status}.`);
  }
  if (new Date(approval.expiresAt).getTime() < Date.now()) {
    return apiError(409, 'expired', 'This approval expired.');
  }

  if (parsed.data.decision === 'approved') {
    if (!parsed.data.signature)
      return apiError(400, 'bad_request', 'A signature is required to approve.');
    // A quick, user-facing check; `executeApproval` (worker) re-verifies independently before it
    // actually sends anything, so a bad signature here is refused twice, not trusted once.
    const validSig = await verifyMessage({
      address: getAddress(auth.ownerAddress),
      message: approval.message,
      signature: parsed.data.signature as `0x${string}`,
    }).catch(() => false);
    if (!validSig) return apiError(401, 'bad_signature', 'That signature was not accepted.');
  }

  const now = new Date();
  const decided = await decideApproval(
    database,
    id,
    parsed.data.decision,
    now,
    parsed.data.signature,
  );
  if (!decided) return apiError(409, 'not_pending', 'This was already decided.');

  await appendAudit(database, {
    walletId: auth.wallet.id,
    actor: 'owner',
    event: parsed.data.decision === 'approved' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
    entityType: 'approval',
    entityId: id,
    payload: { proposalHash: approval.proposalHash },
    createdAt: now,
  });

  if (parsed.data.decision === 'approved') {
    const b = await boss();
    await b.send(APPROVALS_EXECUTE_QUEUE, { approvalId: id });
  }

  return NextResponse.json({ approval: { id, status: decided.status } });
}
