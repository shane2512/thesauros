// Shadow-mode pilot report: what Thesauros proposed for a team versus what the team actually paid.
// Pure and deterministic (no I/O, no clock): the script feeds it rows from the database and a CSV.

export type ProposalRow = {
  decisionId: string;
  at: Date;
  kind: string;
  /** agent_decisions.status: allowed | escalated | denied | ... */
  status: string;
  recipient?: string | undefined;
  obligationId?: string | undefined;
  /** Base units (6 decimals). */
  amount: bigint;
  /** Rule codes that did not pass (what blocked or escalated it). */
  codes: string[];
};

export type PaidRow = { date: Date; recipient: string; amount: bigint };

export type ShadowOptions = {
  /** A payment counts as the same one if it happened within this many days of the proposal. */
  dayTolerance?: number;
  /** ...and its amount is within this many basis points. */
  amountToleranceBps?: bigint;
  /** Annual yield assumed for the idle-cash estimate, in basis points. */
  apyBps?: bigint;
  /** Length of the observed window, for the yield estimate. */
  windowDays?: number;
};

export type ShadowReport = {
  matched: { proposal: ProposalRow; paid: PaidRow }[];
  proposedNotPaid: ProposalRow[];
  paidNotProposed: PaidRow[];
  possibleDuplicates: PaidRow[][];
  blocked: ProposalRow[];
  idle: { amount: bigint; estimatedYield: bigint; windowDays: number; apyBps: bigint };
};

const DAY_MS = 86_400_000;
const norm = (s: string) => s.trim().toLowerCase();

/** The loop re-proposes an unpaid obligation every day in shadow mode; count each one once. */
function uniqueByObligation(rows: ProposalRow[]): ProposalRow[] {
  const seen = new Map<string, ProposalRow>();
  for (const r of [...rows].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const key = `${norm(r.recipient ?? '')}|${r.amount}|${r.obligationId ?? ''}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

export function compareShadowWeek(
  proposals: ProposalRow[],
  paid: PaidRow[],
  options: ShadowOptions = {},
): ShadowReport {
  const dayTolerance = options.dayTolerance ?? 3;
  const tolBps = options.amountToleranceBps ?? 100n;
  const apyBps = options.apyBps ?? 400n;
  const windowDays = options.windowDays ?? 7;

  const blocked = proposals.filter((p) => p.status === 'denied');
  const payments = uniqueByObligation(
    proposals.filter((p) => p.kind === 'pay_recipient' && p.status !== 'denied'),
  );

  const available = paid.map((row) => ({ row, used: false }));
  const matched: ShadowReport['matched'] = [];
  const proposedNotPaid: ProposalRow[] = [];

  for (const p of payments) {
    const hit = available.find((a) => {
      if (a.used || norm(a.row.recipient) !== norm(p.recipient ?? '')) return false;
      const days = Math.abs(a.row.date.getTime() - p.at.getTime()) / DAY_MS;
      if (days > dayTolerance) return false;
      const diff = a.row.amount > p.amount ? a.row.amount - p.amount : p.amount - a.row.amount;
      return diff * 10_000n <= p.amount * tolBps;
    });
    if (hit) {
      hit.used = true;
      matched.push({ proposal: p, paid: hit.row });
    } else proposedNotPaid.push(p);
  }

  const paidNotProposed = available.filter((a) => !a.used).map((a) => a.row);

  // Two payments to the same recipient for the same amount within a week look like a double payment.
  const possibleDuplicates: PaidRow[][] = [];
  const grouped = new Map<string, PaidRow[]>();
  for (const row of paid) {
    const key = `${norm(row.recipient)}|${row.amount}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  for (const rows of grouped.values()) {
    const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
    const close = sorted.some((r, i) => {
      const before = sorted[i - 1];
      return before !== undefined && r.date.getTime() - before.date.getTime() <= 7 * DAY_MS;
    });
    if (close) possibleDuplicates.push(sorted);
  }

  // Idle cash: the largest deposit Thesauros wanted to make (each day's proposal is the same pot).
  const deposits = proposals.filter((p) => p.kind === 'vault_deposit' && p.status !== 'denied');
  const idle = deposits.reduce((m, p) => (p.amount > m ? p.amount : m), 0n);
  const estimatedYield = (idle * apyBps * BigInt(windowDays)) / (10_000n * 365n);

  return {
    matched,
    proposedNotPaid,
    paidNotProposed,
    possibleDuplicates,
    blocked,
    idle: { amount: idle, estimatedYield, windowDays, apyBps },
  };
}

const usdc = (v: bigint): string => {
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole.toLocaleString('en-US')}.${frac}`;
};
const day = (d: Date) => d.toISOString().slice(0, 10);

export function renderShadowReport(team: string, r: ShadowReport): string {
  const lines: string[] = [];
  lines.push(`# Thesauros shadow week: ${team}`);
  lines.push('');
  lines.push(
    'Thesauros proposed every payment while the team kept paying the way it does today. Nothing was sent by Thesauros.',
  );
  lines.push('');
  const total = r.matched.length + r.proposedNotPaid.length;
  lines.push(`- Payments Thesauros proposed: **${total}**`);
  lines.push(`- Matched what the team actually paid: **${r.matched.length}**`);
  lines.push(`- Proposed but not paid by the team: **${r.proposedNotPaid.length}**`);
  lines.push(`- Paid by the team but not proposed: **${r.paidNotProposed.length}**`);
  lines.push(
    `- Possible double payments in the team's own ledger: **${r.possibleDuplicates.length}**`,
  );
  lines.push(`- Proposals blocked by the policy: **${r.blocked.length}**`);
  lines.push('');
  if (r.matched.length > 0) {
    lines.push(
      '## Matched',
      '',
      '| Recipient | Proposed | Paid | Amount (USDC) |',
      '|---|---|---|---|',
    );
    for (const m of r.matched)
      lines.push(
        `| ${m.proposal.recipient ?? ''} | ${day(m.proposal.at)} | ${day(m.paid.date)} | ${usdc(m.paid.amount)} |`,
      );
    lines.push('');
  }
  if (r.proposedNotPaid.length > 0) {
    lines.push('## Thesauros proposed it, the team did not pay it', '');
    for (const p of r.proposedNotPaid)
      lines.push(`- ${p.recipient ?? 'unknown'}: ${usdc(p.amount)} USDC (proposed ${day(p.at)})`);
    lines.push('');
  }
  if (r.paidNotProposed.length > 0) {
    lines.push('## The team paid it, Thesauros did not propose it', '');
    for (const p of r.paidNotProposed)
      lines.push(`- ${p.recipient}: ${usdc(p.amount)} USDC (paid ${day(p.date)})`);
    lines.push('');
  }
  if (r.possibleDuplicates.length > 0) {
    lines.push('## Possible double payments', '');
    for (const group of r.possibleDuplicates) {
      const first = group[0];
      if (!first) continue;
      lines.push(
        `- ${first.recipient}: ${usdc(first.amount)} USDC paid ${group.map((g) => day(g.date)).join(' and ')}`,
      );
    }
    lines.push('');
  }
  if (r.blocked.length > 0) {
    lines.push('## Blocked by the rules', '');
    for (const b of r.blocked)
      lines.push(
        `- ${b.kind} ${usdc(b.amount)} USDC${b.recipient ? ` to ${b.recipient}` : ''}: ${b.codes.join(', ') || 'denied'}`,
      );
    lines.push('');
  }
  lines.push(
    '## Idle cash',
    '',
    `Thesauros would have put **${usdc(r.idle.amount)} USDC** of idle cash to work. At an assumed ${Number(r.idle.apyBps) / 100}% a year, over ${r.idle.windowDays} days that is about **${usdc(r.idle.estimatedYield)} USDC** (an estimate, not a result).`,
    '',
  );
  return lines.join('\n');
}
