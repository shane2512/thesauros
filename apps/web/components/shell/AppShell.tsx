'use client';
// The authenticated layout shell: frosted header with the global Freeze button, banners, the tab
// bar / rail, and one phone-width page column.
import { usePathname } from 'next/navigation';
import { useCallback, useState, type ReactNode } from 'react';
import { FreezeModal } from '@/components/freeze/FreezeModal';
import { Banner, LoadBar } from '@/components/primitives';
import { zConfig, zDashboard } from '@/lib/contracts';
import { banners } from '@/lib/status';
import { POLL_MS, useApi } from '@/lib/useApi';
import { useNow } from '@/lib/useNow';
import { AppHeader } from './AppHeader';
import { TabBar } from './TabBar';

const ARC_TESTNET = 5042002;

/** Sub-pages get a back arrow to their parent instead of the wordmark. Tab roots get neither. */
export function backFor(pathname: string): { href: string; title: string } | null {
  if (pathname === '/app/policy') return { href: '/app', title: 'Policy' };
  if (pathname === '/app/recipients') return { href: '/app', title: 'Recipients' };
  if (pathname === '/app/settings/close') return { href: '/app/settings', title: 'Close account' };
  if (pathname.startsWith('/app/activity/'))
    return { href: '/app/activity', title: 'Event & proof' };
  return null;
}

export function AppShell({ children, tabs = true }: { children: ReactNode; tabs?: boolean }) {
  const pathname = usePathname();
  const cfg = useApi('/api/config', zConfig);
  const dash = useApi('/api/dashboard', zDashboard, { refetchInterval: POLL_MS });
  const now = useNow(5_000);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const closeFreeze = useCallback(() => setFreezeOpen(false), []);

  const d = dash.data;
  const frozen = d?.wallet.frozen ?? false;
  const chainId = cfg.data?.chainId ?? d?.wallet.chainId ?? ARC_TESTNET;
  const list = banners({
    demoMode: cfg.data?.demoMode ?? d?.demoMode ?? false,
    data: d,
    updatedAt: dash.updatedAt,
    now,
    refreshFailed: dash.refreshFailed,
  });

  return (
    <div className="min-h-dvh lg:pl-24">
      <LoadBar active={dash.isLoading} />
      <AppHeader
        back={backFor(pathname)}
        frozen={frozen}
        testnet={chainId === ARC_TESTNET}
        onFreeze={() => setFreezeOpen(true)}
      />
      {list.map((b) => (
        <Banner key={b.id} id={b.id} tone={b.tone} title={b.title} live={b.live}>
          {b.body}
        </Banner>
      ))}
      <main
        id="main"
        tabIndex={-1}
        className={`mx-auto w-full max-w-[480px] outline-none ${
          pathname === '/app' ? 'lg:max-w-[1040px]' : 'lg:max-w-[640px]'
        } ${tabs ? 'pb-28 lg:pb-10' : 'pb-4'}`}
      >
        {/* re-keyed per route so each screen settles in once; the shell itself never re-animates */}
        <div key={pathname} className="rise-in">
          {children}
        </div>
      </main>
      {tabs ? <TabBar pending={d?.pendingApprovals ?? 0} /> : null}
      <FreezeModal
        open={freezeOpen}
        frozen={frozen}
        onClose={closeFreeze}
        onDone={() => {
          dash.refetch();
          closeFreeze();
        }}
      />
    </div>
  );
}
