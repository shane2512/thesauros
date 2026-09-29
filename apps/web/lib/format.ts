// Money and time formatting for the UI. bigint in, string out: no JS `number` ever touches an amount
// (I12). USDC has 6 decimals and is displayed 1:1 in USD (the depeg guard, R12, is what makes that
// safe to display; the balance figure is an "about" figure and says so in the copy where it matters).
import { formatUnits, USDC_DECIMALS } from '@thesauros/shared/client';

const group = (int: string): string => int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** `1234500000n` -> `1,234.5` (exact, trailing zeros trimmed, thousands grouped). */
export function formatToken(base: bigint, decimals: number = USDC_DECIMALS): string {
  const s = formatUnits(base, decimals);
  const neg = s.startsWith('-');
  const [i = '0', f] = (neg ? s.slice(1) : s).split('.');
  return `${neg ? '-' : ''}${group(i)}${f ? `.${f}` : ''}`;
}

/** `10,000 USDC ($10,000)`. */
export function formatMoney(base: bigint): string {
  const t = formatToken(base);
  return `${t} USDC ($${t})`;
}

/** Balance hero: whole part and a fixed two-digit minor part, so the minor units can be dimmed.
 * Truncates below a cent (never rounds up money the treasury does not have). */
export function splitBalance(base: bigint): { whole: string; minor: string } {
  const neg = base < 0n;
  const abs = neg ? -base : base;
  const cents = abs / 10_000n; // 6 decimals -> 2 decimals, floored
  const whole = cents / 100n;
  const minor = (cents % 100n).toString().padStart(2, '0');
  return { whole: `${neg ? '-' : ''}${group(whole.toString())}`, minor: `.${minor}` };
}

/** Parse an API amount string. A bad value is a 0 on screen rather than a crash. */
export function toBig(v: string | null | undefined): bigint {
  return v && /^\d+$/.test(v) ? BigInt(v) : 0n;
}

/** Percentage of `part` in `whole`, integer 0..100 for a bar width. bigint math, floored. */
export function pctOf(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  const p = (part * 100n) / whole;
  return Number(p > 100n ? 100n : p < 0n ? 0n : p); // display width only, never money
}

const two = (n: number) => String(n).padStart(2, '0');

/** `14:22` for today, `Mon 14:22` for this week, otherwise `12 Sep 14:22`. Local time. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const dayMs = 86_400_000;
  if (now.getTime() - d.getTime() < dayMs && now.getDate() === d.getDate()) return hm;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${hm}`;
}

/** `2h ago`, `6 min ago`, `just now`. */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const secs = Math.floor((now.getTime() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(secs)) return '';
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.max(1, Math.round(secs / 60))} min ago`;
  if (secs < 86_400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86_400)}d ago`;
}

/** 4-character groups for addresses (announced in groups). `0x1d4f 2a99 ...` */
export function groupAddress(addr: string): string {
  const body = addr.replace(/^0x/, '');
  return `0x ${(body.match(/.{1,4}/g) ?? []).join(' ')}`;
}

export function shortAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}
