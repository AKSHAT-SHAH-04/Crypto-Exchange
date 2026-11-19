'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { api, errMsg } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, StatusBadge } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { fmt, fmtDateTime, fmtQty } from '@/lib/format';

type Tab = 'market' | 'orders' | 'ads' | 'methods';
const PAYMENT_TYPES = ['UPI', 'IMPS', 'BANK', 'PAYTM'] as const;
const P2P_ASSETS = ['USDT', 'BTC', 'ETH'];

interface Ad {
  id: string; side: 'BUY' | 'SELL'; asset: string; fiat: string; price: string; remaining: string; totalAmount: string; minFiat: string; maxFiat: string;
  effectiveMaxFiat: string; paymentTypes: string[]; terms: string | null; payWindowMin: number; status: string;
  advertiser: { id: string; name: string; completed: number; rate: number };
}

function Market() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [asset, setAsset] = useState('USDT');
  const [payment, setPayment] = useState('');
  const [amount, setAmount] = useState('');
  const q = new URLSearchParams({ side, asset, ...(payment ? { payment } : {}), ...(+amount ? { amount } : {}) });
  const ads = useApi<Ad[]>(`/api/p2p/ads?${q}`);
  const [pick, setPick] = useState<Ad | null>(null);
  const [fiat, setFiat] = useState('');
  const [busy, setBusy] = useState(false);

  const open = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      const o = await api<{ id: string }>('/api/p2p/orders', { method: 'POST', body: { adId: pick.id, fiatAmount: fiat } });
      router.push(`/p2p/order/${o.id}`);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-panel2 p-1">
          <button onClick={() => setSide('BUY')} className={clsx('rounded px-5 py-1.5 text-sm font-semibold', side === 'BUY' ? 'bg-up text-white' : 'text-muted')}>Buy</button>
          <button onClick={() => setSide('SELL')} className={clsx('rounded px-5 py-1.5 text-sm font-semibold', side === 'SELL' ? 'bg-down text-white' : 'text-muted')}>Sell</button>
        </div>
        <div className="flex gap-1">
          {P2P_ASSETS.map((a) => (
            <button key={a} onClick={() => setAsset(a)} className={clsx('rounded px-3 py-1.5 text-sm font-medium', asset === a ? 'text-brand' : 'text-muted hover:text-fg')}>{a}</button>
          ))}
        </div>
        <input className="input w-40" placeholder="Amount (INR)" inputMode="decimal" value={amount} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmount(e.target.value)} />
        <select className="input w-40" value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="">All payments</option>
          {PAYMENT_TYPES.map((p) => <option key={p}>{p}</option>)}
        </select>
        <button className="btn-ghost ml-auto" onClick={ads.reload}>Refresh</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line">
              {['Advertiser', 'Price', 'Available / Limits', 'Payment', ''].map((h) => <th key={h} className="table-head px-4 py-2">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {ads.data?.map((a) => (
              <tr key={a.id} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/20 text-xs font-bold text-brand">{a.advertiser.name[0]?.toUpperCase()}</span>
                    <div>
                      <div className="font-medium">{a.advertiser.name}</div>
                      <div className="text-xs text-muted">{a.advertiser.completed} orders · {a.advertiser.rate}% completion</div>
                    </div>
                  </div>
                </td>
                <td className="num px-4 text-lg font-semibold">₹{fmt(a.price, 2)}</td>
                <td className="px-4 text-xs">
                  <div className="num">{fmtQty(a.remaining, 6)} {a.asset}</div>
                  <div className="num text-muted">₹{fmt(a.minFiat, 0)} – ₹{fmt(a.effectiveMaxFiat, 0)}</div>
                </td>
                <td className="px-4">
                  <div className="flex flex-wrap gap-1">{a.paymentTypes.map((p) => <span key={p} className="rounded border border-line px-1.5 py-0.5 text-[11px]">{p}</span>)}</div>
                </td>
                <td className="px-4 text-right">
                  {user?.id === a.advertiser.id ? (
                    <span className="text-xs text-muted">Your ad</span>
                  ) : (
                    <button className={side === 'BUY' ? 'btn-up py-1.5' : 'btn-down py-1.5'} onClick={() => { if (!user) return router.push('/login?next=/p2p'); setPick(a); setFiat(''); }}>
                      {side === 'BUY' ? 'Buy' : 'Sell'} {a.asset}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!ads.data?.length && <tr><td colSpan={5} className="p-10 text-center text-muted">{ads.loading ? 'Loading…' : 'No ads match your filters'}</td></tr>}
          </tbody>
        </table>
      </div>
      <Modal open={!!pick} onClose={() => setPick(null)} title={pick ? `${side === 'BUY' ? 'Buy' : 'Sell'} ${pick.asset} from ${pick.advertiser.name}` : ''}>
        {pick && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted">Price</span><span className="num font-semibold">₹{fmt(pick.price, 2)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Payment window</span><span>{pick.payWindowMin} min</span></div>
            <Field label={`I want to ${side === 'BUY' ? 'pay' : 'receive'} (INR)`} hint={`Limits ₹${fmt(pick.minFiat, 0)} – ₹${fmt(pick.effectiveMaxFiat, 0)}`}>
              <input className="input num" inputMode="decimal" autoFocus value={fiat} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setFiat(e.target.value)} />
            </Field>
            <div className="flex justify-between"><span className="text-muted">I will {side === 'BUY' ? 'receive' : 'sell'}</span><span className="num">{+fiat ? fmtQty(+fiat / +pick.price, 8) : '0'} {pick.asset}</span></div>
            {pick.terms && <div className="rounded-md bg-panel2 p-3 text-xs text-muted"><b className="text-fg">Advertiser terms:</b> {pick.terms}</div>}
            {side === 'SELL' && <p className="text-xs text-muted">Your {pick.asset} will be held in escrow until you confirm the buyer's payment.</p>}
            <button className={clsx('w-full', side === 'BUY' ? 'btn-up' : 'btn-down')} disabled={busy || !+fiat} onClick={open}>
              {side === 'BUY' ? 'Buy' : 'Sell'} {pick.asset}
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function MyOrders() {
  const orders = useApi<any[]>('/api/p2p/orders', { refreshOnUserEvent: true });
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[700px] text-sm">
        <thead><tr className="border-b border-line">{['Date', 'Type', 'Amount', 'Price', 'Fiat', 'Status', ''].map((h) => <th key={h} className="table-head px-4 py-2">{h}</th>)}</tr></thead>
        <tbody>
          {orders.data?.map((o) => (
            <tr key={o.id} className="border-b border-line/50 last:border-0">
              <td className="num px-4 py-2 text-xs text-muted">{fmtDateTime(o.createdAt)}</td>
              <td className={clsx('px-4 font-medium', o.role === 'BUYER' ? 'text-up' : 'text-down')}>{o.role === 'BUYER' ? 'Buy' : 'Sell'} {o.asset}</td>
              <td className="num px-4">{fmtQty(o.amount, 8)}</td>
              <td className="num px-4">₹{fmt(o.price, 2)}</td>
              <td className="num px-4">₹{fmt(o.fiatAmount, 2)}</td>
              <td className="px-4"><StatusBadge status={o.status} /></td>
              <td className="px-4 text-right"><Link className="text-brand hover:underline" href={`/p2p/order/${o.id}`}>View</Link></td>
            </tr>
          ))}
          {!orders.data?.length && <tr><td colSpan={7} className="p-10 text-center text-muted">No P2P orders yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function MyAds() {
  const toast = useToast();
  const ads = useApi<any[]>('/api/p2p/my-ads', { refreshOnUserEvent: true });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ side: 'SELL', asset: 'USDT', price: '', totalAmount: '', minFiat: '500', maxFiat: '50000', paymentTypes: ['UPI'] as string[], terms: '', payWindowMin: '15' });
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, 'success');
      ads.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  return (
    <div className="space-y-3">
      <button className="btn-brand" onClick={() => setOpen(true)}>+ Post new ad</button>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-line">{['Type', 'Price', 'Remaining / Total', 'Limits', 'Payment', 'Status', ''].map((h) => <th key={h} className="table-head px-4 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {ads.data?.map((a) => (
              <tr key={a.id} className="border-b border-line/50 last:border-0">
                <td className={clsx('px-4 py-2 font-medium', a.side === 'BUY' ? 'text-up' : 'text-down')}>{a.side === 'BUY' ? 'Buy' : 'Sell'} {a.asset}</td>
                <td className="num px-4">₹{fmt(a.price, 2)}</td>
                <td className="num px-4 text-xs">{fmtQty(a.remaining, 6)} / {fmtQty(a.totalAmount, 6)}</td>
                <td className="num px-4 text-xs">₹{fmt(a.minFiat, 0)} – ₹{fmt(a.maxFiat, 0)}</td>
                <td className="px-4 text-xs">{a.paymentTypes.join(', ')}</td>
                <td className="px-4"><StatusBadge status={a.status === 'ONLINE' ? 'APPROVED' : 'PENDING'} /> <span className="text-xs text-muted">{a.status.toLowerCase()}</span></td>
                <td className="whitespace-nowrap px-4 text-right text-xs">
                  <button className="mr-3 text-brand" onClick={() => act(() => api(`/api/p2p/ads/${a.id}`, { method: 'PATCH', body: { status: a.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE' } }), 'Ad updated')}>
                    {a.status === 'ONLINE' ? 'Take offline' : 'Go online'}
                  </button>
                  <button className="text-down" onClick={() => act(() => api(`/api/p2p/ads/${a.id}`, { method: 'DELETE' }), 'Ad closed and escrow refunded')}>Close</button>
                </td>
              </tr>
            ))}
            {!ads.data?.length && <tr><td colSpan={7} className="p-10 text-center text-muted">You have no active ads</td></tr>}
          </tbody>
        </table>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Post a P2P ad" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="I want to">
            <select className="input" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}>
              <option value="SELL">Sell crypto (receive INR)</option>
              <option value="BUY">Buy crypto (pay INR)</option>
            </select>
          </Field>
          <Field label="Asset">
            <select className="input" value={f.asset} onChange={(e) => setF({ ...f, asset: e.target.value })}>{P2P_ASSETS.map((a) => <option key={a}>{a}</option>)}</select>
          </Field>
          <Field label="Price per unit (INR)"><input className="input num" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label={`Total amount (${f.asset})`} hint={f.side === 'SELL' ? 'This amount is escrowed from your wallet now.' : undefined}>
            <input className="input num" value={f.totalAmount} onChange={(e) => setF({ ...f, totalAmount: e.target.value })} />
          </Field>
          <Field label="Min order (INR)"><input className="input num" value={f.minFiat} onChange={(e) => setF({ ...f, minFiat: e.target.value })} /></Field>
          <Field label="Max order (INR)"><input className="input num" value={f.maxFiat} onChange={(e) => setF({ ...f, maxFiat: e.target.value })} /></Field>
          <Field label="Payment methods">
            <div className="flex flex-wrap gap-2 pt-1">
              {PAYMENT_TYPES.map((p) => (
                <label key={p} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={f.paymentTypes.includes(p)} onChange={(e) => setF({ ...f, paymentTypes: e.target.checked ? [...f.paymentTypes, p] : f.paymentTypes.filter((x) => x !== p) })} /> {p}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Payment window">
            <select className="input" value={f.payWindowMin} onChange={(e) => setF({ ...f, payWindowMin: e.target.value })}>{['15', '30', '45', '60'].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Terms (optional)"><textarea className="input min-h-[70px]" maxLength={1000} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></Field>
          </div>
        </div>
        <button className="btn-brand mt-4 w-full" onClick={() => act(async () => { await api('/api/p2p/ads', { method: 'POST', body: { ...f, terms: f.terms || undefined } }); setOpen(false); }, 'Ad posted')}>Post ad</button>
      </Modal>
    </div>
  );
}

function PaymentMethods() {
  const toast = useToast();
  const methods = useApi<any[]>('/api/p2p/payment-methods');
  const [type, setType] = useState<(typeof PAYMENT_TYPES)[number]>('UPI');
  const [label, setLabel] = useState('');
  const [d, setD] = useState<Record<string, string>>({});
  const fields: Record<string, [string, string][]> = {
    UPI: [['upiId', 'UPI ID (e.g. name@okaxis)'], ['name', 'Account holder name']],
    PAYTM: [['phone', 'Paytm phone number'], ['name', 'Account holder name']],
    BANK: [['name', 'Account holder name'], ['accountNumber', 'Account number'], ['ifsc', 'IFSC'], ['bank', 'Bank name']],
    IMPS: [['name', 'Account holder name'], ['accountNumber', 'Account number'], ['ifsc', 'IFSC'], ['bank', 'Bank name']],
  };
  const add = async () => {
    try {
      await api('/api/p2p/payment-methods', { method: 'POST', body: { type, label: label || type, details: d } });
      toast('Payment method added', 'success');
      setD({});
      setLabel('');
      methods.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-2">
        {methods.data?.map((m) => (
          <div key={m.id} className="card flex items-start gap-3 p-4 text-sm">
            <span className="rounded bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">{m.type}</span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{m.label}</div>
              <div className="num truncate text-xs text-muted">{Object.values(m.details).join(' · ')}</div>
            </div>
            <button className="text-xs text-down" onClick={() => api(`/api/p2p/payment-methods/${m.id}`, { method: 'DELETE' }).then(methods.reload)}>Remove</button>
          </div>
        ))}
        {!methods.data?.length && <div className="card p-8 text-center text-sm text-muted">Add a payment method so buyers can pay you.</div>}
      </div>
      <div className="card space-y-3 p-4">
        <h3 className="font-semibold">Add payment method</h3>
        <select className="input" value={type} onChange={(e) => { setType(e.target.value as any); setD({}); }}>{PAYMENT_TYPES.map((p) => <option key={p}>{p}</option>)}</select>
        <input className="input" placeholder="Label (e.g. GPay)" value={label} onChange={(e) => setLabel(e.target.value)} />
        {fields[type].map(([k, ph]) => (
          <input key={k} className="input" placeholder={ph} value={d[k] ?? ''} onChange={(e) => setD({ ...d, [k]: k === 'ifsc' ? e.target.value.toUpperCase() : e.target.value })} />
        ))}
        <p className="text-xs text-muted">The name must match your verified identity.</p>
        <button className="btn-brand w-full" onClick={add}>Save</button>
      </div>
    </div>
  );
}

export default function P2PPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('market');
  const tabs: { id: Tab; label: string; auth?: boolean }[] = [
    { id: 'market', label: 'Express & marketplace' },
    { id: 'orders', label: 'My orders', auth: true },
    { id: 'ads', label: 'My ads', auth: true },
    { id: 'methods', label: 'Payment methods', auth: true },
  ];
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold">P2P trading</h1>
          <p className="mt-1 text-sm text-muted">Buy and sell crypto directly with other users using UPI, IMPS or bank transfer. Crypto is held in escrow until payment is confirmed.</p>
        </div>
        {user && user.kycStatus !== 'APPROVED' && (
          <Link href="/account?tab=kyc" className="ml-auto rounded-md bg-brand/10 px-3 py-2 text-sm text-brand">Complete KYC to trade P2P →</Link>
        )}
      </div>
      <div className="mb-4 flex overflow-x-auto border-b border-line">
        {tabs.filter((t) => !t.auth || user).map((t) => (
          <button key={t.id} className={clsx('tab', tab === t.id && 'tab-active')} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'market' && <Market />}
      {tab === 'orders' && user && <MyOrders />}
      {tab === 'ads' && user && <MyAds />}
      {tab === 'methods' && user && <PaymentMethods />}
    </div>
  );
}
