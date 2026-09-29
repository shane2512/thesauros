'use client';
// The modal FRAME: scrim, white dialog with a red top rule, focus trap, Escape to close, focus
// restored to the opener.
import { useRef } from 'react';
import { IconClose, IconFreeze } from '@/components/icons';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { FreezeFlow, type FreezeFlowProps } from './FreezeFlow';

export function FreezeModal({
  open,
  frozen,
  onClose,
  onDone,
}: { open: boolean } & FreezeFlowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, onClose);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="scrim absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="freeze-title"
        tabIndex={-1}
        className="pop-in relative max-h-[calc(100dvh-2rem)] w-full max-w-[440px] overflow-y-auto rounded-xl bg-card shadow-e2 ring-1 ring-deny/15"
      >
        <div className="h-1.5 w-full bg-deny-fill" aria-hidden="true" />
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-md bg-deny-tint text-deny">
                <IconFreeze className="size-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="freeze-title" className="font-display text-h2 font-bold text-ink">
                    Freeze Thesauros
                  </h2>
                  <span className="rounded-full bg-deny-fill px-2 py-0.5 font-mono text-micro font-bold tracking-[0.08em] text-on-deny-fill uppercase">
                    Kill switch
                  </span>
                </div>
                <p className="pt-1 text-meta leading-[18px] text-muted">
                  Thesauros stops proposing and executing, right now. Nothing in the treasury moves
                  until you unfreeze.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close freeze dialog"
              className="-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-ink"
            >
              <IconClose className="size-5" />
            </button>
          </div>
          <div className="pt-4">
            <FreezeFlow frozen={frozen} onDone={onDone} onClose={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}
