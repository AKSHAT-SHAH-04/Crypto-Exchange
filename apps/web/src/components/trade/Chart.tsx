'use client';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { createChart, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { api } from '@/lib/api';

const INTERVALS = [
  { id: '1m', s: 60 }, { id: '5m', s: 300 }, { id: '15m', s: 900 }, { id: '1h', s: 3600 },
  { id: '4h', s: 14400 }, { id: '1d', s: 86400 }, { id: '1w', s: 604800 },
] as const;

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

const cssColor = (v: string, a = 1) => `rgba(${getComputedStyle(document.documentElement).getPropertyValue(v).trim().split(/\s+/).join(',')},${a})`;

export function Chart({ symbol, price, pricePrecision }: { symbol: string; price?: number; pricePrecision: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi>();
  const candles = useRef<ISeriesApi<'Candlestick'>>();
  const volume = useRef<ISeriesApi<'Histogram'>>();
  const last = useRef<Candle | null>(null);
  const [interval, setInterval_] = useState<(typeof INTERVALS)[number]['id']>('1h');
  const [loading, setLoading] = useState(true);
  // rebuild the chart when light/dark theme changes (colors are read from CSS variables)
  const [theme, setTheme] = useState('');
  useEffect(() => {
    const read = () => setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    if (!el.current) return;
    const up = cssColor('--up');
    const down = cssColor('--down');
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssColor('--muted'), fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: cssColor('--line', 0.5) } },
      rightPriceScale: { borderColor: cssColor('--line') },
      timeScale: { borderColor: cssColor('--line'), timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    candles.current = c.addCandlestickSeries({
      upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
      priceFormat: { type: 'price', precision: pricePrecision, minMove: Math.pow(10, -pricePrecision) },
    });
    volume.current = c.addHistogramSeries({ priceScaleId: '', priceFormat: { type: 'volume' } });
    volume.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    return () => c.remove();
  }, [pricePrecision, theme]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<Candle[]>(`/api/markets/${symbol}/klines?interval=${interval}`)
      .then((rows) => {
        if (cancelled || !candles.current) return;
        const up = cssColor('--up', 0.4);
        const down = cssColor('--down', 0.4);
        candles.current.setData(rows.map((r) => ({ ...r, time: r.time as UTCTimestamp })));
        volume.current!.setData(rows.map((r) => ({ time: r.time as UTCTimestamp, value: r.volume, color: r.close >= r.open ? up : down })));
        last.current = rows[rows.length - 1] ?? null;
        chart.current?.timeScale().fitContent();
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [symbol, interval, pricePrecision, theme]);

  // Stream the live price into the current candle.
  useEffect(() => {
    if (!price || !last.current || !candles.current) return;
    const step = INTERVALS.find((i) => i.id === interval)!.s;
    const now = Math.floor(Date.now() / 1000);
    let c = last.current;
    if (now >= c.time + step) {
      c = { time: Math.floor(now / step) * step, open: c.close, high: price, low: price, close: price, volume: 0 };
    } else {
      c = { ...c, high: Math.max(c.high, price), low: Math.min(c.low, price), close: price };
    }
    last.current = c;
    candles.current.update({ ...c, time: c.time as UTCTimestamp });
  }, [price, interval]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {INTERVALS.map((i) => (
          <button key={i.id} onClick={() => setInterval_(i.id)} className={clsx('rounded px-2 py-1 text-xs font-medium', interval === i.id ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg')}>
            {i.id}
          </button>
        ))}
        {loading && <span className="ml-auto text-xs text-muted">Loading…</span>}
      </div>
      <div ref={el} className="min-h-0 flex-1" />
    </div>
  );
}
