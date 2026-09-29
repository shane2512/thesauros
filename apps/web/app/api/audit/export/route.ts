import { listAuditPage } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { db } from '@/lib/db';

const PAGE = 1000;

const csvField = (v: unknown): string => `"${String(v).replace(/"/g, '""')}"`;

/** The whole chain, oldest-first, as CSV or JSON. Same rows `/api/audit` shows, unpaginated — a
 * hackathon-scale wallet's chain fits comfortably in memory (see listAuditPage's own ponytail note). */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const format = new URL(req.url).searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const database = db();
  const rows = [];
  let afterId: number | undefined;
  for (;;) {
    const page = await listAuditPage(database, auth.wallet.id, {
      limit: PAGE,
      ...(afterId ? { afterId } : {}),
    });
    rows.push(...page);
    const last = page[page.length - 1];
    if (page.length < PAGE || !last) break;
    afterId = last.id;
  }

  if (format === 'json') {
    return new Response(JSON.stringify({ entries: rows }, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const header = 'id,createdAt,actor,event,entityType,entityId,rowHash,prevHash';
  const lines = rows.map((r) =>
    [
      r.id,
      r.createdAt.toISOString(),
      r.actor,
      r.event,
      r.entityType ?? '',
      r.entityId ?? '',
      r.rowHash,
      r.prevHash,
    ]
      .map(csvField)
      .join(','),
  );
  return new Response([header, ...lines].join('\n'), { headers: { 'content-type': 'text/csv' } });
}
