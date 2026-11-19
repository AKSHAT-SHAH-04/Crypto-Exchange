'use client';
import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { RequireAuth } from '@/components/RequireAuth';
import { StatusBadge } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { api, errMsg } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';

function Ticket({ id }: { id: string }) {
  const toast = useToast();
  const t = useApi<any>(`/api/support/tickets/${id}`);
  const [body, setBody] = useState('');
  const send = async () => {
    try {
      await api(`/api/support/tickets/${id}/messages`, { method: 'POST', body: { body } });
      setBody('');
      t.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  if (!t.data) return <div className="p-10 text-center text-muted">{t.error ?? 'Loading…'}</div>;
  return (
    <div className="mx-auto max-w-[800px] px-4 py-8">
      <Link href="/support" className="text-sm text-brand">← Support</Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{t.data.subject}</h1>
        <StatusBadge status={t.data.status === 'ANSWERED' ? 'APPROVED' : t.data.status === 'CLOSED' ? 'CANCELED' : 'PENDING'} />
        <span className="text-xs text-muted">{t.data.category} · #{t.data.id.slice(-8)}</span>
        {t.data.status !== 'CLOSED' && <button className="btn-ghost ml-auto py-1.5" onClick={() => api(`/api/support/tickets/${id}/close`, { method: 'POST' }).then(t.reload)}>Close ticket</button>}
      </div>
      <div className="mt-6 space-y-3">
        {t.data.messages.map((m: any) => (
          <div key={m.id} className={clsx('card p-4', m.staff && 'border-brand/50')}>
            <div className="mb-1 flex text-xs text-muted">
              <span className={m.staff ? 'font-semibold text-brand' : ''}>{m.staff ? 'Support team' : 'You'}</span>
              <span className="ml-auto">{fmtDateTime(m.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{m.body}</p>
          </div>
        ))}
      </div>
      {t.data.status !== 'CLOSED' && (
        <div className="mt-4 space-y-2">
          <textarea className="input min-h-[100px]" placeholder="Reply…" value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn-brand" disabled={!body.trim()} onClick={send}>Send reply</button>
        </div>
      )}
    </div>
  );
}

export default function Page({ params }: { params: { id: string } }) {
  return <RequireAuth><Ticket id={params.id} /></RequireAuth>;
}
