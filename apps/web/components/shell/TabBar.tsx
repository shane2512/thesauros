'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconActivity,
  IconApprovals,
  IconHome,
  IconRecipients,
  IconSettings,
  type IconComponent,
} from '@/components/icons';

export const TABS: readonly { href: string; label: string; icon: IconComponent }[] = [
  { href: '/app', label: 'Home', icon: IconHome },
  { href: '/app/activity', label: 'Activity', icon: IconActivity },
  { href: '/app/approvals', label: 'Approvals', icon: IconApprovals },
  { href: '/app/recipients', label: 'Recipients', icon: IconRecipients },
  { href: '/app/settings', label: 'Settings', icon: IconSettings },
];

export const isActiveTab = (pathname: string, href: string): boolean =>
  href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(`${href}/`);

/** Mobile: bottom tab bar, accent bar above the active item. Desktop (lg): a left rail. */
export function TabBar({ pending }: { pending: number }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="glass fixed inset-x-0 bottom-0 z-30 flex border-t border-line pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-20 lg:flex-col lg:justify-start lg:gap-1 lg:border-t-0 lg:border-r lg:pt-16 lg:pb-0"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const on = isActiveTab(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? 'page' : undefined}
            className="relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 pt-2 lg:flex-none lg:py-3"
          >
            {on ? (
              <span
                aria-hidden="true"
                className="absolute top-0 h-[3px] w-10 rounded-full bg-accent lg:top-auto lg:left-0 lg:h-8 lg:w-[3px]"
              />
            ) : null}
            <span className="relative">
              <Icon className={`size-6 ${on ? 'text-ink' : 'text-muted'}`} />
              {href === '/app/approvals' && pending > 0 ? (
                <span
                  aria-label={`${pending} waiting`}
                  className="absolute -top-1.5 -right-2.5 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-on-accent"
                >
                  {pending}
                </span>
              ) : null}
            </span>
            <span className={`text-label ${on ? 'font-semibold text-ink' : 'text-muted'}`}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
