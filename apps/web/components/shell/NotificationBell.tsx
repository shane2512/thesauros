'use client';
// The notification bell in the header: a badge for unread count, a glass sheet listing recent ones.
import { useRef, useState } from 'react';
import { z } from 'zod';
import {
  IconApprovals,
  IconBell,
  IconClose,
  IconRevoke,
  IconShield,
  IconVault,
  type IconComponent,
} from '@/components/icons';
import { EmptyState, Row, RowSkeleton } from '@/components/primitives';
import { apiPost } from '@/lib/api';
import { zNotificationList, type NotificationItem } from '@/lib/contracts';
import { formatAgo } from '@/lib/format';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { POLL_MS, useApi } from '@/lib/useApi';

const zOk = z.object({}).passthrough();

const TITLES: Record<NotificationItem['type'], string> = {
  execution: 'Action',
  escalation: 'Needs approval',
  blocked: 'Blocked',
  risk: 'Risk',
  freeze: 'Freeze',
  report: 'Weekly report',
};

const NOTIF_ICON: Record<NotificationItem['type'], { Icon: IconComponent; tone: string }> = {
  execution: { Icon: IconVault, tone: 'text-allow' },
  escalation: { Icon: IconApprovals, tone: 'text-escalate' },
  blocked: { Icon: IconShield, tone: 'text-deny' },
  risk: { Icon: IconShield, tone: 'text-escalate' },
  freeze: { Icon: IconRevoke, tone: 'text-deny' },
  report: { Icon: IconApprovals, tone: 'text-muted' },
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const list = useApi('/api/notifications', zNotificationList, {
    refetchInterval: open ? false : POLL_MS,
  });
  const unread = list.data?.unreadCount ?? 0;
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useFocusTrap(ref, open, close);

  const markRead = async (id: string) => {
    try {
      await apiPost(`/api/notifications/${id}/read`, zOk);
    } catch {
      /* best-effort; the badge is a convenience, not a source of truth */
    }
    list.refetch();
  };
  const markAllRead = async () => {
    try {
      await apiPost('/api/notifications/read-all', zOk);
    } catch {
      /* same as above */
    }
    list.refetch();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface-3"
      >
        <IconBell className="size-[22px]" />
        <span aria-live="polite" className="sr-only">
          {unread > 0 ? `${unread} unread notifications` : 'No unread notifications'}
        </span>
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-micro font-bold text-on-accent ring-2 ring-card"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50" onClick={close} aria-hidden="true">
          <div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="glass-sheet pop-in absolute top-16 right-4 max-h-[70dvh] w-[min(92vw,380px)] overflow-y-auto rounded-lg"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-lead font-bold text-ink">Notifications</h2>
              <div className="flex items-center gap-2">
                {unread > 0 ? (
                  <button
                    type="button"
                    onClick={() => void markAllRead()}
                    className="text-small font-semibold text-accent-ink"
                  >
                    Mark all read
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close notifications"
                  className="flex size-8 items-center justify-center text-muted"
                >
                  <IconClose className="size-5" />
                </button>
              </div>
            </div>
            <div className="border-t border-line">
              {list.isLoading ? (
                <>
                  <RowSkeleton />
                  <RowSkeleton />
                </>
              ) : (list.data?.rows.length ?? 0) === 0 ? (
                <EmptyState
                  title="Nothing yet"
                  body="Thesauros will notify you here as things happen."
                />
              ) : (
                list.data?.rows.map((n) => {
                  const { Icon, tone } = NOTIF_ICON[n.type];
                  return (
                    <Row
                      key={n.id}
                      icon={({ className }) => <Icon className={`${className} ${tone}`} />}
                      title={
                        <span className={n.read ? 'font-normal' : ''}>
                          {TITLES[n.type]}: {n.title}
                        </span>
                      }
                      sub={
                        <>
                          <span className="line-clamp-2 block">{n.body}</span>
                          <span className="block font-mono text-label text-faint">
                            {formatAgo(n.createdAt)}
                          </span>
                        </>
                      }
                      right={
                        n.read ? null : (
                          <button
                            type="button"
                            aria-label="Mark as read"
                            onClick={(e) => {
                              e.stopPropagation();
                              void markRead(n.id);
                            }}
                            className="flex size-8 items-center justify-center text-faint transition-colors hover:text-ink"
                          >
                            <IconClose className="size-4" />
                          </button>
                        )
                      }
                    />
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
