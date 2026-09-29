import { NextResponse } from 'next/server';
import { getAgentDecision, listApprovals, type ApprovalRow } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { db } from '@/lib/db';

const STATUSES = new Set(['pending', 'approved', 'rejected', 'expired', 'cancelled']);

async function toApproval(database: ReturnType<typeof db>, row: ApprovalRow) {
  const decision = await getAgentDecision(database, row.decisionId);
  const proposal = decision?.proposal as { rationale?: string } | null | undefined;
  return {
    id: row.id,
    decisionId: row.decisionId,
    proposalHash: row.proposalHash,
    status: row.status,
    message: row.message,
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rationale: proposal?.rationale ?? null,
  };
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const statusParam = new URL(req.url).searchParams.get('status');
  const status =
    statusParam && STATUSES.has(statusParam) ? (statusParam as ApprovalRow['status']) : undefined;

  const database = db();
  const rows = await listApprovals(database, auth.wallet.id, status);
  const approvals = await Promise.all(rows.map((row) => toApproval(database, row)));
  return NextResponse.json({ approvals });
}
