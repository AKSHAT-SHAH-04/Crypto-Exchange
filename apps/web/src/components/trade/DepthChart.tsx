'use client';
import { useMemo, useRef, useState } from 'react';
import type { Depth, Market } from '@/lib/types';
import { fmt, fmtCompact } from '@/lib/format';

/** Cumulative depth chart (bids left, asks right) drawn as SVG. */
export function DepthChart({ depth, market }: { depth: Depth | null; market: Market }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; price: number; cum: number; side: 'bid' | 'ask' } | null>(null);
  const W = 1000;
  const H = 400;
  const PAD_B = 24;

  const data = useMemo(() => {
    if (!depth?.bids.length || !depth.asks.length) return null;
    let acc = 0;
    const bids = depth.bids.map(([p, q]) => ({ p: +p, c: (acc += +q) }));
    acc = 0;
    const asks = depth.asks.map(([p, q]) => ({ p: +p, c: (acc += +q) }));
    const mid = (bids[0].p + asks[0].p) / 2;
    const span = Math.max(mid - bids.at(-1)!.p, asks.at(-1)!.p - mid);
    const minP = mid - span;
    const maxP = mid + span;
    const maxC = Math.max(bids.at(-1)!.c, asks.at(-1)!.c) * 1.1;
    const x = (p: number) => ((p - minP) / (maxP - minP)) * W;
    const y = (c: number) => H - PAD_B - (c / maxC) * (H - PAD_B - 10);
    const path = (pts: { p: number; c: number }[]) => {
      let d = `M ${x(pts[0].p)} ${H - PAD_B}`;
      let prevC = 0;
      for (const pt of pts) {
        d += ` L ${x(pt.p)} ${y(prevC)} L ${x(pt.p)} ${y(pt.c)}`;
        prevC = pt.c;
      }
      return d;
    };
    const bidPath = path(bids);
    const askPath = path(asks);
    return {
      bids, asks, mid, minP, maxP, maxC, x, y,
      bidLine: bidPath, bidArea: `${bidPath} L ${x(bids.at(-1)!.p)} ${H - PAD_B} Z`,
      askLine: askPath, askArea: `${askPath} L ${x(asks.at(-1)!.p)} ${H - PAD_B} Z`,
    };
  }, [depth]);

  const onMove = (e: React.MouseEvent) => {
    if (!data || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const price = data.minP + (px / W) * (data.maxP - data.minP);
    if (price < data.mid) {
      const lvl = data.bids.filter((b) => b.p >= price).at(-1);
      lvl && setHover({ x: px, price: lvl.p, cum: lvl.c, side: 'bid' });
    } else {
      const lvl = data.asks.filter((a) => a.p <= price).at(-1);
      lvl && setHover({ x: px, price: lvl.p, cum: lvl.c, side: 'ask' });
    }
  };

  if (!data) return <div className="flex h-full items-center justify-center text-sm text-muted">Waiting for order book…</div>;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => data.minP + f * (data.maxP - data.minP));
  return (
    <div className="relative h-full w-full p-2">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Market depth chart">
        <path d={data.bidArea} fill="rgb(var(--up) / 0.15)" />
        <path d={data.bidLine} fill="none" stroke="rgb(var(--up))" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={data.askArea} fill="rgb(var(--down) / 0.15)" />
        <path d={data.askLine} fill="none" stroke="rgb(var(--down))" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <line x1={W / 2} x2={W / 2} y1={0} y2={H - PAD_B} stroke="rgb(var(--line))" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        {hover && <line x1={hover.x} x2={hover.x} y1={0} y2={H - PAD_B} stroke="rgb(var(--muted))" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="pointer-events-none absolute inset-x-2 bottom-1 flex justify-between text-[10px] text-muted">
        {ticks.map((p, i) => <span key={i} className="num">{fmt(p, market.pricePrecision)}</span>)}
      </div>
      <div className="pointer-events-none absolute left-3 top-2 text-xs text-muted">Mid <span className="num text-fg">{fmt(data.mid, market.pricePrecision)}</span></div>
      {hover && (
        <div className="pointer-events-none absolute right-3 top-2 rounded border border-line bg-panel px-2 py-1 text-xs">
          <div className={hover.side === 'bid' ? 'text-up' : 'text-down'}>{hover.side === 'bid' ? 'Bids ≥' : 'Asks ≤'} <span className="num">{fmt(hover.price, market.pricePrecision)}</span></div>
          <div className="num">Σ {fmtCompact(hover.cum)} {market.base} · ${fmtCompact(hover.cum * hover.price)}</div>
        </div>
      )}
    </div>
  );
}
