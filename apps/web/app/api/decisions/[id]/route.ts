import { NextResponse } from 'next/server';
import { getAgentDecision, getSimulationForDecision, getVerdictForDecision } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { toDecisionDetail } from '@/lib/decisions';
import { db } from '@/lib/db';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const { id } = await params;
  const database = db();
  const row = await getAgentDecision(database, id);
  if (!row || row.walletId !== auth.wallet.id)
    return apiError(404, 'not_found', 'Decision not found.');

  const [verdict, simulation] = await Promise.all([
    getVerdictForDecision(database, id),
    getSimulationForDecision(database, id),
  ]);
  return NextResponse.json(toDecisionDetail(row, verdict, simulation));
}
