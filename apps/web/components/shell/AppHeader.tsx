'use client';
import Link from 'next/link';
import { IconBack, IconFreeze, IconUser } from '@/components/icons';
import { Wordmark } from '@/components/primitives';
import { NotificationBell } from './NotificationBell';

/** The global Freeze control: a red-tint pill; solid red once frozen. Still a BUTTON when frozen —
 * freezing is step 1 of three, so a reopened modal has to be reachable to finish it. */
export function FreezeButton({ frozen, onOpen }: { frozen: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      {...(frozen ? { 'aria-live': 'assertive' as const } : {})}
      className={`inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-cap font-bold tracking-[0.06em] uppercase transition-colors ${
        frozen
          ? 'bg-deny-fill text-on-deny-fill'
          : 'bg-deny-tint text-deny hover:bg-deny-fill hover:text-on-deny-fill'
      }`}
    >
      <IconFreeze className="size-4" />
      {frozen ? 'Frozen' : 'Freeze'}
    </button>
  );
}

export function NetworkPill({ testnet }: { testnet: boolean }) {
  return (
    <span className="hidden items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 min-[380px]:inline-flex">
      <span className="size-2 rounded-full bg-accent breathe" aria-hidden="true" />
      <span className="text-cap leading-[14px] font-bold whitespace-nowrap text-muted">
        {testnet ? 'Arc Testnet' : 'Arc'}
      </span>
    </span>
  );
}

export function AppHeader({
  back,
  frozen,
  testnet,
  onFreeze,
}: {
  /** A sub-page: back arrow + centred title instead of the wordmark. */
  back: { href: string; title: string } | null;
  frozen: boolean;
  testnet: boolean;
  onFreeze: () => void;
}) {
  return (
    <header className="glass sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-16 max-w-[480px] items-center justify-between gap-2 px-4 lg:max-w-[1040px]">
        {back ? (
          <>
            <Link
              href={back.href}
              aria-label="Back"
              className="group -ml-2 flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface-3"
            >
              <IconBack className="size-[22px] transition-transform duration-200 group-hover:-translate-x-0.5 motion-reduce:transition-none" />
            </Link>
            <span className="min-w-0 flex-1 truncate text-center text-small font-bold tracking-[0.02em] text-ink uppercase">
              {back.title}
            </span>
          </>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/app" className="flex min-h-11 items-center" aria-label="Thesauros home">
              <Wordmark />
            </Link>
            <NetworkPill testnet={testnet} />
          </div>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          <FreezeButton frozen={frozen} onOpen={onFreeze} />
          <NotificationBell />
          {back ? null : (
            <Link
              href="/app/settings"
              aria-label="Account and settings"
              className="flex size-11 items-center justify-center"
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-inverse text-on-inverse">
                <IconUser className="size-[18px]" />
              </span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
