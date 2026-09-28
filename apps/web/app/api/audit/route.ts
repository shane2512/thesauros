import { NextResponse } from 'next/server';
import { listAuditPage } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { db } from '@/lib/db';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), 500);
  const afterIdParam = url.searchParams.get('afterId');
  const afterId = afterIdParam ? Number(afterIdParam) : undefined;

  const rows = await listAuditPage(db(), auth.wallet.id, {
    limit,
    ...(afterId ? { afterId } : {}),
  });
  // ponytail: listAuditPage is oldest-first (export use case); the dashboard wants newest-first, and
  // a hackathon-scale wallet's page is small enough that reversing in memory is fine.
  return NextResponse.json({ entries: [...rows].reverse() });
}
