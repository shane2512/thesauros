'use client';
// The authenticated layout shell: glass header with the global Freeze button, banners, the tab bar
// / rail, and the page column. A centred phone-width column, widened only on the screens that earn
// two columns.
import { usePathname } from 'next/navigation';
import { useCallback, useState, type ReactNode } from 'react';
import { FreezeModal } from '@/components/freeze/FreezeModal';
import { Banner, LoadBar } from '@/components/primitives';
import { zConfig, zDashboard } from '@/lib/contracts';
import { banners, pillState } from '@/lib/status';
import { POLL_MS, useApi } from '@/lib/useApi';
import { useNow } from '@/lib/useNow';
import { AppHeader } from './AppHeader';
import { TabBar } from './TabBar';

const TITLES: Record<string, string> = {
  '/app/activity': 'Activity',
  '/app/approvals': 'Approvals',
  '/app/policy': 'Policy',
  '/app/recipients': 'Recipients',
  '/app/settings': 'Settings',
  '/app/settings/close': 'Close account',
};
const WIDE = new Set(['/app/activity', '/app/policy', '/app/approvals']);

export function AppShell({ children, tabs = true }: { children: ReactNode; tabs?: boolean }) {
  const pathname = usePathname();
  const cfg = useApi('/api/config', zConfig);
  const dash = useApi('/api/dashboard', zDashboard, { refetchInterval: POLL_MS });
  const now = useNow(5_000);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const closeFreeze = useCallback(() => setFreezeOpen(false), []);

  const d = dash.data;
  const frozen = d?.wallet.frozen ?? false;
  const wide = WIDE.has(pathname);
  const list = banners({
    demoMode: cfg.data?.demoMode ?? d?.demoMode ?? false,
    data: d,
    updatedAt: dash.updatedAt,
    now,
    refreshFailed: dash.refreshFailed,
  });

  return (
    <div className="min-h-dvh lg:pl-20">
      <LoadBar active={dash.isLoading} />
      <AppHeader
        title={TITLES[pathname] ?? null}
        pill={d ? pillState(d) : null}
        pending={d?.pendingApprovals ?? 0}
        frozen={frozen}
        onFreeze={() => setFreezeOpen(true)}
        wide={wide}
      />
      {list.map((b) => (
        <Banner key={b.id} id={b.id} tone={b.tone} title={b.title} live={b.live}>
          {b.body}
        </Banner>
      ))}
      <main
        id="main"
        tabIndex={-1}
        className={`mx-auto w-full pb-28 outline-none lg:pb-10 ${wide ? 'max-w-[440px] lg:max-w-[1080px]' : 'max-w-[440px]'}`}
      >
        {children}
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
