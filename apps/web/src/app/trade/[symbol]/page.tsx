'use client';
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useDepth, useMarketTrades, useMarkets, useTickers, useApi, useUserEvents } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { Chart } from '@/components/trade/Chart';
import { OrderBook } from '@/components/trade/OrderBook';
import { RecentTrades } from '@/components/trade/RecentTrades';
import { OrderForm } from '@/components/trade/OrderForm';
import { UserOrders } from '@/components/trade/UserOrders';
import { PairHeader } from '@/components/trade/PairHeader';
import { MarketList } from '@/components/trade/MarketList';
import { brand, fmtPrice, fmtQty } from '@/lib/format';
import type { BalanceRow } from '@/lib/types';

export default function TradePage({ params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  const markets = useMarkets();
  const tickers = useTickers();
  const market = markets.find((m) => m.symbol === symbol);
  const ticker = tickers[symbol] ?? market?.ticker ?? undefined;
  const depth = useDepth(symbol);
  const trades = useMarketTrades(symbol);
  const { user } = useAuth();
  const toast = useToast();
  const balances = useApi<{ balances: BalanceRow[] }>(user ? '/api/wallet/balances' : null, { refreshOnUserEvent: true });
  const [picked, setPicked] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'chart' | 'book' | 'trades'>('chart');

  useUserEvents((ev) => {
    if (ev.type === 'fill') toast(`Order filled: ${ev.side.toLowerCase()} ${fmtQty(ev.qty)} ${ev.symbol} @ ${fmtPrice(ev.price)}`, 'success');
    if (ev.type === 'stop_triggered') toast(`Stop order triggered on ${ev.symbol}`, 'info');
  });

  useEffect(() => {
    if (ticker?.price && market) document.title = `${fmtPrice(ticker.price, market.pricePrecision)} | ${market.base}/${market.quote} | ${brand}`;
  }, [ticker?.price, market]);

  const avail = useMemo(() => {
    const find = (a: string) => +(balances.data?.balances.find((b) => b.asset === a)?.available ?? 0);
    return market ? { base: find(market.base), quote: find(market.quote) } : { base: 0, quote: 0 };
  }, [balances.data, market]);

  if (!markets.length) return <div className="p-10 text-center text-muted">Loading market…</div>;
  if (!market) return <div className="p-10 text-center text-muted">Market {symbol} not found.</div>;

  const pick = (p: string) => setPicked(p + '#' + Date.now()); // force effect even when same price
  const pickedPrice = picked ? picked.split('#')[0] : null;

  return (
    <div className="mx-auto max-w-[1600px] space-y-2 p-2">
      <PairHeader market={market} ticker={ticker} markets={markets} tickers={tickers} />

      {/* Mobile switcher */}
      <div className="card flex lg:hidden">
        {(['chart', 'book', 'trades'] as const).map((t) => (
          <button key={t} className={clsx('tab flex-1 capitalize', mobileTab === t && 'tab-active')} onClick={() => setMobileTab(t)}>
            {t === 'book' ? 'Order book' : t}
          </button>
        ))}
      </div>

      <div className="grid gap-2 lg:grid-cols-[290px_minmax(0,1fr)_300px]">
        <div className={clsx('card h-[460px] overflow-hidden lg:block lg:h-[720px]', mobileTab !== 'book' && 'hidden')}>
          <OrderBook depth={depth} market={market} lastPrice={ticker?.price} onPick={pick} rows={16} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className={clsx('card h-[380px] overflow-hidden lg:block lg:h-[440px]', mobileTab !== 'chart' && 'hidden')}>
            <Chart symbol={symbol} price={ticker?.price} pricePrecision={market.pricePrecision} />
          </div>
          <div className="card">
            <OrderForm market={market} lastPrice={ticker?.price} pickedPrice={pickedPrice} baseAvail={avail.base} quoteAvail={avail.quote} />
          </div>
        </div>
        <div className={clsx('flex-col gap-2 lg:flex', mobileTab === 'trades' ? 'flex' : 'hidden')}>
          <div className="card hidden h-[300px] overflow-hidden lg:block">
            <MarketList markets={markets} tickers={tickers} current={symbol} />
          </div>
          <div className="card h-[460px] overflow-hidden lg:h-[412px]">
            <RecentTrades trades={trades} market={market} />
          </div>
        </div>
      </div>

      <UserOrders symbol={symbol} />
    </div>
  );
}
