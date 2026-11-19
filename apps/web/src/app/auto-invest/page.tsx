'use client';
import { useState } from 'react';
import clsx from 'clsx';
import { RequireAuth } from '@/components/RequireAuth';
import { Field } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { api, errMsg } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmt, fmtDateTime, fmtPrice, fmtQty } from '@/lib/format';
import type { Asset } from '@/lib/types';

interface Plan {
  id: string; sourceAsset: string; targetAsset: string; amountPerRun: string; frequency: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  status: 'ACTIVE' | 'PAUSED'; nextRunAt: string; totalInvested: string; totalBought: string; runs: number; failedRuns: number; avgPrice: string | null;
  history: { id: string; ok: boolean; spent: string; bought: string; price: string | null; error: string | null; createdAt: string }[];
}

const FREQ: Record<Plan['frequency'], string> = { HOURLY: 'Every hour', DAILY: 'Every day', WEEKLY: 'Every week', MONTHLY: 'Every month' };
const FIAT = ['AED', 'INR', 'USD'];

function AutoInvest() {
  const toast = useToast();
  const assets = useApi<Asset[]>('/api/wallet/assets');
  const plans = useApi<Plan[]>('/api/auto-invest', { refreshOnUserEvent: true });
  const [f, setF] = useState({ sourceAsset: 'USDT', targetAsset: 'BTC', amountPerRun: '50', frequency: 'WEEKLY' as Plan['frequency'], startNow: true });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const crypto = (assets.data ?? []).filter((a) => !FIAT.includes(a.symbol) && a.symbol !== 'USDT');
  const sources = (assets.data ?? []).filter((a) => a.symbol === 'USDT' || FIAT.includes(a.symbol));
  const targetPrice = assets.data?.find((a) => a.symbol === f.targetAsset)?.usdPrice ?? 0;
  const sourcePrice = assets.data?.find((a) => a.symbol === f.sourceAsset)?.usdPrice ?? 0;
  const perMonth = { HOURLY: 720, DAILY: 30, WEEKLY: 4.33, MONTHLY: 1 }[f.frequency] * (+f.amountPerRun || 0);

  const create = async () => {
    setBusy(true);
    try {
      await api('/api/auto-invest', { method: 'POST', body: f });
      toast(`Plan created${f.startNow ? ' — first purchase done' : ''}`, 'success');
      plans.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const act = (fn: () => Promise<unknown>, ok: string) => fn().then(() => { toast(ok, 'success'); plans.reload(); }).catch((e) => toast(errMsg(e), 'error'));

  return (
    <div>
      <section className="bg-section px-6 py-16 text-center">
        <div className="eyebrow">Auto-Invest</div>
        <h1 className="headline mx-auto mt-3 max-w-3xl text-5xl sm:text-6xl">Buy a little. Automatically.</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted">Dollar-cost averaging smooths out volatility. Set an amount and a schedule — we&apos;ll buy for you, with no trading fee.</p>
      </section>

      <div className="mx-auto grid max-w-[1100px] gap-6 px-4 py-12 lg:grid-cols-[380px_1fr]">
        <div className="card h-fit space-y-4 p-6">
          <h2 className="text-lg font-semibold">New plan</h2>
          <Field label="Buy">
            <select className="input" value={f.targetAsset} onChange={(e) => setF({ ...f, targetAsset: e.target.value })}>
              {crypto.map((a) => <option key={a.symbol} value={a.symbol}>{a.symbol} — {a.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Field label="Amount each time">
              <input className="input num" inputMode="decimal" value={f.amountPerRun} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setF({ ...f, amountPerRun: e.target.value })} />
            </Field>
            <Field label="Pay with">
              <select className="input" value={f.sourceAsset} onChange={(e) => setF({ ...f, sourceAsset: e.target.value })}>
                {sources.map((a) => <option key={a.symbol}>{a.symbol}</option>)}
              </select>
            </Field>
          </div>
          <Field label="How often">
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-panel2 p-1">
              {(Object.keys(FREQ) as Plan['frequency'][]).map((k) => (
                <button key={k} onClick={() => setF({ ...f, frequency: k })} className={clsx('rounded-lg py-1.5 text-xs font-medium capitalize transition', f.frequency === k ? 'bg-panel text-fg shadow-sm' : 'text-muted')}>
                  {k.toLowerCase()}
                </button>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.startNow} onChange={(e) => setF({ ...f, startNow: e.target.checked })} /> Make the first purchase now</label>
          <div className="rounded-2xl bg-section p-4 text-sm">
            <div className="flex justify-between"><span className="text-muted">Per month</span><span className="num">≈ {fmt(perMonth, 2)} {f.sourceAsset}</span></div>
            {targetPrice > 0 && sourcePrice > 0 && +f.amountPerRun > 0 && (
              <div className="mt-1 flex justify-between"><span className="text-muted">Each buy at today&apos;s price</span><span className="num">≈ {fmtQty((+f.amountPerRun * sourcePrice) / targetPrice, 8)} {f.targetAsset}</span></div>
            )}
            <div className="mt-1 flex justify-between"><span className="text-muted">Fee</span><span className="text-up">0 (0.1% spread)</span></div>
          </div>
          <button className="btn-brand w-full" disabled={busy || !+f.amountPerRun} onClick={create}>Create plan</button>
        </div>

        <div className="space-y-4">
          <h2 className="headline text-2xl">My plans</h2>
          {plans.data?.map((p) => (
            <div key={p.id} className="card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <div className="text-lg font-semibold">{fmt(p.amountPerRun, 2)} {p.sourceAsset} → {p.targetAsset}</div>
                  <div className="text-xs text-muted">{FREQ[p.frequency]} · next {p.status === 'ACTIVE' ? fmtDateTime(p.nextRunAt) : '— paused'}</div>
                </div>
                <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-medium', p.status === 'ACTIVE' ? 'bg-up/10 text-up' : 'bg-panel2 text-muted')}>{p.status.toLowerCase()}</span>
                <div className="ml-auto flex gap-2">
                  <button className="btn-ghost py-1.5 text-xs" onClick={() => act(() => api(`/api/auto-invest/${p.id}`, { method: 'PATCH', body: { status: p.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' } }), p.status === 'ACTIVE' ? 'Paused' : 'Resumed')}>
                    {p.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                  </button>
                  <button className="btn-ghost py-1.5 text-xs text-down" onClick={() => confirm('End this plan? Your purchased coins stay in your wallet.') && act(() => api(`/api/auto-invest/${p.id}`, { method: 'DELETE' }), 'Plan ended')}>End</button>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><div className="text-xs text-muted">Invested</div><div className="num">{fmt(p.totalInvested, 2)} {p.sourceAsset}</div></div>
                <div><div className="text-xs text-muted">Bought</div><div className="num">{fmtQty(p.totalBought, 8)} {p.targetAsset}</div></div>
                <div><div className="text-xs text-muted">Avg. price</div><div className="num">{p.avgPrice ? `${fmtPrice(p.avgPrice)} ${p.sourceAsset}` : '—'}</div></div>
                <div><div className="text-xs text-muted">Purchases</div><div className="num">{p.runs}{p.failedRuns > 0 && <span className="text-down"> · {p.failedRuns} failed</span>}</div></div>
              </div>
              {p.history.length > 0 && (
                <button className="mt-3 text-xs text-brand" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Hide history' : 'Show history'}</button>
              )}
              {open === p.id && (
                <ul className="mt-2 divide-y divide-line/60 text-xs">
                  {p.history.map((h) => (
                    <li key={h.id} className="flex gap-3 py-1.5">
                      <span className="num w-36 shrink-0 text-muted">{fmtDateTime(h.createdAt)}</span>
                      {h.ok ? <span className="num">Bought {fmtQty(h.bought, 8)} {p.targetAsset} for {fmt(h.spent, 2)} {p.sourceAsset}</span> : <span className="text-down">Skipped: {h.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {!plans.data?.length && <div className="card p-10 text-center text-muted">{plans.loading ? 'Loading…' : 'No plans yet. Create your first one.'}</div>}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <RequireAuth><AutoInvest /></RequireAuth>;
}
