'use client';
import Link from 'next/link';
import { IconBack } from '@/components/icons';
import { StatusPill, Wordmark } from '@/components/primitives';
import { pillLabel, type PillState } from '@/lib/status';
import { NotificationBell } from './NotificationBell';

/** The global Freeze control: calm outlined pill; a filled chip once frozen. Still a BUTTON when
 * frozen — freezing is step 1 of three, so a reopened modal has to be reachable to finish it. */
export function FreezeButton({ frozen, onOpen }: { frozen: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      {...(frozen ? { 'aria-live': 'assertive' as const } : {})}
      className={
        frozen
          ? 'inline-flex h-11 items-center rounded-full bg-deny-fill px-4 text-small font-bold text-on-deny-fill'
          : 'inline-flex h-11 items-center rounded-full border border-deny/40 px-4 text-small font-bold text-deny transition-colors hover:border-deny hover:bg-deny-tint focus-visible:border-deny'
      }
    >
      {frozen ? 'Frozen' : 'Freeze'}
    </button>
  );
}

export function AppHeader({
  title,
  pill,
  pending,
  frozen,
  onFreeze,
  wide,
}: {
  title: string | null;
  pill: PillState | null;
  pending: number;
  frozen: boolean;
  onFreeze: () => void;
  wide: boolean;
}) {
  return (
    <header className="glass sticky top-0 z-30 h-14">
      <div
        className={`mx-auto flex h-full items-center justify-between gap-3 px-4 ${
          wide ? 'max-w-[440px] lg:max-w-[1080px]' : 'max-w-[440px]'
        }`}
      >
        {title ? (
          <>
            <Link
              href="/app"
              aria-label="Back to home"
              className="group -ml-2 flex size-11 items-center justify-center text-ink"
            >
              <IconBack className="size-6 transition-transform duration-300 ease-out group-hover:-translate-x-0.5 motion-reduce:transition-none" />
            </Link>
            <span className="min-w-0 flex-1 truncate text-h3 font-semibold text-ink">{title}</span>
          </>
        ) : (
          <>
            <Link href="/app" className="flex min-h-11 items-center" aria-label="Thesauros home">
              <Wordmark />
            </Link>
            {pill ? <StatusPill state={pill} label={pillLabel(pill, pending)} /> : <span />}
          </>
        )}
        <div className="flex items-center gap-1">
          <NotificationBell />
          <FreezeButton frozen={frozen} onOpen={onFreeze} />
        </div>
      </div>
    </header>
  );
}
