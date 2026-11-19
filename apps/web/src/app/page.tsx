'use client';
import Link from 'next/link';
import { MarketTable } from '@/components/MarketTable';
import { useAuth } from '@/lib/auth';
import { brand } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Announcement } from '@/lib/types';

const features = [
  { t: 'Real matching engine', d: 'Price-time priority order books with limit, market, stop-limit, OCO and trailing-stop orders.' },
  { t: 'Live market data', d: 'Prices, depth and candles stream in real time over WebSockets.' },
  { t: 'Secure by default', d: '2FA, withdrawal whitelists, email confirmations and full audit logs.' },
  { t: 'P2P & Convert', d: 'Buy USDT with UPI or bank transfer, or swap any coin instantly with zero fees.' },
];

export default function Home() {
  const { user, tradingMode } = useAuth();
  const { t } = useT();
  const [news, setNews] = useState<Announcement[]>([]);
  useEffect(() => { api<Announcement[]>('/api/announcements').then((a) => setNews(a.slice(0, 3))).catch(() => {}); }, []);
  return (
    <div className="mx-auto max-w-[1200px] px-4">
      <section className="grid items-center gap-10 py-14 md:grid-cols-2 md:py-20">
        <div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            {t('home.title1')} <span className="text-brand">{t('home.title2')}</span>.
          </h1>
          <p className="mt-4 max-w-md text-muted">
            {brand} — {t('home.subtitle')}
            {tradingMode === 'paper' && ` ${t('home.bonus')}`}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {user ? (
              <Link href="/trade/BTCUSDT" className="btn-brand px-6 py-3">{t('home.start')}</Link>
            ) : (
              <>
                <Link href="/register" className="btn-brand px-6 py-3">{t('home.create')}</Link>
                <Link href="/markets" className="btn-ghost px-6 py-3">{t('home.explore')}</Link>
              </>
            )}
          </div>
        </div>
        <MarketTable limit={6} compact />
      </section>
      {news.length > 0 && (
        <section className="card mb-6 flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
          <span className="shrink-0 text-sm font-semibold">📣 {t('nav.announcements')}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:gap-6">
            {news.map((n) => <Link key={n.id} href={`/announcements/${n.id}`} className="truncate text-sm text-muted hover:text-fg">{n.title}</Link>)}
          </div>
          <Link href="/announcements" className="shrink-0 text-sm text-brand">More →</Link>
        </section>
      )}
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
