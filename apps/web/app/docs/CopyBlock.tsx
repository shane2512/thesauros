'use client';
import { useState } from 'react';

/** A sample the reader can copy in one click. */
export function CopyBlock({ title, note, text }: { title: string; note?: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard can be blocked; the text is still selectable */
    }
  };
  return (
    <figure className="mt-4 rounded-md border border-line-strong bg-card">
      <figcaption className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <span>
          <span className="block text-[15px] font-semibold text-ink">{title}</span>
          {note ? <span className="block text-[13px] leading-5 text-muted">{note}</span> : null}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-ink px-3.5 text-[13px] font-bold text-on-inverse"
          aria-label={`Copy ${title}`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      <blockquote className="px-4 py-3.5 text-[15px] leading-7 text-ink">{text}</blockquote>
    </figure>
  );
}
