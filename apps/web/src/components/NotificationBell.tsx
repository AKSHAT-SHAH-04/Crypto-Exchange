'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useUserEvents } from '@/lib/hooks';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/format';
import type { Notification } from '@/lib/types';

export function NotificationBell() {
  const { t } = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = () => api<{ items: Notification[]; unreadCount: number }>('/api/notifications').then((r) => { setItems(r.items.slice(0, 12)); setUnread(r.unreadCount); }).catch(() => {});
  useEffect(() => { load(); }, []);
  useUserEvents((ev) => {
    if (ev.type === 'notification') {
      setItems((s) => [ev.notification, ...s].slice(0, 12));
      setUnread((u) => u + 1);
      if (ev.notification.type !== 'order') toast(ev.notification.title, 'info');
    }
  });
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const markAll = async () => {
    await api('/api/notifications/read', { method: 'POST', body: {} }).catch(() => {});
    setUnread(0);
    setItems((s) => s.map((n) => ({ ...n, read: true })));
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-2 text-muted hover:bg-panel2 hover:text-fg" aria-label={t('nav.notifications')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-down px-1 text-center text-[10px] font-bold leading-4 text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-16 z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-panel shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-96">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="font-semibold">{t('nav.notifications')}</span>
            {unread > 0 && <button className="text-xs text-brand" onClick={markAll}>Mark all read</button>}
          </div>
          {items.map((n) => (
            <Link key={n.id} href={n.link || '/notifications'} onClick={() => setOpen(false)} className={clsx('block border-b border-line/50 px-4 py-3 hover:bg-panel2', !n.read && 'bg-brand/5')}>
              <div className="flex items-start gap-2">
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />}
                <div className="min-w-0">
                  <div className="text-sm font-medium">{n.title}</div>
                  <div className="line-clamp-2 text-xs text-muted">{n.body}</div>
                  <div className="mt-1 text-[11px] text-muted">{fmtDateTime(n.createdAt)}</div>
                </div>
              </div>
            </Link>
          ))}
          {!items.length && <div className="p-8 text-center text-sm text-muted">No notifications yet</div>}
          <Link href="/notifications" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-center text-sm text-brand hover:bg-panel2">View all</Link>
        </div>
      )}
    </div>
  );
}
