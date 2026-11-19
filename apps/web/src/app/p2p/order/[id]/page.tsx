'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { RequireAuth } from '@/components/RequireAuth';
import { StatusBadge } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { api, errMsg } from '@/lib/api';
import { useApi, useUserEvents } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { fmt, fmtQty, fmtTime } from '@/lib/format';

interface Msg { id: string; senderId: string | null; system: boolean; body: string; createdAt: string }
interface OrderDetail {
  id: string; role: 'BUYER' | 'SELLER' | 'ADMIN'; status: string; asset: string; fiat: string; price: string; amount: string; fiatAmount: string;
  expiresAt: string; paidAt: string | null; buyerName: string; sellerName: string; terms: string | null; paymentTypes: string[];
  sellerPaymentMethods: { id: string; type: string; label: string; details: Record<string, string> }[]; messages: Msg[]; disputeReason: string | null;
}

const STEPS = ['PENDING_PAYMENT', 'PAID', 'COMPLETED'];

function Countdown({ until }: { until: string }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, new Date(until).getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [until]);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return <span className="num font-semibold text-brand">{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>;
}

function OrderView({ id }: { id: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const o = useApi<OrderDetail>(`/api/p2p/orders/${id}`);
  const [msg, setMsg] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  useUserEvents((ev) => ev.type === 'p2p' && ev.orderId === id && o.reload());
  useEffect(() => {
    const t = setInterval(o.reload, 10000);
    return () => clearInterval(t);
  }, [o.reload]); // eslint-disable-line
  useEffect(() => chatEnd.current?.scrollIntoView({ block: 'nearest' }), [o.data?.messages.length]);

  const act = async (path: string, body?: unknown, ok?: string) => {
    setBusy(true);
    try {
      await api(`/api/p2p/orders/${id}/${path}`, { method: 'POST', body: body ?? {} });
      if (ok) toast(ok, 'success');
      o.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msg.trim()) return;
    await act('messages', { body: msg });
    setMsg('');
  };

  if (!o.data) return <div className="p-10 text-center text-muted">{o.error ?? 'Loading…'}</div>;
  const d = o.data;
  const isBuyer = d.role === 'BUYER';
  const step = d.status === 'DISPUTED' ? 1 : STEPS.indexOf(d.status);
  const counterparty = isBuyer ? d.sellerName : d.buyerName;

  return (
    <div className="mx-auto grid max-w-[1200px] gap-4 px-4 py-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold">{isBuyer ? 'Buy' : 'Sell'} {d.asset}</h1>
            <StatusBadge status={d.status} />
            <span className="num ml-auto text-xs text-muted">Order #{d.id.slice(-10)}</span>
          </div>
          {d.status === 'PENDING_PAYMENT' && (
            <p className="mt-2 text-sm">
              {isBuyer ? 'Pay the seller within ' : 'Waiting for the buyer to pay. Time left: '}
              <Countdown until={d.expiresAt} />
            </p>
          )}
          <ol className="mt-5 grid grid-cols-3 gap-2 text-xs">
            {['Pay', 'Confirm & release', 'Completed'].map((label, i) => (
              <li key={label} className={clsx('rounded-md border px-3 py-2', i <= step && d.status !== 'CANCELED' ? 'border-brand text-fg' : 'border-line text-muted')}>
                {i + 1}. {label}
              </li>
            ))}
          </ol>
          <div className="mt-5 grid grid-cols-3 gap-4 text-sm">
            <div><div className="text-xs text-muted">Fiat amount</div><div className="num text-lg font-semibold text-up">{d.fiat === 'INR' ? '₹' : 'AED '}{fmt(d.fiatAmount, 2)}</div></div>
            <div><div className="text-xs text-muted">Price</div><div className="num">{d.fiat === 'INR' ? '₹' : 'AED '}{fmt(d.price, 2)}</div></div>
            <div><div className="text-xs text-muted">Crypto</div><div className="num">{fmtQty(d.amount, 8)} {d.asset}</div></div>
          </div>
        </div>

        {d.sellerPaymentMethods.length > 0 && (
          <div className="card p-5">
            <h2 className="mb-3 font-semibold">{isBuyer ? `Pay ${d.sellerName} using one of these methods` : 'Your payment methods shown to the buyer'}</h2>
            <div className="space-y-2">
              {d.sellerPaymentMethods.map((m) => (
                <div key={m.id} className="rounded-md border border-line p-3 text-sm">
                  <span className="mr-2 rounded bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">{m.type}</span>
                  <span className="font-medium">{m.label}</span>
                  <dl className="mt-2 grid grid-cols-[120px_1fr] gap-1 text-xs">
                    {Object.entries(m.details).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
                        <dd className="num flex items-center gap-2">{v}<button className="text-brand" onClick={() => navigator.clipboard?.writeText(String(v)).then(() => toast('Copied', 'success'))}>copy</button></dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
            {isBuyer && <p className="mt-3 text-xs text-down">Pay from an account in your own name. Don't write crypto-related words in the payment note.</p>}
          </div>
        )}

        {d.terms && <div className="card p-4 text-sm"><b>Terms:</b> <span className="text-muted">{d.terms}</span></div>}

        <div className="card flex flex-wrap gap-2 p-4">
          {isBuyer && d.status === 'PENDING_PAYMENT' && (
            <button className="btn-up" disabled={busy} onClick={() => confirm('Only confirm after you have actually sent the payment. Continue?') && act('paid', undefined, 'Marked as paid')}>I have paid, notify seller</button>
          )}
          {!isBuyer && d.status === 'PAID' && (
            <>
              {user?.totpEnabled && <input className="input num w-32" placeholder="2FA code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
              <button className="btn-up" disabled={busy} onClick={() => confirm(`Confirm you received ${d.fiatAmount} ${d.fiat} in your account. This releases ${d.amount} ${d.asset} and cannot be undone.`) && act('release', { code: code || undefined }, 'Crypto released')}>
                Payment received, release {d.asset}
              </button>
            </>
          )}
          {isBuyer && ['PENDING_PAYMENT', 'PAID'].includes(d.status) && (
            <button className="btn-ghost" disabled={busy} onClick={() => confirm('Cancel this order? Do not cancel if you have already paid.') && act('cancel', {}, 'Order canceled')}>Cancel order</button>
          )}
          {d.status === 'PAID' && (
            <button className="btn-ghost text-down" disabled={busy} onClick={() => { const r = prompt('Describe the problem (min 5 characters)'); if (r) act('dispute', { reason: r }, 'Dispute opened'); }}>Open dispute</button>
          )}
          {d.status === 'DISPUTED' && <p className="text-sm text-muted">Under review by support{d.disputeReason ? `: ${d.disputeReason}` : ''}. Please share payment proof in the chat.</p>}
          {d.status === 'COMPLETED' && <p className="text-sm text-up">Order completed. {isBuyer ? `${d.amount} ${d.asset} has been credited to your wallet.` : 'Funds released.'}</p>}
          {d.status === 'CANCELED' && <p className="text-sm text-muted">This order was canceled. Escrowed crypto has been returned.</p>}
          <Link href="/p2p" className="ml-auto self-center text-sm text-brand">Back to P2P</Link>
        </div>
      </div>

      <div className="card flex h-[600px] flex-col">
        <div className="border-b border-line px-4 py-3">
          <div className="font-semibold">{counterparty}</div>
          <div className="text-xs text-muted">Chat with the {isBuyer ? 'seller' : 'buyer'}. Keep all communication here.</div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {d.messages.map((m) =>
            m.system ? (
              <div key={m.id} className="rounded-md bg-panel2 px-3 py-2 text-center text-xs text-muted">{m.body}</div>
            ) : (
              <div key={m.id} className={clsx('flex', m.senderId === user?.id ? 'justify-end' : 'justify-start')}>
                <div className={clsx('max-w-[80%] rounded-lg px-3 py-2 text-sm', m.senderId === user?.id ? 'bg-brand text-white' : 'bg-panel2')}>
                  {m.body}
                  <div className="mt-0.5 text-right text-[10px] opacity-70">{fmtTime(m.createdAt)}</div>
                </div>
              </div>
            ),
          )}
          <div ref={chatEnd} />
        </div>
        {!['COMPLETED', 'CANCELED'].includes(d.status) && (
          <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
            <input className="input" placeholder="Type a message" maxLength={1000} value={msg} onChange={(e) => setMsg(e.target.value)} />
            <button className="btn-brand" disabled={busy || !msg.trim()}>Send</button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function Page({ params }: { params: { id: string } }) {
  return (
    <RequireAuth>
      <OrderView id={params.id} />
    </RequireAuth>
  );
}
