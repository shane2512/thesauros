// One icon family: flat geometric glyphs, 1.75px stroke, square caps.
import type { ReactNode } from 'react';

export type IconProps = { className?: string };
export type IconComponent = (p: IconProps) => ReactNode;

const S = (d: string): IconComponent =>
  function Icon({ className }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="square"
        strokeLinejoin="miter"
        className={className}
        aria-hidden="true"
        focusable="false"
      >
        <path d={d} />
      </svg>
    );
  };

export const IconApprovals = S('M4 13v7h16v-7M4 13h5l1 2h4l1-2h5M12 3v8M9 8l3 3 3-3');
export const IconRecipients = S(
  'M5 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
);
export const IconActivity = S('M3 12h4l3-7 4 14 3-7h4');
export const IconAdd = S('M12 5v14M5 12h14');
export const IconChevron = S('M9 5l7 7-7 7');
export const IconChevronDown = S('M5 9l7 7 7-7');
export const IconBack = S('M15 5l-7 7 7 7');
export const IconClose = S('M6 6l12 12M18 6L6 18');
export const IconSearch = S('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4');
export const IconExternal = S('M14 4h6v6M20 4l-9 9M18 14v6H4V6h6');
export const IconVault = S('M4 5h16v14H4zM12 9v6M9 12h6');
export const IconWallet = S('M3 7h15a3 3 0 0 1 3 3v7H3zM3 7V5h13M17 13h1');
export const IconHome = S('M4 10l8-6 8 6v10H4z');
export const IconSettings = S('M4 7h16M4 12h16M4 17h16');
export const IconDoc = S('M6 3h8l4 4v14H6zM14 3v4h4');
export const IconShield = S('M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z');
export const IconBell = S('M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3zM10 20h4');
export const IconRevoke = S('M5 5l14 14M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z');
export const IconLock = S('M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3');
export const IconCopy = S('M9 9h11v11H9zM4 4h11v3M4 4v11h3');
export const IconCheck = S('M5 12l5 5 9-10');
export const IconRefresh = S('M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5');

/** Verdict glyph: three non-colour channels: filled disc, outlined ring, disc with slash. */
export type VerdictTone = 'allow' | 'escalate' | 'deny';

export function VerdictGlyph({ tone, className }: { tone: VerdictTone; className?: string }) {
  if (tone === 'escalate') {
    return (
      <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      {tone === 'allow' ? (
        <path d="M4.6 8.2l2.3 2.3 4.5-4.7" fill="none" stroke="var(--th-ground)" strokeWidth="2" />
      ) : (
        <path d="M4.6 4.6l6.8 6.8" fill="none" stroke="var(--th-ground)" strokeWidth="2" />
      )}
    </svg>
  );
}
