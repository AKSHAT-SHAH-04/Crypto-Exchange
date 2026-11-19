'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RequireAuth } from '@/components/RequireAuth';
import { Field, StatusBadge } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { api, errMsg } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';

const CATEGORIES = ['Account', 'Deposit & Withdrawal', 'Trading', 'P2P', 'KYC', 'API', 'Other'];
const FAQ = [
  ['How do OCO orders work?', 'An OCO places a limit order and a stop-limit order together. If one executes (even partially), the other is canceled automatically. Use it to set a take-profit and a stop-loss at the same time.'],
  ['Why is my withdrawal pending?', 'Withdrawals need email confirmation and then a security review. You can cancel a pending withdrawal from your wallet history.'],
  ['How is P2P protected?', "The seller's crypto is held in escrow. It is only released when the seller confirms receiving your payment, or by support after a dispute."],
  ['How are trading fees calculated?', 'Fees depend on your 30-day trading volume (VIP tier) and whether you pay fees with the discount token. See Account → Fees.'],
];

function Support() {
  const router = useRouter();
  const toast = useToast();
  const tickets = useApi<any[]>('/api/support/tickets');
  const [f, setF] = useState({ subject: '', category: 'Trading', body: '' });
  const submit = async () => {
    try {
      const t = await api<{ id: string }>('/api/support/tickets', { method: 'POST', body: f });
      router.push(`/support/${t.id}`);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  return (
    <div className="mx-auto grid max-w-[1100px] gap-6 px-4 py-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Support center</h1>
          <p className="mt-1 text-sm text-muted">Find answers or talk to our team.</p>
        </div>
        <div className="card divide-y divide-line/60">
          {FAQ.map(([q, a]) => (
            <details key={q} className="px-5 py-3">
              <summary className="cursor-pointer font-medium">{q}</summary>
              <p className="mt-2 text-sm text-muted">{a}</p>
            </details>
          ))}
        </div>
        <div className="card overflow-x-auto">
          <h2 className="border-b border-line px-4 py-3 font-semibold">My tickets</h2>
          <table className="w-full min-w-[520px] text-sm">
            <tbody>
              {tickets.data?.map((t) => (
                <tr key={t.id} className="border-b border-line/50 last:border-0">
                  <td className="px-4 py-3"><Link href={`/support/${t.id}`} className="font-medium hover:text-brand">{t.subject}</Link></td>
                  <td className="px-4 text-xs text-muted">{t.category}</td>
                  <td className="px-4"><StatusBadge status={t.status === 'ANSWERED' ? 'APPROVED' : t.status === 'CLOSED' ? 'CANCELED' : 'PENDING'} /> <span className="text-xs text-muted">{t.status.toLowerCase()}</span></td>
                  <td className="px-4 text-right text-xs text-muted">{fmtDateTime(t.updatedAt)}</td>
                </tr>
              ))}
              {!tickets.data?.length && <tr><td className="p-8 text-center text-muted">No tickets yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card h-fit space-y-3 p-5">
        <h2 className="font-semibold">Open a ticket</h2>
        <Field label="Category">
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Subject"><input className="input" maxLength={150} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Describe your issue"><textarea className="input min-h-[140px]" maxLength={5000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <p className="text-xs text-muted">Never share your password or 2FA codes with anyone, including support.</p>
        <button className="btn-brand w-full" disabled={f.subject.length < 3 || !f.body.trim()} onClick={submit}>Submit</button>
      </div>
    </div>
  );
}

export default function Page() {
  return <RequireAuth><Support /></RequireAuth>;
}
