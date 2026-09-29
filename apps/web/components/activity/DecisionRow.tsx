'use client';
// One timeline row, shared by the dashboard (compact) and Activity (full, expandable). The verdict
// is a glyph AND a word, never colour alone; a decision that never reached the engine says so too.
import {
  IconActivity,
  IconRecipients,
  IconShield,
  IconVault,
  type IconComponent,
} from '@/components/icons';
import { Money, Row, VerdictBadge, toneOf } from '@/components/primitives';
import type { DecisionItem } from '@/lib/contracts';
import { formatAgo, formatWhen, toBig } from '@/lib/format';

const ICONS: Record<string, IconComponent> = {
  pay_recipient: IconRecipients,
  vault_deposit: IconVault,
  vault_withdraw: IconVault,
  risk_exit: IconShield,
  sweep_home: IconShield,
};

export const decisionIcon = (kind: string | null): IconComponent =>
  (kind ? ICONS[kind] : undefined) ?? IconActivity;

/** "R05" -> "R-05" for display (the API keeps the engine's own code). */
export const ruleLabel = (code: string): string => code.replace(/^R(\d+)$/, 'R-$1');

export function VerdictOrNone({ item }: { item: DecisionItem }) {
  if (item.verdict) return <VerdictBadge tone={toneOf(item.verdict.decision)} />;
  return <span className="text-small font-medium text-muted">No action taken</span>;
}

export function DecisionRow({
  item,
  variant,
  expanded,
  onToggle,
  href,
  controlsId,
  now,
}: {
  item: DecisionItem;
  variant: 'compact' | 'full';
  expanded?: boolean;
  onToggle?: () => void;
  href?: string;
  controlsId?: string;
  now?: Date;
}) {
  const denied = item.verdict?.decision === 'DENY';
  const when =
    variant === 'compact' ? formatAgo(item.createdAt, now) : formatWhen(item.createdAt, now);
  const right = (
    <>
      {item.amount !== null ? (
        <Money base={toBig(item.amount)} usd={variant === 'full'} />
      ) : (
        <span className="text-muted">{denied ? 'blocked' : ''}</span>
      )}
      <span className="block font-mono text-label text-muted">
        {when}
        {variant === 'compact' && item.flaggedRules.length > 0
          ? ` · ${item.flaggedRules.map(ruleLabel).join(' ')}`
          : ''}
      </span>
    </>
  );
  return (
    <Row
      icon={decisionIcon(item.kind)}
      title={item.title}
      sub={
        <>
          <VerdictOrNone item={item} />
          {variant === 'full' ? (
            <span className="mt-0.5 line-clamp-2 block text-small text-muted">
              {item.explanation}
            </span>
          ) : null}
        </>
      }
      right={right}
      expanded={onToggle ? (expanded ?? false) : undefined}
      onClick={onToggle}
      href={onToggle ? undefined : href}
      ariaControls={controlsId}
      selected={expanded}
    />
  );
}
