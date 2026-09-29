// Shared UI primitives. Tokens only: no hex literal lives here. Every interactive element is 44px
// minimum with a visible focus ring (the global :focus-visible rule in globals.css) and every
// verdict carries a glyph AND a word.
import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { formatToken, splitBalance } from '@/lib/format';
import { PILL, type PillState } from '@/lib/status';
import { VerdictGlyph, type IconComponent, type VerdictTone } from '@/components/icons';

/* ------------------------------------------------------------------ money */

/** `1,200 USDC ($1,200)`: the one money rule. bigint in, never a JS number. */
export function Money({
  base,
  usd = false,
  token = true,
}: {
  base: bigint;
  usd?: boolean;
  token?: boolean;
}) {
  const t = formatToken(base);
  return (
    <span className="tabular">
      {t}
      {token ? ' USDC' : null}
      {usd ? <span className="text-muted"> (${t})</span> : null}
    </span>
  );
}

/** The balance hero: minor units dimmed to `--minor` at the same size. */
export function Balance({ base, className = '' }: { base: bigint; className?: string }) {
  const { whole, minor } = splitBalance(base);
  return (
    <span
      className={`tabular text-balance font-bold tracking-[-0.02em] text-ink lg:text-balance-lg ${className}`}
    >
      <span className="sr-only">{`${whole}${minor} dollars`}</span>
      <span aria-hidden="true">
        ${whole}
        <span className="text-minor">{minor}</span>
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------- labels */

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`px-4 pt-6 pb-2 font-mono text-label font-semibold tracking-[0.12em] text-muted uppercase ${className}`}
    >
      {children}
    </p>
  );
}

export const VERDICT_WORDS: Record<VerdictTone, { text: string; word: string }> = {
  allow: { text: 'text-allow', word: 'Allowed' },
  escalate: { text: 'text-escalate', word: 'Needs you' },
  deny: { text: 'text-deny', word: 'Denied' },
};

export const toneOf = (d: 'ALLOW' | 'ESCALATE' | 'DENY'): VerdictTone =>
  d === 'ALLOW' ? 'allow' : d === 'ESCALATE' ? 'escalate' : 'deny';

/** Glyph + visible word. Colour is the third channel, never the first. */
export function VerdictBadge({ tone, label }: { tone: VerdictTone; label?: string }) {
  const v = VERDICT_WORDS[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 ${v.text}`} data-verdict={tone}>
      <VerdictGlyph tone={tone} className="size-3.5 shrink-0" />
      <span className="text-small font-medium">{label ?? v.word}</span>
    </span>
  );
}

export function Chip({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'warn';
  children: ReactNode;
}) {
  const cls = tone === 'warn' ? 'bg-escalate-tint text-escalate' : 'bg-surface-2 text-muted';
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 font-mono text-label tracking-[0.08em] uppercase ${cls}`}
    >
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- buttons */

type Variant = 'primary' | 'ghost' | 'danger';
const BTN_BASE =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full px-6 text-h3 font-bold transition-transform duration-150 ease-[var(--ease-enter)] active:scale-[0.97] disabled:active:scale-100';
const BTN_TONE: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-press',
  ghost: 'border border-line-strong text-ink hover:bg-surface-2',
  danger: 'bg-deny-fill text-on-deny-fill',
};
const BTN_DISABLED = 'bg-surface-2 text-muted cursor-not-allowed';

export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: { variant?: Variant; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const off = disabled === true || loading;
  return (
    <button
      type="button"
      {...rest}
      disabled={off}
      aria-busy={loading || undefined}
      className={`${BTN_BASE} ${off ? BTN_DISABLED : BTN_TONE[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'primary',
  children,
}: {
  href: string;
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${BTN_BASE} ${BTN_TONE[variant]}`}>
      {children}
    </Link>
  );
}

/** Small inline text action (Retry, Refresh, View all). 44px hit area. */
export function TextButton({
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-small font-semibold text-accent-ink hover:underline ${className}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ rows */

/** Full-bleed list row, 52px pitch. Renders a link, a button or a plain div depending on props. */
export function Row({
  icon: Icon,
  title,
  sub,
  right,
  href,
  onClick,
  expanded,
  tone,
  selected,
  ariaControls,
}: {
  icon?: IconComponent;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  href?: string;
  onClick?: () => void;
  expanded?: boolean;
  tone?: 'deny';
  selected?: boolean;
  ariaControls?: string;
}) {
  const inner = (
    <>
      {Icon ? (
        <span className={`shrink-0 ${tone === 'deny' ? 'text-deny' : 'text-ink'}`}>
          <Icon className="size-6" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-left">
        <span
          className={`block text-h3 font-semibold ${tone === 'deny' ? 'text-deny' : 'text-ink'}`}
        >
          {title}
        </span>
        {sub ? <span className="block text-small text-muted">{sub}</span> : null}
      </span>
      {right ? <span className="shrink-0 text-right text-small">{right}</span> : null}
    </>
  );
  const cls = `flex min-h-[52px] w-full items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-2 ${
    selected ? 'row-press' : ''
  }`;
  if (href)
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  if (onClick)
    return (
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expanded}
        aria-controls={ariaControls}
        className={cls}
      >
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}

/* ---------------------------------------------------------------- status */

/** The header pill. `live` announces changes politely; the dot breathes only while running. */
export function StatusPill({ state, label }: { state: PillState; label?: string }) {
  const p = PILL[state];
  const dot = {
    ok: 'bg-allow breathe',
    warn: 'bg-escalate',
    bad: 'bg-deny',
    idle: 'bg-muted',
  }[p.tone];
  return (
    <span
      role="status"
      aria-live="polite"
      data-state={state}
      className="inline-flex min-h-9 min-w-0 items-center gap-2 rounded-full bg-surface-2 px-2.5 py-1.5"
    >
      <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      <span className="truncate text-[13px] font-medium whitespace-nowrap text-ink">
        {label ?? p.label}
      </span>
    </span>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`relative inline-block text-h3 font-bold tracking-[-0.02em] text-ink ${className}`}
    >
      Thesauros
      <span className="wordmark-rule" aria-hidden="true" />
    </span>
  );
}

/* ----------------------------------------------------------- limit-line meter */

export type MeterTone = 'accent' | 'escalate' | 'deny';

/** Near the cap the fill turns amber, at the cap red. Integer maths on bigint. */
export function meterTone(used: bigint, cap: bigint): MeterTone {
  if (cap <= 0n) return 'deny';
  if (used >= cap) return 'deny';
  if (used * 100n >= cap * 80n) return 'escalate';
  return 'accent';
}

/**
 * The limit line, the one device. The track is split by a 2px rule: left is what the agent may
 * use, right (recessed to ground) is money it can never touch. `usedPct` and `capPct` are 0..100
 * widths, computed by the caller from bigint amounts.
 */
export function AllowanceMeter({
  usedPct,
  capPct = 100,
  tone = 'accent',
  caption,
}: {
  usedPct: number;
  capPct?: number;
  tone?: MeterTone;
  caption: ReactNode;
}) {
  const fill = { accent: 'bg-accent', escalate: 'bg-escalate', deny: 'bg-deny' }[tone];
  const cap = Math.min(100, Math.max(0, capPct));
  const used = Math.min(cap, Math.max(0, usedPct));
  return (
    <div data-tone={tone}>
      <div className="meter-track" aria-hidden="true">
        <div
          className="meter-beyond"
          data-testid="meter-beyond"
          style={{ width: `${100 - cap}%` }}
        />
        <div
          className={`meter-fill ${fill}`}
          data-testid="meter-fill"
          style={{ width: `${used}%` }}
        />
        <div className="limit-line" data-testid="limit-line" style={{ left: `${cap}%` }} />
      </div>
      <p className="pt-2 font-mono text-label tracking-[0.06em] text-muted uppercase">{caption}</p>
    </div>
  );
}

/* ------------------------------------------------------ states and chrome */

export function LoadBar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      role="progressbar"
      aria-label="Loading"
      className="loadbar fixed inset-x-0 top-0 z-50 h-[3px] overflow-hidden"
    >
      <span className="block h-full w-1/4 rounded-full bg-accent" />
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3" aria-hidden="true">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-8 py-10 text-center">
      <svg viewBox="0 0 64 64" className="mx-auto size-16" aria-hidden="true" focusable="false">
        <path d="M8 20h34l10 10v26H8z" fill="var(--th-surface-3)" />
        <path d="M42 20v10h10" fill="var(--th-surface-2)" />
        <path d="M18 40h20M18 48h12" stroke="var(--th-accent)" strokeWidth="3" />
      </svg>
      <h2 className="pt-4 text-h2 font-bold text-ink">{title}</h2>
      <p className="mx-auto max-w-[46ch] pt-2 text-small text-muted">{body}</p>
      {action ? <div className="pt-5">{action}</div> : null}
    </div>
  );
}

/** Errors say what happened, whether money moved, and what to do. */
export function ErrorPanel({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="mx-4 rounded-md bg-surface-2 p-4">
      <p className="flex items-center gap-2 text-h3 font-semibold text-deny">
        <VerdictGlyph tone="deny" className="size-4 shrink-0" />
        {title}
      </p>
      <p className="max-w-[46ch] pt-2 text-small text-muted">{body}</p>
      {onRetry ? (
        <div className="pt-3">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-11 items-center rounded-full border border-line-strong px-5 text-small font-bold text-ink hover:bg-surface-3"
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex overflow-x-auto rounded-full bg-surface-2 p-1"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`min-h-11 flex-1 shrink-0 rounded-full px-2 text-center text-small whitespace-nowrap ${
              on ? 'bg-surface-3 font-semibold text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const BANNER_TONE = {
  warn: 'bg-escalate-tint text-escalate',
  bad: 'bg-deny-tint text-deny',
  info: 'bg-surface-2 text-muted',
} as const;

/** Frozen, safe mode, paused, stale — one line, always visible while true. */
export function Banner({
  tone,
  title,
  children,
  live = 'polite',
  id,
}: {
  tone: keyof typeof BANNER_TONE;
  title: string;
  children: ReactNode;
  live?: 'polite' | 'assertive';
  id?: string;
}) {
  return (
    <div
      role={live === 'assertive' ? 'alert' : 'status'}
      aria-live={live}
      data-banner={id}
      className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2 ${BANNER_TONE[tone]}`}
    >
      <span className="shrink-0 font-mono text-label font-semibold tracking-[0.12em] uppercase">
        {title}
      </span>
      <span className="min-w-0 text-small">{children}</span>
    </div>
  );
}
