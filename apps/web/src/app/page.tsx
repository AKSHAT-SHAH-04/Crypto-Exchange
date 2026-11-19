'use client';
import Link from 'next/link';
import { MarketTable } from '@/components/MarketTable';
import { useAuth } from '@/lib/auth';
import { brand } from '@/lib/format';

const features = [
  { t: 'Real matching engine', d: 'Price-time priority order books with limit, market and stop-limit orders.' },
  { t: 'Live market data', d: 'Prices, depth and candles stream in real time over WebSockets.' },
  { t: 'Secure by default', d: '2FA, withdrawal whitelists, email confirmations and full audit logs.' },
  { t: 'Developer API', d: 'Create signed API keys to automate your trading strategies.' },
];

export default function Home() {
  const { user, tradingMode } = useAuth();
  return (
    <div className="mx-auto max-w-[1200px] px-4">
      <section className="grid items-center gap-10 py-14 md:grid-cols-2 md:py-20">
        <div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            Trade crypto with <span className="text-brand">confidence</span>.
          </h1>
          <p className="mt-4 max-w-md text-muted">
            {brand} gives you a fast spot exchange with pro charts, deep liquidity and bank-grade security.
            {tradingMode === 'paper' && ' Start with 10,000 demo USDT, no deposit needed.'}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {user ? (
              <Link href="/trade/BTCUSDT" className="btn-brand px-6 py-3">Start trading</Link>
            ) : (
              <>
                <Link href="/register" className="btn-brand px-6 py-3">Create free account</Link>
                <Link href="/markets" className="btn-ghost px-6 py-3">Explore markets</Link>
              </>
            )}
          </div>
        </div>
        <MarketTable limit={6} compact />
      </section>
      <section className="grid gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <div key={f.t} className="card p-5">
            <h3 className="font-semibold">{f.t}</h3>
            <p className="mt-2 text-sm text-muted">{f.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
