'use client';
import clsx from 'clsx';
import { useState } from 'react';
import Link from 'next/link';
import type { Market, Ticker } from '@/lib/types';
import { fmtCompact, fmtPct, fmtPrice } from '@/lib/format';
import { useFavorites } from '@/components/MarketTable';
import { AlertButton } from './AlertButton';

export function PairHeader({ market, ticker, markets, tickers }: { market: Market; ticker?: Ticker; markets: Market[]; tickers: Record<string, Ticker> }) {
  const up = (ticker?.changePct ?? 0) >= 0;
  const [open, setOpen] = useState(false);
  const { favs, toggle } = useFavorites();
  const stat = (label: string, value: React.ReactNode, cls = '') => (
    <div className="shrink-0">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={clsx('num text-xs', cls)}>{value}</div>
    </div>
  );
  return (
    <div className="card relative flex items-center gap-6 overflow-x-auto px-4 py-2.5">
      <button onClick={() => toggle(market.symbol)} className={favs.includes(market.symbol) ? 'text-brand' : 'text-muted'} aria-label="Favorite">
        {favs.includes(market.symbol) ? '★' : '☆'}
      </button>
      <button onClick={() => setOpen((o) => !o)} className="flex shrink-0 items-center gap-1 text-lg font-bold">
        {market.base}<span className="text-muted">/{market.quote}</span> <span className="text-xs text-muted">▾</span>
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
      {open && (
        <div className="fixed inset-x-4 top-32 z-30 max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-panel shadow-xl sm:absolute sm:inset-x-auto sm:left-10 sm:top-12 sm:w-80" onMouseLeave={() => setOpen(false)}>
          {markets.map((m) => {
            const t = tickers[m.symbol];
            return (
              <Link key={m.symbol} href={`/trade/${m.symbol}`} onClick={() => setOpen(false)} className="flex justify-between px-4 py-2 text-sm hover:bg-panel2">
                <span className="font-medium">{m.base}<span className="text-muted">/{m.quote}</span></span>
                <span className="num">{fmtPrice(t?.price, m.pricePrecision)} <span className={(t?.changePct ?? 0) >= 0 ? 'text-up' : 'text-down'}>{fmtPct(t?.changePct ?? 0)}</span></span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
