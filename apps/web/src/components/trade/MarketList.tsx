'use client';
import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import type { Market, Ticker } from '@/lib/types';
import { fmtPct, fmtPrice } from '@/lib/format';

export function MarketList({ markets, tickers, current }: { markets: Market[]; tickers: Record<string, Ticker>; current: string }) {
  const [q, setQ] = useState('');
  const list = markets.filter((m) => m.symbol.includes(q.toUpperCase()));
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-2">
        <input className="input py-1.5 text-xs" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.map((m) => {
          const t = tickers[m.symbol];
          return (
            <Link key={m.symbol} href={`/trade/${m.symbol}`} className={clsx('grid grid-cols-3 px-3 py-1 text-xs hover:bg-panel2', m.symbol === current && 'bg-panel2')}>
              <span className="font-medium">{m.base}<span className="text-muted">/{m.quote}</span></span>
              <span className="num text-right">{fmtPrice(t?.price, m.pricePrecision)}</span>
              <span className={clsx('num text-right', (t?.changePct ?? 0) >= 0 ? 'text-up' : 'text-down')}>{fmtPct(t?.changePct ?? 0)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
