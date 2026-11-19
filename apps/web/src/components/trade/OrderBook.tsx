'use client';
import { useMemo } from 'react';
import clsx from 'clsx';
import type { Depth, Market } from '@/lib/types';
import { fmt, fmtPrice } from '@/lib/format';

export function OrderBook({ depth, market, lastPrice, onPick, rows = 14 }: { depth: Depth | null; market: Market; lastPrice?: number; onPick: (p: string) => void; rows?: number }) {
  const { asks, bids, max } = useMemo(() => {
    const asks = (depth?.asks ?? []).slice(0, rows).map(([p, q]) => ({ p, q: +q }));
    const bids = (depth?.bids ?? []).slice(0, rows).map(([p, q]) => ({ p, q: +q }));
    let acc = 0;
    const askC = asks.map((a) => ({ ...a, cum: (acc += a.q) }));
    acc = 0;
    const bidC = bids.map((b) => ({ ...b, cum: (acc += b.q) }));
    const max = Math.max(askC.at(-1)?.cum ?? 0, bidC.at(-1)?.cum ?? 0) || 1;
    return { asks: askC.reverse(), bids: bidC, max };
  }, [depth, rows]);

  const bestAsk = depth?.asks[0] ? +depth.asks[0][0] : undefined;
  const bestBid = depth?.bids[0] ? +depth.bids[0][0] : undefined;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : undefined;
  const qdp = Math.min(market.qtyPrecision, 6);

  const Row = ({ r, side }: { r: { p: string; q: number; cum: number }; side: 'ask' | 'bid' }) => (
    <button onClick={() => onPick(r.p)} className="relative grid w-full grid-cols-3 px-3 py-[2px] text-right text-xs hover:bg-panel2">
      <span className={clsx('absolute inset-y-0 right-0', side === 'ask' ? 'bg-down/10' : 'bg-up/10')} style={{ width: `${(r.cum / max) * 100}%` }} />
      <span className={clsx('num relative text-left', side === 'ask' ? 'text-down' : 'text-up')}>{fmt(r.p, market.pricePrecision)}</span>
      <span className="num relative">{fmt(r.q, qdp)}</span>
      <span className="num relative text-muted">{fmt(r.q * +r.p, 2)}</span>
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-3 py-2 text-sm font-semibold">Order book</div>
      <div className="grid grid-cols-3 px-3 py-1.5 text-right text-[11px] text-muted">
        <span className="text-left">Price ({market.quote})</span>
        <span>Amount ({market.base})</span>
        <span>Total</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
        {asks.map((r) => <Row key={r.p} r={r} side="ask" />)}
      </div>
      <div className="flex items-center gap-2 border-y border-line px-3 py-2">
        <span className="num text-lg font-semibold">{fmtPrice(lastPrice, market.pricePrecision)}</span>
        {spread !== undefined && <span className="num ml-auto text-xs text-muted">Spread {fmt(spread, market.pricePrecision)}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {bids.map((r) => <Row key={r.p} r={r} side="bid" />)}
      </div>
    </div>
  );
}
