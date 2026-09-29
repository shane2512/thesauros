import { NextResponse } from 'next/server';
import { verifyChain } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { db } from '@/lib/db';

/** Read-only recompute of this wallet's audit hash chain (I6). Never mutates anything. */
export async function GET(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const result = await verifyChain(db(), auth.wallet.id);
  if (!result.ok) return NextResponse.json({ ok: false, break: result.error });
  return NextResponse.json({ ok: true, rows: result.value.rows });
}
