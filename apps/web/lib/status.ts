// Pure derivations from server data to what the shell shows: the status pill and the banners.
// These pick WORDS for what the server already decided; they never decide anything about funds.
import type { Dashboard } from './contracts';

export type PillState = 'active' | 'waiting' | 'frozen' | 'breaker' | 'safe' | 'paused';

export const PILL: Record<PillState, { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' }> = {
  active: { label: 'Active', tone: 'ok' },
  waiting: { label: 'Waiting for approval', tone: 'warn' },
  frozen: { label: 'Frozen', tone: 'bad' },
  breaker: { label: 'Breaker tripped', tone: 'bad' },
  safe: { label: 'Safe mode', tone: 'warn' },
  paused: { label: 'Paused', tone: 'warn' },
};

type StatusInput = Pick<Dashboard, 'degraded' | 'paused' | 'pendingApprovals'> & {
  wallet: Pick<Dashboard['wallet'], 'frozen' | 'breakerOpen'>;
};

/** Precedence mirrors the server's own: frozen beats everything, then the breaker, then service state. */
export function pillState(d: StatusInput): PillState {
  if (d.wallet.frozen) return 'frozen';
  if (d.wallet.breakerOpen) return 'breaker';
  if (d.paused) return 'paused';
  if (d.degraded) return 'safe';
  if (d.pendingApprovals > 0) return 'waiting';
  return 'active';
}

export function pillLabel(state: PillState, pending = 0): string {
  return state === 'waiting' ? `${PILL.waiting.label} (${pending})` : PILL[state].label;
}

export type Banner = {
  id: 'demo' | 'frozen' | 'safe' | 'paused' | 'stale' | 'breaker';
  tone: 'warn' | 'bad' | 'info';
  title: string;
  body: string;
  live: 'polite' | 'assertive';
};

export const STALE_AFTER_MS = 30_000;

type BannerInput = {
  demoMode: boolean;
  data:
    | (Pick<Dashboard, 'degraded' | 'paused'> & {
        wallet: Pick<Dashboard['wallet'], 'frozen' | 'breakerOpen'>;
      })
    | undefined;
  updatedAt: number | undefined;
  now: number;
  refreshFailed?: boolean;
};

/** Which banners the shell shows, in order. I11: the DEMO DATA banner is required here (unlike
 * Steward's own project, where it was removed by explicit owner request — D-020). */
export function banners(i: BannerInput): Banner[] {
  const out: Banner[] = [];
  if (i.demoMode)
    out.push({
      id: 'demo',
      tone: 'info',
      title: 'Demo data',
      body: 'Prices and rates may be mocked for this testnet demo (I11).',
      live: 'polite',
    });
  if (i.data?.wallet.frozen)
    out.push({
      id: 'frozen',
      tone: 'bad',
      title: 'Frozen',
      body: 'Thesauros is stopped. Nothing will move until you unfreeze.',
      live: 'assertive',
    });
  else if (i.data?.wallet.breakerOpen)
    out.push({
      id: 'breaker',
      tone: 'bad',
      title: 'Breaker tripped',
      body: 'Thesauros stopped itself after repeated failures. Nothing is moving. Freeze still works.',
      live: 'assertive',
    });
  if (i.data?.paused)
    out.push({
      id: 'paused',
      tone: 'warn',
      title: 'Thesauros is paused',
      body: 'The autonomous loop has not checked in recently. Your funds are safe; nothing will move on schedule.',
      live: 'polite',
    });
  if (i.data?.degraded)
    out.push({
      id: 'safe',
      tone: 'warn',
      title: 'Safe mode',
      body: 'Reasoning is unavailable: scheduled payments and risk exits only. Freeze still works.',
      live: 'polite',
    });
  const stale =
    i.refreshFailed === true || (i.updatedAt !== undefined && i.now - i.updatedAt > STALE_AFTER_MS);
  if (stale && i.updatedAt !== undefined)
    out.push({
      id: 'stale',
      tone: 'info',
      title: 'Showing older data',
      body: 'Thesauros could not refresh just now. What you see is the last reading. Nothing has been moved because of this.',
      live: 'polite',
    });
  return out;
}

export function isStale(updatedAt: number | undefined, now: number): boolean {
  return updatedAt !== undefined && now - updatedAt > STALE_AFTER_MS;
}
