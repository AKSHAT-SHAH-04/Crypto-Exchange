'use client';
import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { RequireAuth } from '@/components/RequireAuth';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';
import type { Notification } from '@/lib/types';

const TYPES = ['all', 'order', 'alert', 'wallet', 'p2p', 'kyc', 'support'] as const;

function Notifications() {
  const list = useApi<{ items: Notification[]; unreadCount: number }>('/api/notifications');
  const [type, setType] = useState<(typeof TYPES)[number]>('all');
  const items = (list.data?.items ?? []).filter((n) => type === 'all' || n.type === type);
  return (
    <div className="mx-auto max-w-[900px] px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost py-1.5" onClick={() => api('/api/notifications/read', { method: 'POST', body: {} }).then(list.reload)}>Mark all read</button>
          <button className="btn-ghost py-1.5" onClick={() => api('/api/notifications', { method: 'DELETE' }).then(list.reload)}>Clear read</button>
        </div>
      </div>
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {TYPES.map((t) => (
          <button key={t} onClick={() => setType(t)} className={clsx('rounded-md px-3 py-1.5 text-sm capitalize', type === t ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg')}>{t === 'p2p' ? 'P2P' : t}</button>
        ))}
      </div>
      <div className="card divide-y divide-line/60">
        {items.map((n) => (
          <Link key={n.id} href={n.link || '#'} className={clsx('flex gap-3 px-5 py-4 hover:bg-panel2', !n.read && 'bg-brand/5')}>
            <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand')} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{n.title}</span>
                <span className="rounded bg-panel2 px-1.5 text-[10px] uppercase text-muted">{n.type}</span>
                <span className="ml-auto text-xs text-muted">{fmtDateTime(n.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{n.body}</p>
            </div>
          </Link>
        ))}
        {!items.length && <div className="p-10 text-center text-muted">{list.loading ? 'Loading…' : 'Nothing here'}</div>}
      </div>
    </div>
  );
}

export default function Page() {
  return <RequireAuth><Notifications /></RequireAuth>;
}
