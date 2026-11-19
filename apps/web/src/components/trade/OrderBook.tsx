'use client';
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { Depth, Market } from '@/lib/types';
import { fmt, fmtPrice } from '@/lib/format';
import { useT } from '@/lib/i18n';

type View = 'both' | 'bids' | 'asks';

/** Aggregates levels into price buckets: bids round down, asks round up. */
function group(levels: [string, string][], size: number, side: 'bid' | 'ask', dp: number) {
  const out = new Map<string, number>();
  for (const [p, q] of levels) {
    const raw = +p / size;
    const bucket = (side === 'bid' ? Math.floor(raw + 1e-9) : Math.ceil(raw - 1e-9)) * size;
    const key = bucket.toFixed(Math.max(0, dp));
    out.set(key, (out.get(key) ?? 0) + +q);
  }
  return [...out.entries()].map(([p, q]) => ({ p, q }));
}

export function OrderBook({ depth, market, lastPrice, onPick, rows = 14 }: { depth: Depth | null; market: Market; lastPrice?: number; onPick: (p: string) => void; rows?: number }) {
  const { t } = useT();
  const [view, setView] = useState<View>('both');
  const tick = Math.pow(10, -market.pricePrecision);
  const groups = [0, 1, 2, 3].map((i) => ({ size: tick * Math.pow(10, i), dp: market.pricePrecision - i }));
  const [g, setG] = useState(0);
  const { size, dp } = groups[g];
  const n = view === 'both' ? rows : rows * 2 + 2;

  const { asks, bids, max } = useMemo(() => {
    const a = group(depth?.asks ?? [], size, 'ask', dp).slice(0, n);
    const b = group(depth?.bids ?? [], size, 'bid', dp).slice(0, n);
    let acc = 0;
    const askC = a.map((x) => ({ ...x, cum: (acc += x.q) }));
    acc = 0;
    const bidC = b.map((x) => ({ ...x, cum: (acc += x.q) }));
    const max = Math.max(askC.at(-1)?.cum ?? 0, bidC.at(-1)?.cum ?? 0) || 1;
    return { asks: askC.reverse(), bids: bidC, max };
  }, [depth, size, dp, n]);

  const bestAsk = depth?.asks[0] ? +depth.asks[0][0] : undefined;
  const bestBid = depth?.bids[0] ? +depth.bids[0][0] : undefined;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : undefined;
  const qdp = Math.min(market.qtyPrecision, 6);
  const pdp = Math.max(0, dp);

  const Row = ({ r, side }: { r: { p: string; q: number; cum: number }; side: 'ask' | 'bid' }) => (
    <button onClick={() => onPick(r.p)} className="relative grid w-full grid-cols-3 px-3 py-[2px] text-right text-xs hover:bg-panel2">
      <span className={clsx('absolute inset-y-0 right-0', side === 'ask' ? 'bg-down/10' : 'bg-up/10')} style={{ width: `${(r.cum / max) * 100}%` }} />
      <span className={clsx('num relative text-left', side === 'ask' ? 'text-down' : 'text-up')}>{fmt(r.p, pdp)}</span>
      <span className="num relative">{fmt(r.q, qdp)}</span>
      <span className="num relative text-muted">{fmt(r.q * +r.p, 2)}</span>
    </button>
  );

  const ViewBtn = ({ v, children }: { v: View; children: React.ReactNode }) => (
    <button onClick={() => setView(v)} className={clsx('flex h-6 w-6 items-center justify-center rounded', view === v ? 'bg-panel2' : 'opacity-50 hover:opacity-100')} aria-label={`Show ${v}`}>{children}</button>
  );
  const bar = (c: string) => <span className={`block h-1 w-3 rounded-sm ${c}`} />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5">
        <span className="mr-auto text-sm font-semibold">{t('trade.orderbook')}</span>
        <ViewBtn v="both"><span className="flex flex-col gap-0.5">{bar('bg-down')}{bar('bg-up')}</span></ViewBtn>
        <ViewBtn v="bids"><span className="flex flex-col gap-0.5">{bar('bg-up')}{bar('bg-up')}</span></ViewBtn>
        <ViewBtn v="asks"><span className="flex flex-col gap-0.5">{bar('bg-down')}{bar('bg-down')}</span></ViewBtn>
        <select aria-label="Group" value={g} onChange={(e) => setG(+e.target.value)} className="num ml-1 rounded border border-line bg-panel2 px-1 py-0.5 text-[11px] outline-none">
          {groups.map((x, i) => <option key={i} value={i}>{x.size >= 1 ? x.size.toFixed(0) : x.size.toFixed(Math.max(0, x.dp))}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-3 px-3 py-1.5 text-right text-[11px] text-muted">
        <span className="text-left">{t('trade.price')} ({market.quote})</span>
        <span>{t('trade.amount')} ({market.base})</span>
        <span>{t('trade.total')}</span>
      </div>
      {view !== 'bids' && (
        <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
          {asks.map((r) => <Row key={r.p} r={r} side="ask" />)}
        </div>
      )}
      <div className="flex items-center gap-2 border-y border-line px-3 py-2">
        <span className="num text-lg font-semibold">{fmtPrice(lastPrice, market.pricePrecision)}</span>
        {spread !== undefined && <span className="num ml-auto text-xs text-muted">{t('trade.spread')} {fmt(spread, market.pricePrecision)}</span>}
      </div>
      {view !== 'asks' && (
        <div className="min-h-0 flex-1 overflow-hidden">
          {bids.map((r) => <Row key={r.p} r={r} side="bid" />)}
        </div>
      )}
    </div>
  );
}
