'use client';
// Dashboard, presentational. Every figure arrives already computed by the server; this file
// arranges it. Adapted from Steward's own S4 screen: dropped the Spend Permission allowance meter
// (D-012/D-019 item 9 — no on-chain per-wallet allowance in Circle's model) and the balance-history
// chart (ProgressMetricCard/recharts — not ported this pass); everything else keeps the same shape.
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { DecisionRow } from '@/components/activity/DecisionRow';
import {
  IconActivity,
  IconAdd,
  IconApprovals,
  IconRecipients,
  IconRefresh,
  IconShield,
  IconVault,
  IconWallet,
  type IconComponent,
} from '@/components/icons';
import { CopyAddress } from '@/components/ui/CopyAddress';
import { Sheet } from '@/components/ui/Sheet';
import { Balance, Eyebrow, Money, Row, TextButton, VerdictBadge } from '@/components/primitives';
import type { Dashboard } from '@/lib/contracts';
import { clockTime, runwayView, totalManaged } from '@/lib/dashboardModel';
import { formatAgo, toBig } from '@/lib/format';
import { isStale } from '@/lib/status';

export function BalanceCard({
  d,
  updatedAt,
  now,
  onRefresh,
}: {
  d: Dashboard;
  updatedAt: number | undefined;
  now: number;
  onRefresh: () => void;
}) {
  const stale = isStale(updatedAt, now);
  const balance = totalManaged(d);
  return (
    <div className={d.wallet.frozen ? 'opacity-60' : stale ? 'opacity-70' : ''}>
      {updatedAt !== undefined ? (
        <div className="flex items-center justify-end gap-1 pb-2 font-mono text-label text-muted">
          <span data-testid="as-of">
            {stale ? 'as of ' : 'updated '}
            {clockTime(updatedAt)}
          </span>
          {stale ? (
            <button
              type="button"
              onClick={onRefresh}
              aria-label="Refresh now"
              className="flex size-11 items-center justify-center text-ink"
            >
              <IconRefresh className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}
      <Eyebrow className="px-0 pt-0">Total managed</Eyebrow>
      <Balance base={balance} />
    </div>
  );
}

function Circle({
  icon: Icon,
  label,
  href,
  onClick,
  badge,
  disabled,
}: {
  icon: IconComponent;
  label: string;
  href?: string;
  onClick?: () => void;
  badge?: number;
  disabled?: boolean;
}) {
  const body = (
    <>
      <span
        className={`relative flex size-[52px] items-center justify-center rounded-full bg-surface-3 ${disabled ? 'opacity-50' : ''}`}
      >
        <Icon className="size-6 text-ink" />
        {badge ? (
          <span
            aria-label={`${badge} waiting`}
            className="absolute -top-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-accent text-label font-bold text-on-accent"
          >
            {badge}
          </span>
        ) : null}
      </span>
      <span className="text-small font-semibold text-ink">{label}</span>
    </>
  );
  const cls =
    'flex min-h-11 flex-col items-center gap-2 rounded-md py-1 transition-transform duration-150 active:scale-[0.97]';
  if (disabled)
    return (
      <span className={cls} aria-disabled="true">
        {body}
      </span>
    );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

export function ActionRow({
  pending,
  frozen,
  onAddFunds,
}: {
  pending: number;
  frozen: boolean;
  onAddFunds: () => void;
}) {
  return (
    <div className="px-4 pt-5">
      <div className="grid grid-cols-4 gap-2">
        <Circle
          icon={IconApprovals}
          label="Approvals"
          href="/app/approvals"
          badge={pending}
          disabled={frozen}
        />
        <Circle icon={IconRecipients} label="Recipients" href="/app/recipients" />
        <Circle icon={IconActivity} label="Activity" href="/app/activity" />
        <Circle icon={IconAdd} label="Add funds" onClick={onAddFunds} disabled={frozen} />
      </div>
      {frozen ? (
        <p className="pt-3 text-center text-small text-muted">
          Frozen: approvals and funding are paused until you unfreeze.
        </p>
      ) : null}
    </div>
  );
}

export function FundSheet({
  open,
  onClose,
  treasuryAddress,
  testnet,
}: {
  open: boolean;
  onClose: () => void;
  treasuryAddress: string;
  testnet: boolean;
}) {
  return (
    <Sheet open={open} title="Fund your treasury" onClose={onClose}>
      <p className="max-w-[46ch] pb-4 text-small text-muted">
        Send USDC to your own treasury address on Arc. Thesauros only ever works from what you put
        here, inside the limits you signed.
      </p>
      <CopyAddress address={treasuryAddress} />
      {testnet ? (
        <p className="pt-4 text-small text-muted">
          This is a testnet.{' '}
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-info hover:underline"
          >
            Get free test USDC from the Circle faucet
          </a>
          .
        </p>
      ) : null}
    </Sheet>
  );
}

function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-md bg-surface-2 p-4">
      <p className="font-mono text-label font-semibold tracking-[0.12em] text-muted uppercase">
        {label}
      </p>
      <p className="pt-2 text-h2 font-bold text-ink">{children}</p>
      {sub ? <p className="pt-1 text-small text-muted">{sub}</p> : null}
    </div>
  );
}

export function StatGrid({ d }: { d: Dashboard }) {
  const r = runwayView(d);
  const vaultTotal = d.vaultPositions.reduce((sum, v) => sum + toBig(v.assets), 0n);
  return (
    <div className="grid grid-cols-2 gap-3 px-4 pt-5">
      <Stat
        label="Working in vaults"
        sub={
          d.vaultPositions.length > 0 ? `${d.vaultPositions.length} position(s)` : 'No vault yet'
        }
      >
        <Money base={vaultTotal} token={false} />
        <span className="text-small font-semibold text-muted"> USDC</span>
      </Stat>
      <Stat label="Policy" sub={d.policy ? `per-tx / daily caps set` : 'No policy yet'}>
        {d.policy ? `v${d.policy.version}` : 'None'}
      </Stat>
      <div className="col-span-2 rounded-md bg-surface-2 p-4" data-testid="runway">
        <div className="flex items-center justify-between">
          <p className="font-mono text-label font-semibold tracking-[0.12em] text-muted uppercase">
            Liquid runway
          </p>
          {r.covered === null ? null : r.covered ? (
            <VerdictBadge tone="allow" label="Above buffer" />
          ) : (
            <VerdictBadge tone="escalate" label="Below buffer" />
          )}
        </div>
        <p className="pt-2 text-h2 font-bold text-ink">
          <Money base={r.liquid} />
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
          <div className="h-full rounded-full bg-ink" style={{ width: `${r.fillPct}%` }} />
        </div>
        <p className="pt-2 text-small text-muted">
          {r.buffer !== null ? (
            <>
              Thesauros keeps at least <Money base={r.buffer} /> liquid.
            </>
          ) : (
            'No runway buffer set yet.'
          )}
        </p>
      </div>
      <div className="col-span-2 rounded-md bg-surface-2 p-4" data-testid="max-at-risk">
        <p className="font-mono text-label font-semibold tracking-[0.12em] text-muted uppercase">
          Maximum at risk
        </p>
        <p className="pt-2 text-h2 font-bold text-ink">
          <Money base={toBig(d.maxAtRiskMicroUsd)} usd />
        </p>
        <p className="max-w-[46ch] pt-1 text-small text-muted">
          The most Thesauros could ever reach right now, even if it were fully compromised.
        </p>
      </div>
    </div>
  );
}

export function Positions({ d }: { d: Dashboard }) {
  const treasury = toBig(d.balances.treasuryUsdc);
  const agent = toBig(d.balances.agentUsdc);
  return (
    <>
      <Eyebrow>Positions</Eyebrow>
      {d.vaultPositions.map((v) => (
        <Row
          key={v.id}
          icon={IconVault}
          title={v.name}
          sub={`${v.redeemableAssets} redeemable now`}
          right={<Money base={toBig(v.assets)} usd />}
        />
      ))}
      <Row
        icon={IconWallet}
        title="Idle in treasury"
        sub="Not earning"
        right={<Money base={treasury} usd />}
      />
      {agent > 0n ? (
        <Row
          icon={IconShield}
          title="In the agent wallet"
          sub="Working balance"
          right={<Money base={agent} usd />}
        />
      ) : null}
    </>
  );
}

export function Recent({ d, now }: { d: Dashboard; now: Date }) {
  return (
    <>
      <Eyebrow>Recent</Eyebrow>
      {d.recent.length === 0 ? (
        <p className="px-4 pb-2 text-small text-muted">
          Nothing yet. Thesauros checks in every few minutes and writes what it decides here.
        </p>
      ) : (
        d.recent.map((item) => (
          <DecisionRow
            key={item.id}
            item={item}
            variant="compact"
            now={now}
            href={`/app/activity?open=${item.id}`}
          />
        ))
      )}
      <div className="px-4 pt-2 text-right">
        <Link
          href="/app/activity"
          className="inline-flex min-h-11 items-center text-small font-semibold text-accent-ink hover:underline"
        >
          View all activity
        </Link>
      </div>
    </>
  );
}

export function SecurityWidget({ d, now }: { d: Dashboard; now: Date }) {
  const n = d.security.blockedCount;
  return (
    <>
      <Eyebrow>Security</Eyebrow>
      <Row
        icon={IconShield}
        title={n === 1 ? '1 action blocked' : `${n} actions blocked`}
        sub={
          d.security.lastCheckAt
            ? `Last check ${formatAgo(d.security.lastCheckAt, now)}`
            : 'No check has run yet'
        }
        right={
          <Link href="/app/activity" className="text-small font-semibold text-accent-ink">
            See why
          </Link>
        }
      />
    </>
  );
}

export function DashboardView({
  d,
  updatedAt,
  nowMs,
  onRefresh,
}: {
  d: Dashboard;
  updatedAt: number | undefined;
  nowMs: number;
  onRefresh: () => void;
}) {
  const [fundOpen, setFundOpen] = useState(false);
  const now = new Date(nowMs);
  return (
    <>
      <div className="px-4 pt-4">
        <BalanceCard d={d} updatedAt={updatedAt} now={nowMs} onRefresh={onRefresh} />
      </div>
      <ActionRow
        pending={d.pendingApprovals}
        frozen={d.wallet.frozen}
        onAddFunds={() => setFundOpen(true)}
      />
      <StatGrid d={d} />
      <Positions d={d} />
      <Recent d={d} now={now} />
      <SecurityWidget d={d} now={now} />
      <div className="px-4 pt-4 pb-2 text-center">
        <TextButton onClick={onRefresh}>
          <IconRefresh className="size-4" /> Refresh
        </TextButton>
      </div>
      <FundSheet
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        treasuryAddress={d.wallet.treasuryAddress}
        testnet={d.wallet.chainId === 5042002}
      />
    </>
  );
}
