'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { api, errMsg } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, StatusBadge } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { fmt, fmtDateTime, fmtQty } from '@/lib/format';
import type { BalanceRow } from '@/lib/types';

interface Product { id: string; asset: string; type: 'FLEXIBLE' | 'LOCKED'; durationDays: number; apr: string; minAmount: string; capacity: string | null; subscribed: string; usdPrice: number }
interface Position { id: string; amount: string; apr: string; status: 'ACTIVE' | 'REDEEMED'; earned: string; pending: string; maturesAt: string | null; createdAt: string; redeemedAt: string | null; usdPrice: number; product: Product }

const pct = (apr: string | number) => `${(+apr * 100).toFixed(2).replace(/\.00$/, '')}%`;

export default function EarnPage() {
  const { user } = useAuth();
  const toast = useToast();
  const products = useApi<Product[]>('/api/earn/products');
  const positions = useApi<Position[]>(user ? '/api/earn/positions' : null, { refreshOnUserEvent: true });
  const bal = useApi<{ balances: BalanceRow[] }>(user ? '/api/wallet/balances' : null, { refreshOnUserEvent: true });
  const [pick, setPick] = useState<Product | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'FLEXIBLE' | 'LOCKED'>('ALL');

  const byAsset = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of products.data ?? []) if (filter === 'ALL' || p.type === filter) m.set(p.asset, [...(m.get(p.asset) ?? []), p]);
    return [...m.entries()];
  }, [products.data, filter]);

  const active = (positions.data ?? []).filter((p) => p.status === 'ACTIVE');
  const totalUsd = active.reduce((s, p) => s + +p.amount * p.usdPrice, 0);
  const earnedUsd = (positions.data ?? []).reduce((s, p) => s + (+p.earned + +p.pending) * p.usdPrice, 0);
  const avail = pick ? +(bal.data?.balances.find((b) => b.asset === pick.asset)?.available ?? 0) : 0;
  const estYear = pick && +amount ? +amount * +pick.apr : 0;

  const subscribe = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await api('/api/earn/subscribe', { method: 'POST', body: { productId: pick.id, amount } });
      toast(`Subscribed ${amount} ${pick.asset} at ${pct(pick.apr)} APR`, 'success');
      setPick(null);
      setAmount('');
      positions.reload();
      products.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const redeem = async (id: string) => {
    try {
      await api(`/api/earn/positions/${id}/redeem`, { method: 'POST' });
      toast('Redeemed to your wallet', 'success');
      positions.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <div>
      <section className="bg-section px-6 py-16 text-center">
        <div className="eyebrow">Simple Earn</div>
        <h1 className="headline mx-auto mt-3 max-w-3xl text-5xl sm:text-6xl">Let your crypto work for you.</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted">Flexible products you can redeem any time, or locked terms for a higher rate. Interest is paid automatically.</p>
        {user && (
          <div className="mx-auto mt-10 grid max-w-xl grid-cols-2 gap-4">
            <div className="rounded-3xl bg-panel p-6"><div className="text-xs text-muted">In Earn</div><div className="num headline mt-1 text-3xl">${fmt(totalUsd, 2)}</div></div>
            <div className="rounded-3xl bg-panel p-6"><div className="text-xs text-muted">Total earned</div><div className="num headline mt-1 text-3xl text-up">${fmt(earnedUsd, 4)}</div></div>
          </div>
        )}
      </section>

      <div className="mx-auto max-w-[1100px] space-y-8 px-4 py-12">
        <div className="flex items-center gap-3">
          <h2 className="headline text-2xl">Products</h2>
          <div className="ml-auto flex gap-1 rounded-full bg-panel2 p-1 text-xs">
            {(['ALL', 'FLEXIBLE', 'LOCKED'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={clsx('rounded-full px-3 py-1 font-medium capitalize transition', filter === f ? 'bg-panel text-fg shadow-sm' : 'text-muted hover:text-fg')}>{f.toLowerCase()}</button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {byAsset.map(([asset, list]) => (
            <div key={asset} className="card p-6">
              <div className="flex items-baseline justify-between">
                <h3 className="text-xl font-semibold">{asset}</h3>
                <span className="text-xs text-muted">up to <b className="num text-lg text-up">{pct(Math.max(...list.map((p) => +p.apr)))}</b> APR</span>
              </div>
              <div className="mt-4 space-y-2">
                {list.map((p) => {
                  const full = p.capacity && +p.subscribed >= +p.capacity;
                  return (
                    <button
                      key={p.id}
                      disabled={!!full}
                      onClick={() => (user ? (setPick(p), setAmount('')) : (window.location.href = '/login?next=/earn'))}
                      className="flex w-full items-center justify-between rounded-2xl bg-panel2 px-4 py-3 text-left text-sm transition hover:ring-2 hover:ring-brand/30 disabled:opacity-50"
                    >
                      <span>{p.type === 'FLEXIBLE' ? 'Flexible' : `${p.durationDays}-day locked`}</span>
                      <span className="num font-semibold text-up">{pct(p.apr)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!byAsset.length && <p className="text-muted">{products.loading ? 'Loading…' : 'No products available.'}</p>}
        </div>

        {user && (
          <div className="card overflow-x-auto">
            <h2 className="border-b border-line px-5 py-4 font-semibold">My positions</h2>
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-line">{['Product', 'Amount', 'APR', 'Interest earned', 'Accruing now', 'Ends', 'Status', ''].map((h) => <th key={h} className="table-head px-5 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {positions.data?.map((p) => (
                  <tr key={p.id} className="border-b border-line/50 last:border-0">
                    <td className="px-5 py-3 font-medium">{p.product.asset} <span className="text-xs text-muted">{p.product.type === 'FLEXIBLE' ? 'Flexible' : `${p.product.durationDays}d locked`}</span></td>
                    <td className="num px-5">{fmtQty(p.amount, 8)}</td>
                    <td className="num px-5 text-up">{pct(p.apr)}</td>
                    <td className="num px-5">{fmtQty(p.earned, 8)}</td>
                    <td className="num px-5 text-muted">{p.status === 'ACTIVE' ? `+${fmtQty(p.pending, 8)}` : '—'}</td>
                    <td className="px-5 text-xs text-muted">{p.maturesAt ? fmtDateTime(p.maturesAt) : 'Any time'}</td>
                    <td className="px-5"><StatusBadge status={p.status === 'ACTIVE' ? 'OPEN' : 'COMPLETED'} /></td>
                    <td className="px-5 text-right">
                      {p.status === 'ACTIVE' && p.product.type === 'FLEXIBLE' && <button className="text-brand hover:underline" onClick={() => redeem(p.id)}>Redeem</button>}
                    </td>
                  </tr>
                ))}
                {!positions.data?.length && <tr><td colSpan={8} className="p-10 text-center text-muted">No positions yet — pick a product above.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">APR is variable for flexible products and fixed at subscription for locked products. Flexible interest is paid out regularly; locked principal and interest are returned automatically at maturity. Past rates don&apos;t guarantee future returns.</p>
      </div>

      <Modal open={!!pick} onClose={() => setPick(null)} title={pick ? `${pick.asset} · ${pick.type === 'FLEXIBLE' ? 'Flexible' : `${pick.durationDays}-day locked`}` : ''}>
        {pick && (
          <div className="space-y-4 text-sm">
            <div className="rounded-2xl bg-section p-4 text-center">
              <div className="text-xs text-muted">Annual percentage rate</div>
              <div className="num headline text-4xl text-up">{pct(pick.apr)}</div>
            </div>
            <Field label={`Amount (${pick.asset})`} hint={`Available ${fmtQty(avail, 8)} · Minimum ${fmtQty(pick.minAmount, 8)}`}>
              <div className="flex gap-2">
                <input className="input num" inputMode="decimal" autoFocus value={amount} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmount(e.target.value)} />
                <button className="btn-ghost shrink-0" onClick={() => setAmount(String(avail))}>Max</button>
              </div>
            </Field>
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between"><dt className="text-muted">Est. yearly interest</dt><dd className="num">{fmtQty(estYear, 8)} {pick.asset}</dd></div>
              {pick.type === 'LOCKED' && <div className="flex justify-between"><dt className="text-muted">Est. interest at maturity</dt><dd className="num text-up">{fmtQty((estYear * pick.durationDays) / 365, 8)} {pick.asset}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">Redemption</dt><dd>{pick.type === 'FLEXIBLE' ? 'Any time, instantly' : `Automatic after ${pick.durationDays} days`}</dd></div>
            </dl>
            {!+avail && <p className="text-xs text-muted">No {pick.asset} available. <Link className="text-brand" href="/convert">Convert</Link> or <Link className="text-brand" href="/wallet">deposit</Link> first.</p>}
            <button className="btn-brand w-full" disabled={busy || !+amount || +amount > avail} onClick={subscribe}>Subscribe</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
