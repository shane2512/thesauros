// Shared UI primitives. Tokens only: no hex literal lives here. Every interactive element is 44px
// minimum with a visible focus ring (the global :focus-visible rule in globals.css) and every
// verdict carries a glyph AND a word.
import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { formatToken } from '@/lib/format';
import { cn } from '@/lib/utils';
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

/* ---------------------------------------------------------------- labels */

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`label px-4 pt-6 pb-2 ${className}`}>{children}</p>;
}

/** Page title block: bold headline, muted lede. */
export function PageHeading({
  children,
  sub,
  kicker,
}: {
  children: ReactNode;
  sub?: ReactNode;
  kicker?: ReactNode;
}) {
  return (
    <div>
      {kicker ? (
        <p className="label flex items-center gap-2 pb-1.5 text-ink">
          <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
          {kicker}
        </p>
      ) : null}
      <h1 className="text-headline leading-8 font-bold tracking-[-0.02em] text-ink">{children}</h1>
      {sub ? <p className="max-w-[48ch] pt-1.5 text-ui leading-5 text-muted">{sub}</p> : null}
    </div>
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
      <span className="text-meta font-semibold">{label ?? v.word}</span>
    </span>
  );
}

const TAG_TONE = {
  neutral: 'bg-surface-3 text-ink',
  quiet: 'bg-surface-2 text-muted',
  accent: 'bg-accent text-on-accent',
  soft: 'bg-accent-soft text-ink',
  warn: 'bg-escalate-tint text-escalate',
  deny: 'bg-deny-tint text-deny',
  allow: 'bg-allow-tint text-allow',
  inverse: 'bg-inverse text-on-inverse',
} as const;
export type TagTone = keyof typeof TAG_TONE;

/** Small status label: "Mandatory", "Provisioned", "Ready to sign". Optional leading dot. */
export function Tag({
  tone = 'neutral',
  dot,
  children,
  className = '',
}: {
  tone?: TagTone;
  dot?: 'accent' | 'ink' | 'deny' | 'allow' | 'pulse';
  children: ReactNode;
  className?: string;
}) {
  const dotCls = dot
    ? {
        accent: 'bg-accent',
        pulse: 'bg-accent breathe',
        ink: 'bg-ink',
        deny: 'bg-deny',
        allow: 'bg-allow',
      }[dot]
    : null;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-cap leading-[14px] font-bold whitespace-nowrap ${TAG_TONE[tone]} ${className}`}
    >
      {dotCls ? <span className={`size-1.5 rounded-full ${dotCls}`} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** Kept for existing callers: a quiet uppercase tag. */
export function Chip({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'warn';
  children: ReactNode;
}) {
  return (
    <Tag tone={tone === 'warn' ? 'warn' : 'quiet'} className="uppercase tracking-[0.06em]">
      {children}
    </Tag>
  );
}

/** Rounded icon tile, the leading glyph of every card row. */
export function IconTile({
  icon: Icon,
  tone = 'neutral',
  size = 'md',
}: {
  icon: IconComponent;
  tone?: 'neutral' | 'accent' | 'deny' | 'inverse';
  size?: 'sm' | 'md';
}) {
  const t = {
    neutral: 'bg-surface-3 text-ink',
    accent: 'bg-accent text-on-accent',
    deny: 'bg-deny-tint text-deny',
    inverse: 'bg-inverse text-on-inverse',
  }[tone];
  const s = size === 'sm' ? 'size-8 rounded-sm' : 'size-10 rounded-md';
  return (
    <span className={`flex shrink-0 items-center justify-center ${s} ${t}`} aria-hidden="true">
      <Icon className={size === 'sm' ? 'size-[18px]' : 'size-5'} />
    </span>
  );
}

/* --------------------------------------------------------------- buttons */

type Variant = 'primary' | 'ghost' | 'soft' | 'danger' | 'dark' | 'quiet';
const BTN_BASE =
  'inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-full px-6 text-title whitespace-nowrap font-bold tracking-[-0.01em] transition-[transform,background-color,filter] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] disabled:active:scale-100';
const BTN_TONE: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-press',
  ghost: 'bg-card text-ink shadow-e1 hover:bg-surface-2',
  soft: 'bg-surface-3 text-ink hover:brightness-95',
  danger: 'bg-deny-fill text-on-deny-fill hover:brightness-110',
  dark: 'bg-inverse text-on-inverse hover:brightness-125',
  quiet: 'bg-transparent text-muted hover:text-ink',
};
const BTN_DISABLED = 'bg-surface-3 text-muted cursor-not-allowed';

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
    />
  );
}

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
      className={cn(
        BTN_BASE,
        off && !loading ? BTN_DISABLED : BTN_TONE[variant],
        loading && 'cursor-progress opacity-80',
        className,
      )}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
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
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-meta font-bold text-accent-ink hover:underline ${className}`}
    >
      {children}
    </button>
  );
}

/** A fixed bottom action dock: frosted, above the tab bar's safe area. */
export function StickyCta({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="glass sticky bottom-0 z-20 -mx-4 mt-6 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
      <div className="flex flex-col gap-2">{children}</div>
      {note ? <p className="pt-2 text-center text-cap leading-[14px] text-muted">{note}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ rows */

/** List row, 56px pitch. Renders a link, a button or a plain div depending on props. */
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
      {Icon ? <IconTile icon={Icon} tone={tone === 'deny' ? 'deny' : 'neutral'} size="sm" /> : null}
      <span className="min-w-0 flex-1 text-left">
        <span
          className={`block text-small leading-5 font-semibold ${tone === 'deny' ? 'text-deny' : 'text-ink'}`}
        >
          {title}
        </span>
        {sub ? (
          <span className="block pt-0.5 text-meta leading-[18px] text-muted">{sub}</span>
        ) : null}
      </span>
      {right ? <span className="shrink-0 text-right text-meta">{right}</span> : null}
    </>
  );
  const cls = `flex min-h-14 w-full items-center gap-3 px-4 py-3 transition-colors duration-150 ${
    href || onClick ? 'hover:bg-surface-2' : ''
  } ${selected ? 'bg-surface-2' : ''}`;
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

/** The loop status pill. `live` announces changes politely; the dot breathes only while running. */
export function StatusPill({ state, label }: { state: PillState; label?: string }) {
  const p = PILL[state];
  const dot = {
    ok: 'bg-accent breathe',
    warn: 'bg-escalate',
    bad: 'bg-deny',
    idle: 'bg-muted',
  }[p.tone];
  return (
    <span
      role="status"
      aria-live="polite"
      data-state={state}
      className="inline-flex min-w-0 items-center gap-2 rounded-full bg-card px-3 py-1.5 shadow-e1"
    >
      <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className="truncate text-cap leading-[14px] font-bold tracking-[0.04em] whitespace-nowrap text-ink uppercase">
        {label ?? p.label}
      </span>
    </span>
  );
}

/** The brand: the blackletter T on yellow (brand/logo/thesauros-logo.svg, unchanged) and the
 * blackletter wordmark — the same identity the landing page carries. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/logo/thesauros-logo.svg" alt="" width={28} height={28} className="size-7" />
      <span className="font-blackletter text-section leading-none text-ink">Thesauros</span>
    </span>
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
      <Skeleton className="size-8 rounded-sm" />
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
    <div className="card px-6 py-8 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-md bg-accent-soft">
        <span className="h-1.5 w-5 rounded-full bg-accent" aria-hidden="true" />
      </span>
      <h2 className="pt-4 text-h2 leading-7 font-bold text-ink">{title}</h2>
      <p className="mx-auto max-w-[42ch] pt-1.5 text-ui leading-5 text-muted">{body}</p>
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
    <div role="alert" className="mx-4 rounded-md bg-deny-tint p-4">
      <p className="flex items-center gap-2 text-small font-bold text-deny">
        <VerdictGlyph tone="deny" className="size-4 shrink-0" />
        {title}
      </p>
      <p className="max-w-[46ch] pt-1.5 text-meta leading-[18px] text-ink">{body}</p>
      {onRetry ? (
        <div className="pt-3">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-11 items-center rounded-full bg-card px-5 text-meta font-bold text-ink shadow-e1 hover:bg-surface-2"
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Filter pills: the active one is an inverse (ink) pill, counts ride along as small badges. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-0.5"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-meta font-semibold whitespace-nowrap transition-colors ${
              on ? 'bg-inverse text-on-inverse' : 'bg-card text-muted shadow-e1 hover:text-ink'
            }`}
          >
            {o.label}
            {o.count !== undefined ? (
              <span
                className={`rounded-full px-1.5 text-micro leading-4 font-bold ${on ? 'bg-accent text-on-accent' : 'bg-surface-3 text-ink'}`}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

const BANNER_TONE = {
  warn: 'bg-escalate-tint text-escalate',
  bad: 'bg-deny-tint text-deny',
  info: 'bg-accent-soft text-ink',
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
      <span className="shrink-0 text-cap font-bold tracking-[0.06em] uppercase">{title}</span>
      <span className="min-w-0 text-meta">{children}</span>
    </div>
  );
}
