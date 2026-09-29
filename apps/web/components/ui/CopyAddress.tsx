'use client';
import { useState } from 'react';
import { IconCheck, IconCopy } from '@/components/icons';
import { groupAddress } from '@/lib/format';

/** A full checksummed address in 4-character groups, with a copy control. Never truncated. */
export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard can be blocked; the address is still on screen to select */
    }
  };
  return (
    <div className="rounded-md bg-surface-2 p-4">
      <p
        className="font-mono text-small leading-7 tracking-[0.04em] break-words text-ink select-all"
        aria-label={address.replace(/^0x/, '0x ').replace(/(.{4})/g, '$1 ')}
      >
        {groupAddress(address)}
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-card px-4 text-ui font-bold text-ink shadow-e1 hover:bg-surface-3"
      >
        {copied ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
        {copied ? 'Copied' : 'Copy address'}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? 'Address copied' : ''}
      </span>
    </div>
  );
}
