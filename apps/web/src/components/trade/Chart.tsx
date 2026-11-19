'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { createChart, ColorType, LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { api } from '@/lib/api';

const INTERVALS = [
  { id: '1m', s: 60 }, { id: '5m', s: 300 }, { id: '15m', s: 900 }, { id: '1h', s: 3600 },
  { id: '4h', s: 14400 }, { id: '1d', s: 86400 }, { id: '1w', s: 604800 },
] as const;

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
type Pt = { time: UTCTimestamp; value: number };

// ---------------- indicators ----------------
const INDICATORS = {
  MA7: { label: 'MA 7', color: '#f5a623' },
  MA25: { label: 'MA 25', color: '#af52de' },
  MA99: { label: 'MA 99', color: '#0a84ff' },
  EMA20: { label: 'EMA 20', color: '#ff2d55' },
  BOLL: { label: 'BOLL 20,2', color: '#8e8e93' },
} as const;
type IndicatorId = keyof typeof INDICATORS;

function sma(rows: Candle[], n: number): Pt[] {
  const out: Pt[] = [];
  let sum = 0;
  rows.forEach((r, i) => {
    sum += r.close;
    if (i >= n) sum -= rows[i - n].close;
    if (i >= n - 1) out.push({ time: r.time as UTCTimestamp, value: sum / n });
  });
  return out;
}
function ema(rows: Candle[], n: number): Pt[] {
  const k = 2 / (n + 1);
  const out: Pt[] = [];
  let prev = 0;
  rows.forEach((r, i) => {
    prev = i === 0 ? r.close : r.close * k + prev * (1 - k);
    if (i >= n - 1) out.push({ time: r.time as UTCTimestamp, value: prev });
  });
  return out;
}
function boll(rows: Candle[], n = 20, mult = 2) {
  const mid: Pt[] = [], up: Pt[] = [], lo: Pt[] = [];
  for (let i = n - 1; i < rows.length; i++) {
    const win = rows.slice(i - n + 1, i + 1).map((r) => r.close);
    const m = win.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / n);
    const time = rows[i].time as UTCTimestamp;
    mid.push({ time, value: m });
    up.push({ time, value: m + mult * sd });
    lo.push({ time, value: m - mult * sd });
  }
  return { mid, up, lo };
}
function computeIndicator(id: IndicatorId, rows: Candle[]): Pt[][] {
  if (id === 'MA7') return [sma(rows, 7)];
  if (id === 'MA25') return [sma(rows, 25)];
  if (id === 'MA99') return [sma(rows, 99)];
  if (id === 'EMA20') return [ema(rows, 20)];
  const b = boll(rows);
  return [b.up, b.mid, b.lo];
}

const cssColor = (v: string, a = 1) => `rgba(${getComputedStyle(document.documentElement).getPropertyValue(v).trim().split(/\s+/).join(',')},${a})`;
const loadPrefs = (): { ind: IndicatorId[]; style: 'candles' | 'line' } => {
  try {
    const p = JSON.parse(localStorage.getItem('chartPrefs') || '');
    if (Array.isArray(p.ind)) return { ind: p.ind.filter((x: string) => x in INDICATORS), style: p.style === 'line' ? 'line' : 'candles' };
  } catch {}
  return { ind: ['MA7', 'MA25'], style: 'candles' };
};

export function Chart({ symbol, price, pricePrecision }: { symbol: string; price?: number; pricePrecision: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi>();
  const main = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'>>();
  const volume = useRef<ISeriesApi<'Histogram'>>();
  const indSeries = useRef<Partial<Record<IndicatorId, ISeriesApi<'Line'>[]>>>({});
  const rows = useRef<Candle[]>([]);
  const [interval, setInterval_] = useState<(typeof INTERVALS)[number]['id']>('1h');
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<{ ind: IndicatorId[]; style: 'candles' | 'line' }>({ ind: ['MA7', 'MA25'], style: 'candles' });
  const [legend, setLegend] = useState<Partial<Record<IndicatorId, number>>>({});
  const [theme, setTheme] = useState('');

  useEffect(() => setPrefs(loadPrefs()), []);
  useEffect(() => {
    try { localStorage.setItem('chartPrefs', JSON.stringify(prefs)); } catch {}
  }, [prefs]);

  // rebuild the chart when light/dark theme changes (colors are read from CSS variables)
  useEffect(() => {
    const read = () => setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  /** Pushes rows into every series (full redraw). */
  const applyAll = useCallback(() => {
    const data = rows.current;
    if (!main.current || !volume.current) return;
    if (prefs.style === 'candles') (main.current as ISeriesApi<'Candlestick'>).setData(data.map((r) => ({ ...r, time: r.time as UTCTimestamp })));
    else (main.current as ISeriesApi<'Area'>).setData(data.map((r) => ({ time: r.time as UTCTimestamp, value: r.close })));
    const up = cssColor('--up', 0.35);
    const down = cssColor('--down', 0.35);
    volume.current.setData(data.map((r) => ({ time: r.time as UTCTimestamp, value: r.volume, color: r.close >= r.open ? up : down })));
    const lg: Partial<Record<IndicatorId, number>> = {};
    for (const id of prefs.ind) {
      const lines = computeIndicator(id, data);
      indSeries.current[id]?.forEach((s, i) => s.setData(lines[i] ?? []));
      const mid = lines[Math.floor(lines.length / 2)];
      if (mid?.length) lg[id] = mid[mid.length - 1].value;
    }
    setLegend(lg);
  }, [prefs]);

  // build chart + series
  useEffect(() => {
    if (!el.current) return;
    const upC = cssColor('--up');
    const downC = cssColor('--down');
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssColor('--muted'), fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: cssColor('--line', 0.5) } },
      rightPriceScale: { borderColor: cssColor('--line') },
      timeScale: { borderColor: cssColor('--line'), timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    const priceFormat = { type: 'price' as const, precision: pricePrecision, minMove: Math.pow(10, -pricePrecision) };
    main.current =
      prefs.style === 'candles'
        ? c.addCandlestickSeries({ upColor: upC, downColor: downC, borderUpColor: upC, borderDownColor: downC, wickUpColor: upC, wickDownColor: downC, priceFormat })
        : c.addAreaSeries({ lineColor: cssColor('--brand'), topColor: cssColor('--brand', 0.25), bottomColor: cssColor('--brand', 0), lineWidth: 2, priceFormat });
    volume.current = c.addHistogramSeries({ priceScaleId: '', priceFormat: { type: 'volume' } });
    volume.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    indSeries.current = {};
    for (const id of prefs.ind) {
      const n = id === 'BOLL' ? 3 : 1;
      indSeries.current[id] = Array.from({ length: n }, (_, i) =>
        c.addLineSeries({
          color: INDICATORS[id].color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          lineStyle: id === 'BOLL' && i !== 1 ? LineStyle.Dashed : LineStyle.Solid, priceFormat,
        }),
      );
    }
    chart.current = c;
    if (rows.current.length) applyAll();
    return () => c.remove();
  }, [pricePrecision, theme, prefs, applyAll]);

  // load candles
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<Candle[]>(`/api/markets/${symbol}/klines?interval=${interval}`)
      .then((data) => {
        if (cancelled) return;
        rows.current = data;
        applyAll();
        chart.current?.timeScale().fitContent();
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [symbol, interval, applyAll]);

  // stream the live price into the current candle and the indicators' last point
  useEffect(() => {
    const data = rows.current;
    if (!price || !data.length || !main.current) return;
    const step = INTERVALS.find((i) => i.id === interval)!.s;
    const now = Math.floor(Date.now() / 1000);
    const lastC = data[data.length - 1];
    if (now >= lastC.time + step) data.push({ time: Math.floor(now / step) * step, open: lastC.close, high: price, low: price, close: price, volume: 0 });
    else data[data.length - 1] = { ...lastC, high: Math.max(lastC.high, price), low: Math.min(lastC.low, price), close: price };
    const c = data[data.length - 1];
    if (prefs.style === 'candles') (main.current as ISeriesApi<'Candlestick'>).update({ ...c, time: c.time as UTCTimestamp });
    else (main.current as ISeriesApi<'Area'>).update({ time: c.time as UTCTimestamp, value: c.close });
    const tail = data.slice(-120);
    const lg: Partial<Record<IndicatorId, number>> = {};
    for (const id of prefs.ind) {
      // EMA needs full history to stay exact; the others only need their window
      const lines = computeIndicator(id, id === 'EMA20' ? data : tail);
      indSeries.current[id]?.forEach((s, i) => {
        const pt = lines[i]?.[lines[i].length - 1];
        if (pt) s.update(pt);
      });
      const mid = lines[Math.floor(lines.length / 2)];
      if (mid?.length) lg[id] = mid[mid.length - 1].value;
    }
    setLegend(lg);
  }, [price, interval, prefs]);

  const toggle = (id: IndicatorId) => setPrefs((p) => ({ ...p, ind: p.ind.includes(id) ? p.ind.filter((x) => x !== id) : [...p.ind, id] }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
        {INTERVALS.map((i) => (
          <button key={i.id} onClick={() => setInterval_(i.id)} className={clsx('shrink-0 rounded-md px-2 py-1 text-xs font-medium', interval === i.id ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg')}>
            {i.id}
          </button>
        ))}
        <span className="mx-1 h-4 w-px shrink-0 bg-line" />
        <button onClick={() => setPrefs((p) => ({ ...p, style: p.style === 'candles' ? 'line' : 'candles' }))} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted hover:text-fg" title="Chart style">
          {prefs.style === 'candles' ? 'Line' : 'Candles'}
        </button>
        {(Object.keys(INDICATORS) as IndicatorId[]).map((id) => (
          <button
            key={id}
            onClick={() => toggle(id)}
            className={clsx('shrink-0 rounded-md px-2 py-1 text-xs font-medium transition', prefs.ind.includes(id) ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg')}
            aria-pressed={prefs.ind.includes(id)}
          >
            {id}
          </button>
        ))}
        {loading && <span className="ml-auto shrink-0 text-xs text-muted">Loading…</span>}
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={el} className="absolute inset-0" />
        {prefs.ind.length > 0 && (
          <div className="pointer-events-none absolute left-2 top-1.5 z-10 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
            {prefs.ind.map((id) => (
              <span key={id} style={{ color: INDICATORS[id].color }}>
                {INDICATORS[id].label} <span className="num">{legend[id]?.toFixed(pricePrecision) ?? '—'}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
