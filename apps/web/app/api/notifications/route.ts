import { NextResponse } from 'next/server';
import { listNotifications } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { db } from '@/lib/db';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const before = new URL(req.url).searchParams.get('before');
  const rows = await listNotifications(db(), auth.userId, {
    limit: 50,
    ...(before ? { beforeId: before } : {}),
  });
  const last = rows[rows.length - 1];
  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      read: r.readAt !== null,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: rows.length === 50 && last ? last.id : null,
    unreadCount: rows.filter((r) => r.readAt === null).length,
  });
}
