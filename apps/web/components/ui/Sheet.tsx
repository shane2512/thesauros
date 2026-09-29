'use client';
// Bottom sheet: glass, 28px top corners, grabber, focus trapped. Centred card on desktop.
import { useRef, type ReactNode } from 'react';
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
        className="glass-sheet relative w-full max-w-[440px] rounded-t-xl px-4 pt-3 pb-6 lg:rounded-lg"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-faint" aria-hidden="true" />
        <h2 id="sheet-title" className="pb-4 text-h2 font-bold text-ink">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
