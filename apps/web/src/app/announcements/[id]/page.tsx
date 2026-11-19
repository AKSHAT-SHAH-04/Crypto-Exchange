'use client';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';
import type { Announcement } from '@/lib/types';

export default function AnnouncementPage({ params }: { params: { id: string } }) {
  const a = useApi<Announcement>(`/api/announcements/${params.id}`);
  return (
    <div className="mx-auto max-w-[760px] px-4 py-8">
      <Link href="/announcements" className="text-sm text-brand">← All announcements</Link>
      {a.data ? (
        <article className="mt-4">
          <span className="rounded bg-panel2 px-2 py-0.5 text-xs text-muted">{a.data.category}</span>
          <h1 className="mt-3 text-3xl font-bold leading-tight">{a.data.title}</h1>
          <div className="mt-2 text-sm text-muted">{fmtDateTime(a.data.createdAt)}</div>
          <div className="mt-6 whitespace-pre-wrap leading-relaxed">{a.data.body}</div>
        </article>
      ) : (
        <p className="mt-6 text-muted">{a.error ?? 'Loading…'}</p>
      )}
    </div>
  );
}
