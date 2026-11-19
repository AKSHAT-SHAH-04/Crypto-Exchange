'use client';
import clsx from 'clsx';
import type { Market, MarketTrade } from '@/lib/types';
import { fmt, fmtTime } from '@/lib/format';

export function RecentTrades({ trades, market }: { trades: MarketTrade[]; market: Market }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-3 py-2 text-sm font-semibold">Market trades</div>
      <div className="grid grid-cols-3 px-3 py-1.5 text-right text-[11px] text-muted">
        <span className="text-left">Price ({market.quote})</span>
        <span>Amount ({market.base})</span>
        <span>Time</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {trades.map((t) => (
          <div key={t.id} className="grid grid-cols-3 px-3 py-[2px] text-right text-xs">
            <span className={clsx('num text-left', t.side === 'BUY' ? 'text-up' : 'text-down')}>{fmt(t.price, market.pricePrecision)}</span>
            <span className="num">{fmt(t.qty, Math.min(market.qtyPrecision, 6))}</span>
            <span className="num text-muted">{fmtTime(t.time)}</span>
          </div>
        ))}
        {!trades.length && <div className="p-6 text-center text-xs text-muted">Waiting for trades…</div>}
      </div>
    </div>
  );
}
