'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useMarkets, useTickers } from '@/lib/hooks';
import { fmtCompact, fmtPct, fmtPrice } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

type SortKey = 'symbol' | 'price' | 'changePct' | 'quoteVolume';

export function useFavorites() {
  const { user } = useAuth();
  const [favs, setFavs] = useState<string[]>([]);
  useEffect(() => {
    if (user) api<string[]>('/api/account/favorites').then(setFavs).catch(() => {});
    else {
      try { setFavs(JSON.parse(localStorage.getItem('favs') || '[]')); } catch { setFavs([]); }
    }
  }, [user]);
  const toggle = async (s: string) => {
    const on = !favs.includes(s);
    const next = on ? [...favs, s] : favs.filter((f) => f !== s);
    setFavs(next);
    if (user) await api(`/api/account/favorites/${s}`, { method: on ? 'PUT' : 'DELETE' }).catch(() => {});
    else try { localStorage.setItem('favs', JSON.stringify(next)); } catch {}
  };
  return { favs, toggle };
}

export function MarketTable({ limit, compact }: { limit?: number; compact?: boolean }) {
  const markets = useMarkets();
  const tickers = useTickers();
  const { favs, toggle } = useFavorites();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | 'fav' | 'gainers' | 'losers'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'quoteVolume', dir: -1 });

  const rows = useMemo(() => {
    let list = markets.map((m) => ({ ...m, t: tickers[m.symbol] ?? m.ticker }));
    if (q) list = list.filter((m) => m.symbol.includes(q.toUpperCase().replace('/', '')));
    if (tab === 'fav') list = list.filter((m) => favs.includes(m.symbol));
    if (tab === 'gainers') list = list.filter((m) => (m.t?.changePct ?? 0) > 0);
    if (tab === 'losers') list = list.filter((m) => (m.t?.changePct ?? 0) < 0);
    const s = tab === 'gainers' ? { key: 'changePct' as SortKey, dir: -1 } : tab === 'losers' ? { key: 'changePct' as SortKey, dir: 1 } : sort;
    list.sort((a, b) => {
      const av = s.key === 'symbol' ? a.symbol : (a.t?.[s.key] ?? 0);
      const bv = s.key === 'symbol' ? b.symbol : (b.t?.[s.key] ?? 0);
      return (av > bv ? 1 : av < bv ? -1 : 0) * s.dir;
    });
    return limit ? list.slice(0, limit) : list;
  }, [markets, tickers, q, tab, favs, sort, limit]);

  const head = (key: SortKey, label: string, cls = '') => (
    <th className={clsx('table-head cursor-pointer select-none px-3 py-2 hover:text-fg', cls)} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : -1 }))}>
      {label} {sort.key === key && tab === 'all' ? (sort.dir === 1 ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div className="card overflow-hidden">
      {!compact && (
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center">
          <div className="flex gap-1 overflow-x-auto">
            {(['all', 'fav', 'gainers', 'losers'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={clsx('rounded-md px-3 py-1.5 text-sm font-medium capitalize', tab === t ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg')}>
                {t === 'fav' ? '★ Favorites' : t === 'all' ? 'All' : t === 'gainers' ? 'Top gainers' : 'Top losers'}
              </button>
            ))}
          </div>
          <input className="input sm:ml-auto sm:w-64" placeholder="Search coin (e.g. BTC)" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="w-8" />
              {head('symbol', 'Pair')}
              {head('price', 'Last price', 'text-right')}
              {head('changePct', '24h change', 'text-right')}
              {!compact && <th className="table-head hidden px-3 py-2 text-right lg:table-cell">24h high / low</th>}
              {head('quoteVolume', '24h volume', 'text-right')}
              <th className="table-head px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const up = (m.t?.changePct ?? 0) >= 0;
              return (
                <tr key={m.symbol} className="border-b border-line/60 last:border-0 hover:bg-panel2/60">
                  <td className="pl-3">
                    <button onClick={() => toggle(m.symbol)} className={favs.includes(m.symbol) ? 'text-brand' : 'text-muted hover:text-fg'} aria-label="Favorite">
                      {favs.includes(m.symbol) ? '★' : '☆'}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/trade/${m.symbol}`} className="font-semibold hover:text-brand">
                      {m.base}<span className="font-normal text-muted">/{m.quote}</span>
                    </Link>
                  </td>
                  <td className="num px-3 text-right">{fmtPrice(m.t?.price, m.pricePrecision)}</td>
                  <td className={clsx('num px-3 text-right', up ? 'text-up' : 'text-down')}>{fmtPct(m.t?.changePct ?? 0)}</td>
                  {!compact && (
                    <td className="num hidden px-3 text-right text-muted lg:table-cell">
                      {fmtPrice(m.t?.high, m.pricePrecision)} / {fmtPrice(m.t?.low, m.pricePrecision)}
                    </td>
                  )}
                  <td className="num px-3 text-right">{fmtCompact(m.t?.quoteVolume ?? 0)}</td>
                  <td className="px-3 text-right">
                    <Link href={`/trade/${m.symbol}`} className="text-sm font-medium text-brand hover:underline">Trade</Link>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted">{markets.length ? 'No markets match.' : 'Loading markets…'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
