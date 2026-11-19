/**
 * External market data: mirrors public Binance spot market data (no API key needed).
 * If the feed is disabled/unreachable, prices fall back to a random walk so the app keeps working offline.
 */
import WebSocket from 'ws';
import { config } from '../config.js';
import { publish, redis } from '../redis.js';

export interface Ticker {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number; // base
  quoteVolume: number;
  updatedAt: number;
}

export interface MarketTrade {
  id: string;
  price: number;
  qty: number;
  side: 'BUY' | 'SELL';
  time: number;
}

const REST = 'https://api.binance.com';
const WS = 'wss://stream.binance.com:9443/stream';

const tickers = new Map<string, Ticker>();
const marketTrades = new Map<string, MarketTrade[]>();
const priceListeners: Array<(symbol: string, price: number) => void> = [];
let symbols: string[] = [];
let socket: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let backoff = 1000;

export const onPrice = (fn: (symbol: string, price: number) => void) => priceListeners.push(fn);
export const getTicker = (s: string) => tickers.get(s);
export const getTickers = () => symbols.map((s) => tickers.get(s)).filter(Boolean) as Ticker[];
export const getPrice = (s: string) => tickers.get(s)?.price;
export const getMarketTrades = (s: string) => marketTrades.get(s) ?? [];

function emitPrice(symbol: string, price: number) {
  for (const fn of priceListeners) {
    try {
      fn(symbol, price);
    } catch (e) {
      console.error('[feed] listener error', e);
    }
  }
}

function setTicker(t: Ticker) {
  tickers.set(t.symbol, t);
  emitPrice(t.symbol, t.price);
}

export function pushTrade(symbol: string, t: MarketTrade) {
  const list = marketTrades.get(symbol) ?? [];
  list.unshift(t);
  if (list.length > 60) list.length = 60;
  marketTrades.set(symbol, list);
  publish({ ch: `trades:${symbol}`, data: t });
}

async function loadRest(list: string[]) {
  const url = `${REST}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(list))}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`ticker REST ${res.status}`);
  const rows = (await res.json()) as any[];
  for (const r of rows) {
    setTicker({
      symbol: r.symbol,
      price: +r.lastPrice,
      open: +r.openPrice,
      high: +r.highPrice,
      low: +r.lowPrice,
      change: +r.priceChange,
      changePct: +r.priceChangePercent,
      volume: +r.volume,
      quoteVolume: +r.quoteVolume,
      updatedAt: Date.now(),
    });
  }
}

function connect() {
  if (!symbols.length) return;
  const streams = symbols.flatMap((s) => [`${s.toLowerCase()}@ticker`, `${s.toLowerCase()}@aggTrade`]).join('/');
  socket = new WebSocket(`${WS}?streams=${streams}`);
  const lastTradeEmit = new Map<string, number>();
  socket.on('open', () => {
    backoff = 1000;
    console.log(`[feed] connected to external stream (${symbols.length} pairs)`);
  });
  socket.on('message', (raw) => {
    try {
      const { data: d } = JSON.parse(raw.toString());
      if (!d) return;
      if (d.e === '24hrTicker') {
        setTicker({
          symbol: d.s, price: +d.c, open: +d.o, high: +d.h, low: +d.l, change: +d.p,
          changePct: +d.P, volume: +d.v, quoteVolume: +d.q, updatedAt: Date.now(),
        });
      } else if (d.e === 'aggTrade') {
        // throttle to ~4 trades/sec/pair to keep the UI readable
        const now = Date.now();
        if (now - (lastTradeEmit.get(d.s) ?? 0) < 250) return;
        lastTradeEmit.set(d.s, now);
        const t = tickers.get(d.s);
        if (t) {
          t.price = +d.p;
          emitPrice(d.s, t.price);
        }
        pushTrade(d.s, { id: `x${d.a}`, price: +d.p, qty: +d.q, side: d.m ? 'SELL' : 'BUY', time: d.T });
      }
    } catch {
      /* ignore malformed frames */
    }
  });
  socket.on('close', scheduleReconnect);
  socket.on('error', (e) => {
    console.warn('[feed] stream error:', (e as Error).message);
    socket?.terminate();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoff);
  backoff = Math.min(backoff * 2, 60_000);
}

/** Random-walk any symbol that hasn't had a real update recently. */
function simulateStale() {
  const now = Date.now();
  for (const s of symbols) {
    const t = tickers.get(s);
    if (!t || now - t.updatedAt < 10_000) continue;
    const drift = 1 + (Math.random() - 0.5) * 0.0016;
    const price = t.price * drift;
    t.price = price;
    t.high = Math.max(t.high, price);
    t.low = Math.min(t.low, price);
    t.change = price - t.open;
    t.changePct = (t.change / t.open) * 100;
    t.volume += Math.random() * 2;
    t.quoteVolume = t.volume * price;
    emitPrice(s, price);
    if (Math.random() < 0.6) {
      pushTrade(s, {
        id: `s${now}${Math.floor(Math.random() * 1e6)}`,
        price,
        qty: +(Math.random() * (500 / price)).toPrecision(4),
        side: Math.random() > 0.5 ? 'BUY' : 'SELL',
        time: now,
      });
    }
  }
}

export async function startFeed(pairs: { symbol: string; seedPrice: number }[]) {
  symbols = pairs.map((p) => p.symbol);
  for (const p of pairs) {
    if (!tickers.has(p.symbol)) {
      tickers.set(p.symbol, {
        symbol: p.symbol, price: p.seedPrice, open: p.seedPrice, high: p.seedPrice, low: p.seedPrice,
        change: 0, changePct: 0, volume: 0, quoteVolume: 0, updatedAt: 0,
      });
    }
  }
  if (config.externalFeed) {
    try {
      await loadRest(symbols);
    } catch (e) {
      console.warn('[feed] REST bootstrap failed, using simulated prices:', (e as Error).message);
    }
    socket?.removeAllListeners('close');
    socket?.terminate();
    connect();
  } else {
    console.log('[feed] external feed disabled; prices are simulated');
  }
}

let started = false;
export function startFeedLoops() {
  if (started) return;
  started = true;
  setInterval(simulateStale, 1000);
  setInterval(() => {
    const all = getTickers();
    publish({ ch: 'tickers', data: all });
    redis.set('exchange:tickers', JSON.stringify(all)).catch(() => {});
  }, 1000);
}

/** Restart the stream with an updated pair list (used when admins list a new pair). */
export async function updateFeedPairs(pairs: { symbol: string; seedPrice: number }[]) {
  await startFeed(pairs);
}

// ---------- Candles ----------
export const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;
const intervalMs: Record<string, number> = {
  '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '4h': 14400e3, '1d': 86400e3, '1w': 604800e3,
};

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

export async function getCandles(symbol: string, interval: string, limit = 500): Promise<Candle[]> {
  const cacheKey = `exchange:klines:${symbol}:${interval}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached);
  let candles: Candle[] | null = null;
  if (config.externalFeed) {
    try {
      const res = await fetch(`${REST}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const rows = (await res.json()) as any[];
        candles = rows.map((r) => ({ time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }));
      }
    } catch {
      /* fall through to synthetic */
    }
  }
  if (!candles) candles = syntheticCandles(symbol, interval, limit);
  await redis.set(cacheKey, JSON.stringify(candles), 'EX', 10).catch(() => {});
  return candles;
}

function syntheticCandles(symbol: string, interval: string, limit: number): Candle[] {
  const step = intervalMs[interval] ?? 3600e3;
  const end = Math.floor(Date.now() / step) * step;
  let price = getPrice(symbol) ?? 100;
  const out: Candle[] = [];
  // walk backwards from the current price so the last candle matches the live ticker
  for (let i = 0; i < limit; i++) {
    const close = price;
    const open = close * (1 + (Math.random() - 0.5) * 0.01);
    const high = Math.max(open, close) * (1 + Math.random() * 0.004);
    const low = Math.min(open, close) * (1 - Math.random() * 0.004);
    out.push({ time: (end - i * step) / 1000, open, high, low, close, volume: Math.random() * 100 });
    price = open;
  }
  return out.reverse();
}
