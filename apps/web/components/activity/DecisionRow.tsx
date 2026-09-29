'use client';
// Timeline items. `DecisionRow` is the compact dashboard line; `DecisionCard` is the Activity feed
// card. The verdict is a glyph AND a word, never colour alone; a decision that never reached the
// engine says so too.
import Link from 'next/link';
import {
  IconActivity,
  IconHomeward,
  IconRecipients,
  IconShieldAlert,
  IconSign,
  IconTrend,
  IconVault,
  type IconComponent,
} from '@/components/icons';
import { Row, VerdictBadge, toneOf } from '@/components/primitives';
import type { DecisionItem } from '@/lib/contracts';
import { formatAgo, formatToken, formatWhen, toBig } from '@/lib/format';

const ICONS: Record<string, IconComponent> = {
  pay_recipient: IconRecipients,
  vault_deposit: IconTrend,
  vault_withdraw: IconVault,
  risk_exit: IconShieldAlert,
  sweep_home: IconHomeward,
};

export const decisionIcon = (kind: string | null): IconComponent =>
  (kind ? ICONS[kind] : undefined) ?? IconActivity;

/** "R05" -> "R-05" for display (the API keeps the engine's own code). */
export const ruleLabel = (code: string): string => code.replace(/^R(\d+)$/, 'R-$1');

/** Money leaving the treasury reads negative; parking cash in the vault is neither in nor out. */
const OUTFLOW = new Set(['pay_recipient']);

export function VerdictOrNone({ item }: { item: DecisionItem }) {
  if (item.verdict) return <VerdictBadge tone={toneOf(item.verdict.decision)} />;
  return <span className="text-meta font-semibold text-muted">No action taken</span>;
}

export function DecisionRow({
  item,
  now,
  href,
}: {
  item: DecisionItem;
  variant?: 'compact';
  now?: Date;
  href?: string;
}) {
  const denied = item.verdict?.decision === 'DENY';
  const right = (
    <>
      {item.amount !== null ? (
        <span className="tabular block text-small font-bold text-ink">
          {formatToken(toBig(item.amount))}
        </span>
      ) : (
        <span className="block text-muted">{denied ? 'blocked' : ''}</span>
      )}
      <span className="block text-cap text-muted">
        {formatAgo(item.createdAt, now)}
        {item.flaggedRules.length > 0 ? ` · ${item.flaggedRules.map(ruleLabel).join(' ')}` : ''}
      </span>
    </>
  );
  return (
    <Row
      icon={decisionIcon(item.kind)}
      title={item.title}
      sub={<VerdictOrNone item={item} />}
      right={right}
      href={href}
      tone={denied ? 'deny' : undefined}
    />
  );
}

export function DecisionCard({ item, now }: { item: DecisionItem; now: Date }) {
  const v = item.verdict?.decision;
  const Icon = decisionIcon(item.kind);
  const amount = item.amount !== null ? toBig(item.amount) : null;
  const sign = amount !== null && item.kind !== null && OUTFLOW.has(item.kind) ? '− ' : '';
  return (
    <article
      className={`card relative flex flex-col gap-2.5 p-4 transition-colors hover:bg-surface-2/60 ${
        v === 'ESCALATE' ? 'ring-1 ring-accent' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${
              v === 'ESCALATE'
                ? 'bg-accent text-on-accent'
                : v === 'DENY'
                  ? 'bg-deny-tint text-deny'
                  : 'bg-surface-3 text-ink'
            }`}
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <Link
              href={`/app/activity/${item.id}`}
              className="block text-title leading-[22px] font-semibold text-ink after:absolute after:inset-0 after:rounded-md"
            >
              {item.title}
            </Link>
            <p className="pt-0.5 text-cap text-muted">
              {formatWhen(item.createdAt, now)} · {formatAgo(item.createdAt, now)}
              {item.kind ? ` · ${item.kind.replace(/_/g, ' ')}` : ''}
            </p>
          </div>
        </div>
        {amount !== null ? (
          <div className="shrink-0 text-right">
            <p className="tabular text-lead leading-6 font-bold text-ink">
              {sign}
              {formatToken(amount)}
            </p>
            <p className="label">USDC</p>
          </div>
        ) : null}
      </div>

      <p className="line-clamp-2 text-meta leading-[18px] text-muted">{item.explanation}</p>

      <div className="flex flex-wrap items-center gap-2">
        <VerdictOrNone item={item} />
        {item.verdict ? (
          <span className="text-cap text-muted">policy v{item.verdict.policyVersion}</span>
        ) : null}
        {item.flaggedRules.map((r) => (
          <span
            key={r}
            className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-cap text-ink"
          >
            {ruleLabel(r)}
          </span>
        ))}
      </div>

      {v === 'ESCALATE' ? (
        <Link
          href={`/app/approvals?decision=${encodeURIComponent(item.id)}`}
          className="relative z-10 mt-1 inline-flex h-11 items-center justify-center gap-1.5 rounded-sm bg-accent text-ui font-bold text-on-accent hover:bg-accent-press active:scale-[0.98]"
        >
          <IconSign className="size-[18px]" /> Review &amp; sign
        </Link>
      ) : null}
    </article>
  );
}
