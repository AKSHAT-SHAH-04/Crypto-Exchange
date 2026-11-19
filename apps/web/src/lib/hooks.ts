'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { socket } from './ws';
import type { Depth, Market, MarketTrade, Ticker } from './types';

export function useMarkets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  useEffect(() => {
    api<Market[]>('/api/markets').then(setMarkets).catch(() => {});
  }, []);
  return markets;
}

export function useTickers() {
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  useEffect(() => {
    api<Market[]>('/api/markets')
      .then((ms) => setTickers((t) => ({ ...Object.fromEntries(ms.filter((m) => m.ticker).map((m) => [m.symbol, m.ticker!])), ...t })))
      .catch(() => {});
    return socket.on('tickers', (list: Ticker[]) => setTickers(Object.fromEntries(list.map((t) => [t.symbol, t]))));
  }, []);
  return tickers;
}

export function useDepth(symbol: string) {
  const [depth, setDepth] = useState<Depth | null>(null);
  useEffect(() => {
    setDepth(null);
    api<Depth>(`/api/markets/${symbol}/depth`).then(setDepth).catch(() => {});
    return socket.on(`depth:${symbol}`, setDepth);
  }, [symbol]);
  return depth;
}

export function useMarketTrades(symbol: string) {
  const [trades, setTrades] = useState<MarketTrade[]>([]);
  useEffect(() => {
    setTrades([]);
    api<MarketTrade[]>(`/api/markets/${symbol}/trades`).then(setTrades).catch(() => {});
    const off = socket.on(`trades:${symbol}`, (t: MarketTrade) => setTrades((prev) => [t, ...prev.filter((p) => p.id !== t.id)].slice(0, 60)));
    return off;
  }, [symbol]);
  return trades;
}

/** Fires callback when the server says this user's orders/balances changed. */
export function useUserEvents(cb: (ev: any) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => socket.on('user', (ev) => ref.current(ev)), []);
}

/** Fetch helper with reload + automatic refresh on user events. */
export function useApi<T>(path: string | null, opts: { refreshOnUserEvent?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(!!path);
    reload();
  }, [reload, path]);
  useUserEvents((ev) => {
    if (opts.refreshOnUserEvent && ev?.type === 'refresh') reload();
  });
  return { data, error, loading, reload, setData };
}
