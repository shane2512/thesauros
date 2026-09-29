import { NextResponse } from 'next/server';
import { getVerdictForDecision, listAgentDecisions } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { toDecisionItem } from '@/lib/decisions';
import { db } from '@/lib/db';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const url = new URL(req.url);
  const before = url.searchParams.get('before');
  const database = db();
  const rows = await listAgentDecisions(database, auth.wallet.id, {
    limit: 50,
    ...(before ? { before: new Date(before) } : {}),
  });
  const decisions = await Promise.all(
    rows.map(async (row) => toDecisionItem(row, await getVerdictForDecision(database, row.id))),
  );
  const last = rows[rows.length - 1];
  return NextResponse.json({
    decisions,
    nextCursor: rows.length === 50 && last ? last.createdAt.toISOString() : null,
  });
}
