// Pilot report: what Thesauros proposed for a team versus what the team actually paid.
//   pnpm pilot:report <ownerAddress | walletId> --paid paid.csv [--team "Name"] [--days 7] [--apy 4]
// paid.csv has a header row: date,recipient,amount   e.g.  2026-10-15,Asha,500
import { readFileSync } from 'node:fs';
import { createDb } from '@thesauros/db';
import { getEnv } from '@thesauros/shared';
import {
  compareShadowWeek,
  renderShadowReport,
  type PaidRow,
  type ProposalRow,
} from '../../apps/worker/src/shadowReport';

try {
  process.loadEnvFile(new URL('../../.env.local', import.meta.url));
} catch {
  /* env may come from the shell */
}
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const who = args.find(
  (a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true,
);
const paidFile = flag('paid');
if (!who || !paidFile) {
  console.error(
    'usage: pnpm pilot:report <ownerAddress | walletId> --paid paid.csv [--team "Name"] [--days 7] [--apy 4]',
  );
  process.exit(1);
}
const days = Number(flag('days') ?? '7');
const apyBps = BigInt(Math.round(Number(flag('apy') ?? '4') * 100));

const micro = (s: string): bigint => {
  const [whole = '0', frac = ''] = s.trim().replace(/,/g, '').split('.');
  return BigInt(whole) * 1_000_000n + BigInt((frac + '000000').slice(0, 6));
};
const paid: PaidRow[] = readFileSync(paidFile, 'utf8')
  .split(/\r?\n/)
  .slice(1)
  .filter((l) => l.trim())
  .map((l) => {
    const [date, recipient, amount] = l.split(',').map((c) => c.trim());
    return {
      date: new Date(`${date}T12:00:00Z`),
      recipient: recipient ?? '',
      amount: micro(amount ?? '0'),
    };
  });

const { pool } = createDb(getEnv().DATABASE_URL);
const wallet = (
  await pool.query(
    `select w.id, u.owner_address from wallets w join users u on u.id = w.user_id
     where w.id::text = $1 or lower(u.owner_address) = lower($1)`,
    [who],
  )
).rows[0] as { id: string; owner_address: string } | undefined;
if (!wallet) {
  console.error(`no wallet for "${who}"`);
  await pool.end();
  process.exit(1);
}

const policy = (
  await pool.query(`select body from policies where wallet_id = $1 and status = 'active'`, [
    wallet.id,
  ])
).rows[0] as { body: { recipients?: { id: string; label: string }[] } } | undefined;
const labels = new Map((policy?.body.recipients ?? []).map((r) => [r.id, r.label]));

const rows = (
  await pool.query(
    `select d.id, d.created_at, d.status, d.proposal,
            coalesce((select array_agg(r->>'code') from verdicts v, jsonb_array_elements(v.results) r
                      where v.decision_id = d.id and r->>'result' <> 'PASS'), '{}') as codes
     from agent_decisions d
     where d.wallet_id = $1 and d.proposal is not null and d.created_at > now() - ($2 || ' days')::interval
     order by d.created_at`,
    [wallet.id, String(days)],
  )
).rows as {
  id: string;
  created_at: Date;
  status: string;
  proposal: { kind: string; params?: Record<string, unknown> };
  codes: string[];
}[];

const proposals: ProposalRow[] = rows.map((r) => {
  const p = r.proposal.params ?? {};
  return {
    decisionId: r.id,
    at: r.created_at,
    kind: r.proposal.kind,
    status: r.status,
    recipient:
      typeof p['recipientId'] === 'string'
        ? (labels.get(p['recipientId']) ?? p['recipientId'])
        : undefined,
    obligationId: typeof p['obligationId'] === 'string' ? p['obligationId'] : undefined,
    amount: BigInt(String(p['amount'] ?? '0')),
    codes: r.codes,
  };
});

const report = compareShadowWeek(proposals, paid, { windowDays: days, apyBps });
console.log(renderShadowReport(flag('team') ?? wallet.owner_address, report));
await pool.end();
