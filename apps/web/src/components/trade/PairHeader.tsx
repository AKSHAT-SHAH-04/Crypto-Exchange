'use client';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Market, Ticker } from '@/lib/types';
import { fmtCompact, fmtPct, fmtPrice } from '@/lib/format';
import { useFavorites } from '@/components/MarketTable';
import { AlertButton } from './AlertButton';

export function PairHeader({ market, ticker, markets, tickers }: { market: Market; ticker?: Ticker; markets: Market[]; tickers: Record<string, Ticker> }) {
  const up = (ticker?.changePct ?? 0) >= 0;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { favs, toggle } = useFavorites();

  // Close on outside click / Escape; focus search when opened.
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => { if (!open) setQ(''); }, [open]);

  const query = q.trim().toUpperCase();
  const list = markets
    .filter((m) => !query || m.symbol.includes(query) || m.base.includes(query))
    .sort((a, b) => Number(favs.includes(b.symbol)) - Number(favs.includes(a.symbol)));

  const stat = (label: string, value: React.ReactNode, cls = '') => (
    <div className="shrink-0">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={clsx('num text-xs', cls)}>{value}</div>
    </div>
  );

  return (
    // The dropdown must live OUTSIDE the horizontally-scrolling bar, otherwise overflow clips it.
    <div ref={rootRef} className="relative z-30">
      <div className="card flex items-center gap-6 overflow-x-auto px-4 py-2.5">
        <button onClick={() => toggle(market.symbol)} className={favs.includes(market.symbol) ? 'text-brand' : 'text-muted'} aria-label="Favorite">
          {favs.includes(market.symbol) ? '★' : '☆'}
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1 rounded-lg px-1 text-lg font-bold hover:bg-panel2"
        >
          {market.base}<span className="text-muted">/{market.quote}</span>
          <span className={clsx('text-xs text-muted transition-transform', open && 'rotate-180')}>▾</span>
        </button>
        <div className="shrink-0">
          <div className={clsx('num text-lg font-semibold', up ? 'text-up' : 'text-down')}>{fmtPrice(ticker?.price, market.pricePrecision)}</div>
        </div>
        {stat('24h change', `${fmtPrice(ticker?.change, market.pricePrecision)} ${fmtPct(ticker?.changePct ?? 0)}`, up ? 'text-up' : 'text-down')}
        {stat('24h high', fmtPrice(ticker?.high, market.pricePrecision))}
        {stat('24h low', fmtPrice(ticker?.low, market.pricePrecision))}
        {stat(`24h volume (${market.base})`, fmtCompact(ticker?.volume ?? 0))}
        {stat(`24h volume (${market.quote})`, fmtCompact(ticker?.quoteVolume ?? 0))}
        <div className="ml-auto"><AlertButton market={market} price={ticker?.price} /></div>
      </div>

      {open && (
        <div className="absolute inset-x-0 top-full mt-1 flex max-h-[65vh] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-xl sm:left-10 sm:right-auto sm:w-96">
          <div className="border-b border-line p-2">
            <input ref={searchRef} className="input py-1.5 text-sm" placeholder="Search pair" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" role="listbox">
            {list.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted">No pairs found</div>}
            {list.map((m) => {
              const t = tickers[m.symbol] ?? m.ticker ?? undefined;
              return (
                <Link
                  key={m.symbol}
                  href={`/trade/${m.symbol}`}
                  onClick={() => setOpen(false)}
                  role="option"
                  aria-selected={m.symbol === market.symbol}
                  className={clsx('flex items-center justify-between px-4 py-2 text-sm hover:bg-panel2', m.symbol === market.symbol && 'bg-panel2')}
                >
                  <span className="font-medium">
                    {favs.includes(m.symbol) && <span className="mr-1 text-brand">★</span>}
                    {m.base}<span className="text-muted">/{m.quote}</span>
                  </span>
                  <span className="num">
                    {fmtPrice(t?.price, m.pricePrecision)}{' '}
                    <span className={(t?.changePct ?? 0) >= 0 ? 'text-up' : 'text-down'}>{fmtPct(t?.changePct ?? 0)}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
