// Pure derivations from server data to what the shell shows: the status pill and the banners.
// These pick WORDS for what the server already decided; they never decide anything about funds.
export type PillState = 'active' | 'waiting' | 'frozen' | 'breaker' | 'safe';

export const PILL: Record<PillState, { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' }> = {
  active: { label: 'Active', tone: 'ok' },
  waiting: { label: 'Waiting for approval', tone: 'warn' },
  frozen: { label: 'Frozen', tone: 'bad' },
  breaker: { label: 'Breaker tripped', tone: 'bad' },
  safe: { label: 'Safe mode', tone: 'warn' },
};

type StatusInput = {
  wallet: { frozen: boolean; breakerOpen: boolean };
  pendingApprovals: number;
  /** No worker heartbeat within the last few minutes: the autonomous loop isn't ticking. */
  workerStale: boolean;
};

/** Precedence mirrors the server's own: frozen beats everything, then the breaker, then service state. */
export function pillState(d: StatusInput): PillState {
  if (d.wallet.frozen) return 'frozen';
  if (d.wallet.breakerOpen) return 'breaker';
  if (d.pendingApprovals > 0) return 'waiting';
  if (d.workerStale) return 'safe';
  return 'active';
}

export function pillLabel(state: PillState, pending = 0): string {
  return state === 'waiting' ? `${PILL.waiting.label} (${pending})` : PILL[state].label;
}

export type Banner = {
  id: 'frozen' | 'breaker' | 'safe' | 'demo';
  tone: 'warn' | 'bad' | 'info';
  title: string;
  body: string;
  /** assertive for anything that needs the owner or means money is stopped */
  live: 'polite' | 'assertive';
};

type BannerInput = {
  demoMode: boolean;
  wallet: { frozen: boolean; frozenReason: string | null; breakerOpen: boolean } | undefined;
  workerStale: boolean;
};

/** Which banners the shell shows, in order. */
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
  if (i.wallet?.frozen)
    out.push({
      id: 'frozen',
      tone: 'bad',
      title: 'Frozen',
      body: `Thesauros is stopped. Nothing will move until you unfreeze.${
        i.wallet.frozenReason ? ` (${i.wallet.frozenReason})` : ''
      }`,
      live: 'assertive',
    });
  else if (i.wallet?.breakerOpen)
    out.push({
      id: 'breaker',
      tone: 'bad',
      title: 'Breaker tripped',
      body: 'Thesauros stopped itself after repeated failures. Nothing is moving. Freeze still works.',
      live: 'assertive',
    });
  if (i.workerStale)
    out.push({
      id: 'safe',
      tone: 'warn',
      title: 'Safe mode',
      body: 'The autonomous loop has not checked in recently. Your funds are safe; nothing will move on schedule until it does.',
      live: 'polite',
    });
  return out;
}
