'use client';
// The modal FRAME: scrim, glass sheet, focus trap, Escape to close, focus restored to the opener.
import { useRef } from 'react';
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
        className="glass-sheet relative max-h-[calc(100dvh-2rem)] w-full max-w-[440px] overflow-y-auto rounded-lg p-5"
      >
        <h2 id="freeze-title" className="text-h2 font-bold text-ink">
          Freeze Thesauros
        </h2>
        <p className="max-w-[46ch] pt-3 pb-4 text-small text-muted">
          Thesauros stops proposing and stops executing, right now. Nothing in the treasury moves
          until you unfreeze.
        </p>
        <FreezeFlow frozen={frozen} onDone={onDone} onClose={onClose} />
      </div>
    </div>
  );
}
