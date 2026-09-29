'use client';
// Dashboard, presentational. Every figure arrives already computed by the server; this file
// arranges it. No invented numbers: no trend line (there is no balance-history table), no APY
// (the vault's rate isn't on the wire) — only what `/api/dashboard` actually returns.
import Link from 'next/link';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { DecisionRow } from '@/components/activity/DecisionRow';
import {
  IconAgent,
  IconApprovals,
  IconChevron,
  IconCopy,
  IconCheck,
  IconExternal,
  IconGavel,
  IconLedger,
  IconAdd,
  IconOutward,
  IconRadar,
  IconRecipients,
  IconRefresh,
  IconSavings,
  IconShield,
  IconShieldCheck,
  IconGauge,
  IconPeople,
  type IconComponent,
} from '@/components/icons';
import { CopyAddress } from '@/components/ui/CopyAddress';
import { Sheet } from '@/components/ui/Sheet';
import { Button, Money, StatusPill, Tag, VerdictBadge } from '@/components/primitives';
import type { Dashboard } from '@/lib/contracts';
import { clockTime, coverage, runwayView, totalManaged } from '@/lib/dashboardModel';
import { formatAgo, formatToken, shortAddress, splitBalance, toBig } from '@/lib/format';
import { isStale, pillLabel, pillState } from '@/lib/status';

const ARC_TESTNET = 5042002;

function Label({ children }: { children: ReactNode }) {
  return <span className="label">{children}</span>;
}

/* --------------------------------------------------------------- status row */

export function LoopStatus({
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
  const state = pillState(d);
  const stale = isStale(updatedAt, now);
  const label =
    state === 'active' ? 'Autonomous loop active' : pillLabel(state, d.pendingApprovals);
  return (
    <div className="flex items-center justify-between gap-2 pt-3">
      <StatusPill state={state} label={label} />
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Refresh now"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-cap font-bold tracking-[0.04em] text-muted uppercase hover:text-ink"
      >
        <span data-testid="as-of">
          {updatedAt === undefined
            ? 'Loading'
            : `${stale ? 'As of' : 'Updated'} ${clockTime(updatedAt)}`}
        </span>
        <IconRefresh className="size-3.5" />
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- hero card */

export function BalanceCard({ d, explorerBase }: { d: Dashboard; explorerBase: string }) {
  const balance = totalManaged(d);
  const { whole, minor } = splitBalance(balance);
  const vaultTotal = d.vaultPositions.reduce((sum, v) => sum + toBig(v.assets), 0n);
  const redeemable = d.vaultPositions.reduce((sum, v) => sum + toBig(v.redeemableAssets), 0n);
  return (
    <section
      aria-label="Total managed treasury"
      data-theme="dark"
      className={`card hero-glass p-6 text-ink shadow-lift ${d.wallet.frozen ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <Label>Total managed</Label>
        <a
          href={`${explorerBase}/address/${d.wallet.treasuryAddress}`}
          target="_blank"
          rel="noreferrer"
          aria-label="View the treasury address on the explorer"
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2.5 font-mono text-cap font-semibold whitespace-nowrap text-muted hover:text-ink"
        >
          {shortAddress(d.wallet.treasuryAddress)}
          <IconOutward className="size-3.5" />
        </a>
      </div>
      <p className="flex items-baseline gap-2 pt-2 pb-1">
        <span className="sr-only">{`${whole}${minor} USDC`}</span>
        <span
          aria-hidden="true"
          className="tabular text-display leading-[48px] font-bold tracking-[-0.03em] text-ink"
        >
          ${whole}
          <span className="text-minor">{minor}</span>
        </span>
        <span aria-hidden="true" className="text-section font-semibold text-muted">
          USDC
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <Tag tone="quiet">Max at risk ${formatToken(toBig(d.maxAtRiskMicroUsd))}</Tag>
        <Tag tone="quiet">
          {d.vaultPositions.length > 0
            ? `${d.vaultPositions.length} position${d.vaultPositions.length === 1 ? '' : 's'} earning`
            : 'Nothing earning yet'}
        </Tag>
      </div>
      <p className="flex items-center gap-2 rounded-sm bg-surface-2 p-2.5 text-meta leading-[18px] text-ink">
        <IconRadar className="size-[18px] shrink-0" />
        <span className="min-w-0">
          Yield engine: <strong className="font-bold">{formatToken(vaultTotal)} USDC</strong>{' '}
          deployed
          {vaultTotal > 0n
            ? ` · ${formatToken(redeemable)} redeemable now`
            : ' · idle cash above your buffer goes to work'}
        </span>
      </p>
    </section>
  );
}

/* --------------------------------------------------------------- action dock */

function Dock({
  icon: Icon,
  label,
  href,
  onClick,
  badge,
  disabled,
  accent,
}: {
  icon: IconComponent;
  label: string;
  href?: string;
  onClick?: () => void;
  badge?: number;
  disabled?: boolean;
  accent?: boolean;
}) {
  const body = (
    <>
      <span
        className={`relative flex size-12 items-center justify-center rounded-md transition-transform duration-150 group-hover:scale-105 ${
          accent ? 'bg-accent text-on-accent' : 'bg-surface-3 text-ink'
        }`}
      >
        <Icon className={accent ? 'size-6' : 'size-[22px]'} />
        {badge ? (
          <span
            aria-label={`${badge} waiting`}
            className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-cap font-bold text-on-accent ring-2 ring-card"
          >
            {badge}
          </span>
        ) : null}
      </span>
      <span
        className={`text-cap leading-[14px] text-ink ${accent ? 'font-bold' : 'font-semibold'}`}
      >
        {label}
      </span>
    </>
  );
  const cls = `group card flex min-h-11 flex-col items-center gap-1.5 p-2 transition-colors hover:bg-surface-2 ${
    disabled ? 'opacity-45' : 'active:scale-[0.97]'
  }`;
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
    <div>
      <div className="grid grid-cols-4 gap-2">
        <Dock
          icon={IconApprovals}
          label="Approvals"
          href="/app/approvals"
          badge={pending}
          disabled={frozen}
        />
        <Dock icon={IconRecipients} label="Recipients" href="/app/recipients" />
        <Dock icon={IconLedger} label="Audit log" href="/app/activity" />
        <Dock icon={IconAdd} label="Fund vault" onClick={onAddFunds} disabled={frozen} accent />
      </div>
      {frozen ? (
        <p className="pt-2 text-center text-meta text-muted">
          Frozen: approvals and funding are paused until you unfreeze.
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- bento */

function StatCard({
  label,
  icon: Icon,
  value,
  unit,
  foot,
  href,
}: {
  label: string;
  icon: IconComponent;
  value: ReactNode;
  unit: ReactNode;
  foot: ReactNode;
  href?: string;
}) {
  const inner = (
    <>
      <span className="flex items-center justify-between">
        <Label>{label}</Label>
        <Icon className="size-4 text-muted" />
      </span>
      <span className="tabular block pt-1 text-stat leading-[34px] font-bold tracking-[-0.02em] text-ink">
        {value}
      </span>
      <span className="block text-meta font-semibold text-muted">{unit}</span>
      <span className="block pt-4 text-cap leading-4 font-semibold text-muted">{foot}</span>
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 transition-colors hover:bg-surface-2">
      {inner}
    </Link>
  ) : (
    <div className="card p-4">{inner}</div>
  );
}

export function StatGrid({ d }: { d: Dashboard }) {
  const r = runwayView(d);
  const vaultTotal = d.vaultPositions.reduce((sum, v) => sum + toBig(v.assets), 0n);
  const cov = coverage(r.liquid, r.buffer);
  return (
    <div className="grid grid-cols-2 gap-2">
      <StatCard
        label="Working"
        icon={IconSavings}
        value={formatToken(vaultTotal)}
        unit="USDC in vaults"
        foot={
          d.vaultPositions.length > 0
            ? d.vaultPositions.map((v) => v.name).join(', ')
            : 'No vault position yet'
        }
      />
      <StatCard
        label="Policy"
        icon={IconGavel}
        value={d.policy ? `v${d.policy.version}` : 'None'}
        unit={d.policy ? 'Active, signed by you' : 'Not signed yet'}
        foot={
          d.policy ? (
            <>
              {formatToken(toBig(d.policy.perTxMicroUsd))} USDC per tx
              <br />
              {formatToken(toBig(d.policy.dailyMicroUsd))} USDC daily max
            </>
          ) : (
            'Sign a policy to start'
          )
        }
        href="/app/policy"
      />

      <section aria-label="Liquid runway" className="card col-span-2 p-4" data-testid="runway">
        <div className="flex items-center justify-between gap-2">
          <Label>Liquid runway buffer</Label>
          {r.covered === null ? null : r.covered ? (
            <Tag tone="neutral" dot="accent">
              Above buffer
            </Tag>
          ) : (
            <Tag tone="warn" dot="deny">
              Below buffer
            </Tag>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-2 pt-1.5">
          <p className="flex items-baseline gap-1.5">
            <span className="tabular text-headline leading-8 font-bold text-ink">
              {formatToken(r.liquid)}
            </span>
            <span className="text-meta font-semibold text-muted">USDC liquid</span>
          </p>
          {cov ? <span className="text-cap font-bold text-ink">{cov} the buffer</span> : null}
        </div>
        <div className="relative mt-2 h-2 rounded-full bg-surface-3" aria-hidden="true">
          <div className="h-full rounded-full bg-accent" style={{ width: `${r.fillPct}%` }} />
          {r.buffer !== null && r.buffer > 0n ? (
            <div className="absolute -top-1 -bottom-1 left-1/2 w-0.5 rounded-full bg-ink/40" />
          ) : null}
        </div>
        {r.buffer !== null && r.buffer > 0n ? (
          <div className="flex justify-between pt-1.5 text-cap text-muted">
            <span>0</span>
            <span>Floor {formatToken(r.buffer)}</span>
            <span>{formatToken(r.buffer * 2n)}</span>
          </div>
        ) : null}
        <p className="pt-2 text-meta leading-[18px] text-muted">
          {r.buffer !== null && r.buffer > 0n ? (
            <>
              Thesauros keeps at least <Money base={r.buffer} /> liquid. The Policy Engine blocks
              any move that would dip below it.
            </>
          ) : (
            'No runway buffer set yet. Sign a policy to set one.'
          )}
        </p>
      </section>
    </div>
  );
}

/* --------------------------------------------------------------- agent wallet */

export function AgentWalletCard({ d, explorerBase }: { d: Dashboard; explorerBase: string }) {
  const [copied, setCopied] = useState(false);
  const addr = d.wallet.agentWalletAddress;
  const agent = toBig(d.balances.agentUsdc);
  const copy = async () => {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard can be blocked; the explorer link still shows the full address */
    }
  };
  return (
    <section aria-label="Agent wallet" className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-sm bg-surface-3 text-ink">
            <IconAgent className="size-[18px]" />
          </span>
          <span>
            <span className="label block">Agent wallet</span>
            <span className="block text-title leading-[22px] font-semibold text-ink">
              Executes inside your policy
            </span>
          </span>
        </div>
        <Tag tone="quiet">Circle Wallets</Tag>
      </div>
      {addr ? (
        <div className="flex items-center justify-between gap-2 rounded-sm bg-surface-2 p-2.5">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-meta font-semibold text-ink">
              {shortAddress(addr)}
            </span>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label={copied ? 'Address copied' : 'Copy agent wallet address'}
              className="flex size-9 items-center justify-center rounded-sm text-muted hover:bg-surface-3 hover:text-ink"
            >
              {copied ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
            </button>
          </span>
          <span className="text-right">
            <span className="block text-cap text-muted">Working balance</span>
            <span className="tabular block text-small font-bold text-ink">
              {formatToken(agent)} USDC
            </span>
          </span>
        </div>
      ) : (
        <p className="rounded-sm bg-surface-2 p-2.5 text-meta text-muted">
          No agent wallet yet. Finish setup to create one.
        </p>
      )}
      <div className="flex items-center justify-between gap-2 text-cap text-muted">
        <span className="flex items-center gap-1.5">
          <span
            className={`size-1.5 rounded-full ${agent > 0n ? 'bg-accent' : 'bg-muted'}`}
            aria-hidden="true"
          />
          {agent > 0n ? 'Holds working cash' : 'Clean: nothing idle in the agent wallet'}
        </span>
        {addr ? (
          <a
            href={`${explorerBase}/address/${addr}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center gap-0.5 font-bold text-ink hover:underline"
          >
            Explorer <IconExternal className="size-3.5" />
          </a>
        ) : null}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- rules */

function RuleLine({
  icon: Icon,
  label,
  value,
  strong,
}: {
  icon: IconComponent;
  label: string;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex items-center gap-2 text-ui text-ink">
        <Icon className="size-4 shrink-0" />
        {label}
      </span>
      <span
        className={`rounded-sm bg-card px-2 py-0.5 text-cap leading-4 ${strong ? 'font-bold text-ink' : 'font-semibold text-ink'}`}
      >
        {value}
      </span>
    </li>
  );
}

export function RulesCard({ d, recipients }: { d: Dashboard; recipients: number | null }) {
  return (
    <section aria-label="Active policy rules" className="rounded-md bg-surface-3/60 p-4">
      <div className="flex items-center justify-between gap-2 pb-1">
        <Label>Active policy rules</Label>
        <Link
          href="/app/policy"
          className="inline-flex min-h-9 items-center gap-0.5 text-cap font-bold text-ink hover:underline"
        >
          {d.policy ? `Policy v${d.policy.version}` : 'Write a mandate'}
          <IconChevron className="size-3.5" />
        </Link>
      </div>
      {d.policy ? (
        <ul>
          <RuleLine
            icon={IconPeople}
            label="Recipient allowlist"
            value={recipients === null ? 'Exact match' : `Exact match (${recipients})`}
          />
          <RuleLine
            icon={IconGauge}
            label="Per-payment cap"
            value={`${formatToken(toBig(d.policy.perTxMicroUsd))} USDC`}
          />
          <RuleLine
            icon={IconShieldCheck}
            label="Daily limit"
            value={`${formatToken(toBig(d.policy.dailyMicroUsd))} USDC`}
          />
          <RuleLine
            icon={IconShield}
            label="Circuit breaker"
            value={d.wallet.breakerOpen ? 'Tripped' : 'Ready'}
            strong
          />
        </ul>
      ) : (
        <p className="pt-1 text-meta text-muted">
          No signed policy yet, so Thesauros takes no action at all.
        </p>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- recent + security */

export function Recent({ d, now }: { d: Dashboard; now: Date }) {
  return (
    <section aria-label="Recent decisions">
      <div className="flex items-center justify-between px-1 pb-2">
        <Label>Recent decisions</Label>
        <Link
          href="/app/activity"
          className="inline-flex min-h-9 items-center gap-0.5 text-cap font-bold text-ink hover:underline"
        >
          View all <IconChevron className="size-3.5" />
        </Link>
      </div>
      <div className="card overflow-hidden">
        {d.recent.length === 0 ? (
          <p className="p-4 text-meta text-muted">
            Nothing yet. Thesauros checks in every few minutes and writes what it decides here.
          </p>
        ) : (
          d.recent.map((item) => (
            <DecisionRow
              key={item.id}
              item={item}
              variant="compact"
              now={now}
              href={`/app/activity/${item.id}`}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function SecurityWidget({ d, now }: { d: Dashboard; now: Date }) {
  const n = d.security.blockedCount;
  return (
    <Link
      href="/app/activity?filter=DENY"
      className="card flex items-center gap-3 p-4 transition-colors hover:bg-surface-2"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-deny-tint text-deny">
        <IconShield className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-small font-semibold text-ink">
          {n === 1 ? '1 action blocked' : `${n} actions blocked`}
        </span>
        <span className="block text-meta text-muted">
          {d.security.lastCheckAt
            ? `Last check ${formatAgo(d.security.lastCheckAt, now)}`
            : 'No check has run yet'}
        </span>
      </span>
      {n > 0 ? (
        <VerdictBadge tone="deny" label="See why" />
      ) : (
        <IconChevron className="size-4 text-muted" />
      )}
    </Link>
  );
}

/* --------------------------------------------------------------- fund sheet */

export function FundSheet({
  open,
  onClose,
  onSent,
  treasuryAddress,
  testnet,
}: {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  treasuryAddress: string;
  testnet: boolean;
}) {
  return (
    <Sheet open={open} title="Fund your treasury" onClose={onClose}>
      <p className="max-w-[46ch] pb-4 text-ui leading-5 text-muted">
        Send USDC to your own treasury address on Arc. Thesauros only ever works from what you put
        here, inside the limits you signed.
      </p>
      <CopyAddress address={treasuryAddress} />
      {testnet ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-surface-2 p-3.5">
          <p className="min-w-0 text-meta leading-[18px] text-ink">
            <span className="label block pb-0.5">Environment</span>
            This is a testnet. <strong className="font-bold">Get free test USDC</strong> from the
            faucet.
          </p>
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm bg-accent px-3.5 text-meta font-bold text-on-accent hover:bg-accent-press"
          >
            Circle Faucet <IconOutward className="size-3.5" />
          </a>
        </div>
      ) : null}
      <div className="pt-5">
        <Button variant="dark" onClick={onSent}>
          I&apos;ve sent the funds
        </Button>
      </div>
    </Sheet>
  );
}

/* --------------------------------------------------------------- page */

export function DashboardView({
  d,
  updatedAt,
  nowMs,
  onRefresh,
  explorerBase,
  recipients,
}: {
  d: Dashboard;
  updatedAt: number | undefined;
  nowMs: number;
  onRefresh: () => void;
  explorerBase: string;
  recipients: number | null;
}) {
  const [fundOpen, setFundOpen] = useState(false);
  const now = new Date(nowMs);
  // One column on phones in reading order; two on desktop (money + actions left, rules + log right).
  // `contents` dissolves each column wrapper below lg so `order-*` can interleave the two.
  const slot = (i: number, order: string, node: ReactNode) => (
    <div className={`rise-in min-w-0 ${order} lg:order-none`} style={{ '--i': i } as CSSProperties}>
      {node}
    </div>
  );
  return (
    <div className="flex flex-col gap-4 px-4 pb-6 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-5">
      <div className="contents lg:flex lg:flex-col lg:gap-4">
        {slot(
          0,
          'order-1',
          <LoopStatus d={d} updatedAt={updatedAt} now={nowMs} onRefresh={onRefresh} />,
        )}
        {slot(1, 'order-2', <BalanceCard d={d} explorerBase={explorerBase} />)}
        {slot(
          2,
          'order-3',
          <ActionRow
            pending={d.pendingApprovals}
            frozen={d.wallet.frozen}
            onAddFunds={() => setFundOpen(true)}
          />,
        )}
        {slot(4, 'order-5', <AgentWalletCard d={d} explorerBase={explorerBase} />)}
        {slot(7, 'order-8', <SecurityWidget d={d} now={now} />)}
      </div>
      <div className="contents lg:flex lg:flex-col lg:gap-4 lg:pt-[72px]">
        {slot(3, 'order-4', <StatGrid d={d} />)}
        {slot(5, 'order-6', <RulesCard d={d} recipients={recipients} />)}
        {slot(6, 'order-7', <Recent d={d} now={now} />)}
      </div>
      <FundSheet
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        onSent={() => {
          setFundOpen(false);
          onRefresh();
        }}
        treasuryAddress={d.wallet.treasuryAddress}
        testnet={d.wallet.chainId === ARC_TESTNET}
      />
    </div>
  );
}
