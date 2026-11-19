'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { api, errMsg } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { fmtDateTime, fmtQty } from '@/lib/format';
import type { Asset, BalanceRow } from '@/lib/types';

interface Quote { id: string; from: string; to: string; fromAmount: string; toAmount: string; rate: string; inverseRate: string; expiresAt: number }

export default function ConvertPage() {
  const { user } = useAuth();
  const toast = useToast();
  const assets = useApi<Asset[]>('/api/wallet/assets');
  const bal = useApi<{ balances: BalanceRow[] }>(user ? '/api/wallet/balances' : null, { refreshOnUserEvent: true });
  const history = useApi<any[]>(user ? '/api/convert/history' : null);
  const [from, setFrom] = useState('USDT');
  const [to, setTo] = useState('BTC');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);

  const avail = +(bal.data?.balances.find((b) => b.asset === from)?.available ?? 0);
  const pFrom = assets.data?.find((a) => a.symbol === from)?.usdPrice ?? 0;
  const pTo = assets.data?.find((a) => a.symbol === to)?.usdPrice ?? 0;
  const estimate = useMemo(() => (pFrom && pTo && +amount ? (+amount * pFrom) / pTo : 0), [amount, pFrom, pTo]);

  useEffect(() => setQuote(null), [from, to, amount]);
  useEffect(() => {
    if (!quote) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) setQuote(null);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [quote]);

  const getQuote = async () => {
    setBusy(true);
    try {
      setQuote(await api<Quote>(`/api/convert/quote?from=${from}&to=${to}&amount=${amount}`));
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const accept = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      await api('/api/convert/accept', { method: 'POST', body: { quoteId: quote.id } });
      toast(`Converted ${fmtQty(quote.fromAmount, 8)} ${quote.from} → ${fmtQty(quote.toAmount, 8)} ${quote.to}`, 'success');
      setQuote(null);
      setAmount('');
      history.reload();
      bal.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
      setQuote(null);
    } finally {
      setBusy(false);
    }
  };

  const AssetSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select className="rounded-md border border-line bg-panel px-2 py-1.5 text-sm font-semibold outline-none" value={value} onChange={(e) => onChange(e.target.value)}>
      {assets.data?.map((a) => <option key={a.symbol} value={a.symbol}>{a.symbol}</option>)}
    </select>
  );

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold">Convert</h1>
        <p className="mt-1 text-sm text-muted">Swap instantly at a guaranteed rate. Zero trading fees — the rate includes a small spread.</p>
        <div className="card mt-6 space-y-2 p-5">
          <div className="rounded-lg bg-panel2 p-4">
            <div className="mb-2 flex justify-between text-xs text-muted">
              <span>From</span>
              {user && <button className="hover:text-fg" onClick={() => setAmount(String(avail))}>Available: <span className="num">{fmtQty(avail, 8)}</span> {from} · Max</button>}
            </div>
            <div className="flex items-center gap-2">
              <input className="num min-w-0 flex-1 bg-transparent text-2xl outline-none" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmount(e.target.value)} />
              <AssetSelect value={from} onChange={(v) => { if (v === to) setTo(from); setFrom(v); }} />
            </div>
          </div>
          <div className="flex justify-center">
            <button onClick={() => { setFrom(to); setTo(from); }} className="rounded-full border border-line bg-panel p-2 text-muted hover:text-fg" aria-label="Swap">⇅</button>
          </div>
          <div className="rounded-lg bg-panel2 p-4">
            <div className="mb-2 text-xs text-muted">To</div>
            <div className="flex items-center gap-2">
              <div className="num min-w-0 flex-1 truncate text-2xl">{quote ? fmtQty(quote.toAmount, 8) : estimate ? `≈ ${fmtQty(estimate, 8)}` : '0.00'}</div>
              <AssetSelect value={to} onChange={(v) => { if (v === from) setFrom(to); setTo(v); }} />
            </div>
          </div>
          {quote && (
            <div className="space-y-1 rounded-md border border-line p-3 text-xs">
              <div className="flex justify-between"><span className="text-muted">Rate</span><span className="num">1 {quote.from} = {fmtQty(quote.rate, 10)} {quote.to}</span></div>
              <div className="flex justify-between"><span className="text-muted">Inverse rate</span><span className="num">1 {quote.to} = {fmtQty(quote.inverseRate, 8)} {quote.from}</span></div>
              <div className="flex justify-between"><span className="text-muted">Transaction fee</span><span className="text-up">0</span></div>
            </div>
          )}
          {!user ? (
            <Link href="/login?next=/convert" className="btn-brand w-full">Log in to convert</Link>
          ) : quote ? (
            <button className="btn-brand w-full" onClick={accept} disabled={busy}>Convert ({left}s)</button>
          ) : (
            <button className="btn-brand w-full" onClick={getQuote} disabled={busy || !+amount || +amount > avail}>
              {+amount > avail ? `Insufficient ${from}` : 'Preview conversion'}
            </button>
          )}
        </div>
      </div>

      {user && (
        <div className="card mt-10 overflow-x-auto">
          <h2 className="flex items-center border-b border-line px-4 py-3 font-semibold">
            Convert history
            <a href="/api/export/converts" download className="ml-auto text-xs font-normal text-brand">Export CSV</a>
          </h2>
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-line">{['Date', 'From', 'To', 'Rate'].map((h) => <th key={h} className="table-head px-4 py-2">{h}</th>)}</tr></thead>
            <tbody>
              {history.data?.map((c) => (
                <tr key={c.id} className="border-b border-line/50 last:border-0">
                  <td className="num px-4 py-2 text-xs text-muted">{fmtDateTime(c.createdAt)}</td>
                  <td className="num px-4">{fmtQty(c.fromAmount, 8)} {c.fromAsset}</td>
                  <td className="num px-4">{fmtQty(c.toAmount, 8)} {c.toAsset}</td>
                  <td className="num px-4 text-xs text-muted">{fmtQty(c.price, 10)}</td>
                </tr>
              ))}
              {!history.data?.length && <tr><td colSpan={4} className="p-8 text-center text-muted">No conversions yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
