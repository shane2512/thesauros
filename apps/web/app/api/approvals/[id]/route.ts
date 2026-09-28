import { NextResponse } from 'next/server';
import { getAddress, verifyMessage } from 'viem';
import { z } from 'zod';
import { getApproval, decideApproval, appendAudit } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { boss, APPROVALS_EXECUTE_QUEUE } from '@/lib/boss';
import { db } from '@/lib/db';

const zBody = z.object({ decision: z.enum(['approved', 'rejected']), signature: z.string() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  const { id } = await params;
  const parsed = zBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request body' }, { status: 400 });

  const database = db();
  const approval = await getApproval(database, id);
  if (!approval || approval.walletId !== auth.wallet.id) {
    return NextResponse.json({ error: 'approval not found' }, { status: 404 });
  }
  if (approval.status !== 'pending') {
    return NextResponse.json({ error: `approval is already ${approval.status}` }, { status: 409 });
  }
  if (new Date(approval.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: 'approval has expired' }, { status: 409 });
  }

  // A quick, user-facing check; `executeApproval` (worker) re-verifies independently before it
  // actually sends anything, so a bad signature here is refused twice, not trusted once.
  const validSig = await verifyMessage({
    address: getAddress(auth.ownerAddress),
    message: approval.message,
    signature: parsed.data.signature as `0x${string}`,
  }).catch(() => false);
  if (!validSig) return NextResponse.json({ error: 'signature does not verify' }, { status: 401 });

  const now = new Date();
  const decided = await decideApproval(
    database,
    id,
    parsed.data.decision,
    now,
    parsed.data.signature,
  );
  if (!decided) {
    return NextResponse.json(
      { error: 'approval was already decided (replay guard)' },
      { status: 409 },
    );
  }
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

  return NextResponse.json({ status: decided.status });
}
