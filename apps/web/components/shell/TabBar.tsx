'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconHome,
  IconLedger,
  IconSettings,
  IconShieldCheck,
  type IconComponent,
} from '@/components/icons';

export const TABS: readonly { href: string; label: string; icon: IconComponent }[] = [
  { href: '/app', label: 'Treasury', icon: IconHome },
  { href: '/app/activity', label: 'Activity', icon: IconLedger },
  { href: '/app/approvals', label: 'Approvals', icon: IconShieldCheck },
  { href: '/app/settings', label: 'Settings', icon: IconSettings },
];

export const isActiveTab = (pathname: string, href: string): boolean =>
  href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(`${href}/`);

/** Mobile: frosted bottom tab bar, the active icon sits in a orange pill. Desktop (lg): a left rail. */
export function TabBar({ pending }: { pending: number }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="glass fixed inset-x-0 bottom-0 z-30 flex pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-24 lg:flex-col lg:justify-start lg:gap-2 lg:pt-20 lg:pb-0"
    >
      <div className="mx-auto flex w-full max-w-[480px] lg:flex-col lg:gap-2">
        {TABS.map(({ href, label, icon: Icon }) => {
          const on = isActiveTab(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? 'page' : undefined}
              className={`group flex min-h-16 flex-1 flex-col items-center justify-center gap-1 lg:flex-none lg:py-2 ${
                on ? 'text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              <span
                className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 ${
                  on ? 'bg-accent text-on-accent' : 'group-hover:bg-surface-3'
                }`}
              >
                <Icon className="size-[22px]" />
                {href === '/app/approvals' && pending > 0 ? (
                  <span
                    aria-label={`${pending} waiting`}
                    className="absolute -top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-deny-fill px-1 text-micro font-bold text-on-deny-fill ring-2 ring-card"
                  >
                    {pending}
                  </span>
                ) : null}
              </span>
              <span className={`text-cap leading-[14px] ${on ? 'font-bold' : 'font-semibold'}`}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
