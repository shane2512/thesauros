import { NextResponse } from 'next/server';
import { markAllNotificationsRead } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { db } from '@/lib/db';

export async function POST(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');
  await markAllNotificationsRead(db(), auth.userId, new Date());
  return NextResponse.json({});
}
