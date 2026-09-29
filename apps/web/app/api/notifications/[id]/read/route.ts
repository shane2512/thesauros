import { NextResponse } from 'next/server';
import { markNotificationRead } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { db } from '@/lib/db';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');
  const { id } = await params;
  await markNotificationRead(db(), auth.userId, id, new Date());
  return NextResponse.json({});
}
