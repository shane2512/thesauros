'use client';
// Bottom sheet: white, 28px top corners, grabber, close button, focus trapped. Centred on desktop.
import { useRef, type ReactNode } from 'react';
import { IconClose } from '@/components/icons';
import { useFocusTrap } from '@/lib/useFocusTrap';

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center">
      <div className="scrim absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        tabIndex={-1}
        className="glass-sheet sheet-in relative max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-xl px-5 pt-3 pb-[max(24px,env(safe-area-inset-bottom))] lg:rounded-xl"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-surface-3" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3 pb-2">
          <h2 id="sheet-title" className="text-section leading-7 font-bold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-2 flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-ink"
          >
            <IconClose className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
