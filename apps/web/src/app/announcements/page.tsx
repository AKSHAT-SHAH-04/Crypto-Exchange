'use client';
import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useApi } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';
import type { Announcement } from '@/lib/types';

const CATS = ['All', 'General', 'New Listing', 'Product', 'Promotion', 'Maintenance', 'Security'];

export default function AnnouncementsPage() {
  const [cat, setCat] = useState('All');
  const list = useApi<Announcement[]>(`/api/announcements${cat !== 'All' ? `?category=${encodeURIComponent(cat)}` : ''}`);
  return (
    <div className="mx-auto max-w-[900px] px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">Announcements</h1>
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {CATS.map((c) => (
          <button key={c} onClick={() => setCat(c)} className={clsx('shrink-0 rounded-md px-3 py-1.5 text-sm', cat === c ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg')}>{c}</button>
        ))}
      </div>
      <div className="card divide-y divide-line/60">
        {list.data?.map((a) => (
          <Link key={a.id} href={`/announcements/${a.id}`} className="block px-5 py-4 hover:bg-panel2">
            <div className="flex flex-wrap items-center gap-2">
              {a.pinned && <span className="text-xs text-brand">📌</span>}
              <span className="font-medium">{a.title}</span>
              <span className="rounded bg-panel2 px-1.5 text-[11px] text-muted">{a.category}</span>
              <span className="ml-auto text-xs text-muted">{fmtDateTime(a.createdAt)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted">{a.body}</p>
          </Link>
        ))}
        {!list.data?.length && <div className="p-10 text-center text-muted">{list.loading ? 'Loading…' : 'No announcements'}</div>}
      </div>
    </div>
  );
}
