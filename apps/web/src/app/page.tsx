'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { MarketTable } from '@/components/MarketTable';
import { ZentraMark } from '@/components/Logo';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useMarkets, useTickers } from '@/lib/hooks';
import { fmtCompact, fmtPct, fmtPrice } from '@/lib/format';
import type { Announcement, Ticker } from '@/lib/types';

// ---------------- helpers ----------------

/** Fades/slides children in when they scroll into view (respects reduced motion via CSS). */
function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add('reveal-in');
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={clsx('reveal', className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

const COIN_COLORS: Record<string, string> = {
  BTC: '#f7931a', ETH: '#627eea', SOL: '#14f195', BNB: '#f3ba2f', XRP: '#23292f', DOGE: '#c2a633', ADA: '#0033ad',
  AVAX: '#e84142', LINK: '#2a5ada', DOT: '#e6007a', LTC: '#345d9d', TRX: '#ff060a', NEAR: '#00c08b',
};
const GLYPH: Record<string, string> = { BTC: '₿', ETH: 'Ξ', USDT: '₮', DOGE: 'Ð', LTC: 'Ł' };
function CoinMark({ base, size = 28 }: { base: string; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: COIN_COLORS[base] ?? '#8e8e93', fontSize: size * 0.36 }} aria-hidden>
      {GLYPH[base] ?? base[0]}
    </span>
  );
}

function Sparkline({ points, up, height = 80 }: { points: number[]; up: boolean; height?: number }) {
  if (points.length < 2) return <div style={{ height }} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const W = 400;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i / (points.length - 1)) * W} ${height - ((p - min) / (max - min || 1)) * (height - 6) - 3}`).join(' ');
  const color = up ? 'rgb(var(--up))' : 'rgb(var(--down))';
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={`sg-${up}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L ${W} ${height} L 0 ${height} Z`} fill={`url(#sg-${up})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------- sections ----------------

function HeroShowcase({ tickers }: { tickers: Record<string, Ticker> }) {
  const [points, setPoints] = useState<number[]>([]);
  useEffect(() => {
    api<{ close: number }[]>('/api/markets/BTCUSDT/klines?interval=1h&limit=168').then((c) => setPoints(c.map((x) => x.close))).catch(() => {});
  }, []);
  const btc = tickers.BTCUSDT;
  const live = btc?.price ? [...points.slice(0, -1), btc.price] : points;
  const up = (btc?.changePct ?? 0) >= 0;
  const rows = ['ETHUSDT', 'SOLUSDT', 'XRPUSDT'].map((s) => tickers[s]).filter(Boolean) as Ticker[];

  return (
    <div className="relative mx-auto mt-14 max-w-[880px] text-left">
      <div className="pointer-events-none absolute -inset-x-20 -top-10 bottom-0 -z-10 rounded-[60px] bg-[radial-gradient(ellipse_at_top,rgba(0,113,227,0.18),transparent_60%)] blur-2xl" />
      <div className="overflow-hidden rounded-[28px] border border-line/60 bg-panel shadow-[0_30px_80px_-20px_rgba(0,0,0,0.25)]">
        <div className="flex items-center gap-1.5 border-b border-line/60 px-5 py-3">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" /><span className="h-3 w-3 rounded-full bg-[#febc2e]" /><span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-xs text-muted">BTC / USDT · 7D</span>
        </div>
        <div className="grid gap-0 md:grid-cols-[1fr_260px]">
          <div className="p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <CoinMark base="BTC" size={36} />
              <div>
                <div className="text-sm text-muted">Bitcoin</div>
                <div className="num text-3xl font-semibold tracking-tight sm:text-4xl">${fmtPrice(btc?.price, 2)}</div>
              </div>
              <span className={clsx('num ml-auto rounded-full px-3 py-1 text-sm font-medium', up ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>{fmtPct(btc?.changePct ?? 0)}</span>
            </div>
            <div className="mt-6"><Sparkline points={live} up={up} height={150} /></div>
          </div>
          <div className="border-t border-line/60 bg-section/60 p-5 md:border-l md:border-t-0">
            <div className="mb-3 text-xs font-medium text-muted">Watchlist</div>
            <div className="space-y-3">
              {rows.map((t) => (
                <div key={t.symbol} className="flex items-center gap-3">
                  <CoinMark base={t.symbol.replace('USDT', '')} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t.symbol.replace('USDT', '')}</div>
                    <div className="num text-xs text-muted">${fmtPrice(t.price)}</div>
                  </div>
                  <span className={clsx('num text-xs font-medium', t.changePct >= 0 ? 'text-up' : 'text-down')}>{fmtPct(t.changePct)}</span>
                </div>
              ))}
            </div>
            <Link href="/trade/BTCUSDT" className="btn-brand mt-5 w-full py-2">Trade BTC</Link>
          </div>
        </div>
      </div>
      <div className="float absolute -right-48 top-28 hidden rounded-2xl border border-line/60 bg-panel/80 px-4 py-3 shadow-xl backdrop-blur-xl xl:block">
        <div className="text-[11px] text-muted">Order filled</div>
        <div className="text-sm font-medium">Bought 0.05 BTC</div>
      </div>
      <div className="float absolute -left-48 bottom-10 hidden rounded-2xl border border-line/60 bg-panel/80 px-4 py-3 shadow-xl backdrop-blur-xl xl:block" style={{ animationDelay: '-3s' }}>
        <div className="text-[11px] text-muted">Bank deposit</div>
        <div className="text-sm font-medium">+ AED 5,000 · free</div>
      </div>
    </div>
  );
}

function TickerStrip({ tickers }: { tickers: Record<string, Ticker> }) {
  const list = Object.values(tickers).sort((a, b) => b.quoteVolume - a.quoteVolume);
  if (!list.length) return null;
  const items = [...list, ...list];
  return (
    <div className="relative overflow-hidden border-y border-line/60 bg-section py-4 [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
      <div className="marquee flex w-max gap-10">
        {items.map((t, i) => (
          <Link key={`${t.symbol}-${i}`} href={`/trade/${t.symbol}`} className="flex items-center gap-2 text-sm" tabIndex={i >= list.length ? -1 : 0}>
            <CoinMark base={t.symbol.replace('USDT', '')} size={22} />
            <span className="font-medium">{t.symbol.replace('USDT', '')}</span>
            <span className="num text-muted">${fmtPrice(t.price)}</span>
            <span className={clsx('num', t.changePct >= 0 ? 'text-up' : 'text-down')}>{fmtPct(t.changePct)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Tile({ className, eyebrow, title, body, children, dark, href }: { className?: string; eyebrow?: string; title: React.ReactNode; body?: string; children?: React.ReactNode; dark?: boolean; href?: string }) {
  const inner = (
    <div className={clsx('group relative flex h-full flex-col overflow-hidden rounded-[28px] p-8 transition duration-500 hover:scale-[1.01]', dark ? 'bg-[#1d1d1f] text-white' : 'bg-panel')}>
      {eyebrow && <div className={clsx('text-sm font-semibold', dark ? 'text-[#2997ff]' : 'text-brand')}>{eyebrow}</div>}
      <h3 className="headline mt-2 text-2xl leading-tight sm:text-3xl">{title}</h3>
      {body && <p className={clsx('mt-3 max-w-sm text-[15px] leading-relaxed', dark ? 'text-white/70' : 'text-muted')}>{body}</p>}
      <div className="mt-auto pt-6">{children}</div>
    </div>
  );
  return <Reveal className={className}>{href ? <Link href={href} className="block h-full">{inner}</Link> : inner}</Reveal>;
}

function CandlesArt() {
  const candles = [[40, 70, 50, 62], [55, 85, 60, 80], [60, 82, 66, 70], [50, 75, 55, 58], [45, 66, 48, 63], [58, 92, 64, 88], [70, 98, 80, 94], [75, 96, 78, 82], [72, 104, 84, 100], [86, 118, 92, 112]];
  return (
    <svg viewBox="0 0 300 130" className="w-full" aria-hidden>
      {candles.map(([lo, hi, a, b], i) => {
        const up = b >= a;
        const x = 15 + i * 28;
        const y = (v: number) => 125 - v;
        return (
          <g key={i} stroke={up ? '#30d158' : '#ff453a'} fill={up ? '#30d158' : '#ff453a'}>
            <line x1={x} x2={x} y1={y(hi)} y2={y(lo)} strokeWidth="2" />
            <rect x={x - 7} y={y(Math.max(a, b))} width="14" height={Math.max(3, Math.abs(b - a))} rx="2" />
          </g>
        );
      })}
    </svg>
  );
}

export default function Home() {
  const { user, tradingMode } = useAuth();
  const { t } = useT();
  const tickers = useTickers();
  const markets = useMarkets();
  const [news, setNews] = useState<Announcement[]>([]);
  useEffect(() => {
    api<Announcement[]>('/api/announcements').then((a) => setNews(a.slice(0, 1))).catch(() => {});
  }, []);
  const totalVolume = useMemo(() => Object.values(tickers).reduce((s, x) => s + (x.quoteVolume || 0), 0), [tickers]);
  const cta = user ? { href: '/trade/BTCUSDT', label: t('home.start') } : { href: '/register', label: t('home.create') };

  return (
    <div className="overflow-x-hidden">
      {/* ---------- Hero ---------- */}
      <section className="px-6 pb-20 pt-14 text-center sm:pt-20">
        {news[0] && (
          <Link href={`/announcements/${news[0].id}`} className="mx-auto mb-6 inline-flex max-w-full items-center gap-2 rounded-full bg-section px-4 py-1.5 text-xs text-muted transition hover:text-fg">
            <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-white">New</span>
            <span className="truncate">{news[0].title}</span>
            <span aria-hidden>›</span>
          </Link>
        )}
        <Reveal>
          <h1 className="headline mx-auto max-w-4xl text-5xl leading-[1.05] sm:text-7xl">
            {t('home.title1')}
            <br />
            <span className="bg-gradient-to-r from-[#0071e3] via-[#5e5ce6] to-[#30c48d] bg-clip-text text-transparent">{t('home.title2')}</span>
          </h1>
        </Reveal>
        <Reveal delay={100}>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted sm:text-xl">
            {t('home.subtitle')}
            {tradingMode === 'paper' && <> {t('home.bonus')}</>}
          </p>
        </Reveal>
        <Reveal delay={200}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href={cta.href} className="btn-brand px-7 py-3 text-base">{cta.label}</Link>
            <Link href="/markets" className="link-arrow text-base">{t('home.explore')} ›</Link>
          </div>
        </Reveal>
        <Reveal delay={300}>
          <HeroShowcase tickers={tickers} />
        </Reveal>
      </section>

      <TickerStrip tickers={tickers} />

      {/* ---------- Features ---------- */}
      <section className="bg-section px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-[1100px]">
          <Reveal className="mb-12 text-center">
            <h2 className="headline text-4xl sm:text-6xl">Everything you need.<br /><span className="text-muted">Nothing you don&apos;t.</span></h2>
          </Reveal>
          <div className="grid auto-rows-[minmax(280px,auto)] gap-5 md:grid-cols-6">
            <Tile className="md:col-span-4" dark eyebrow="Pro trading" title="A trading screen that keeps up with you." body="Live order book, depth chart and candles. Limit, market, stop-limit, OCO and trailing-stop orders — matched in real time." href="/trade/BTCUSDT">
              <CandlesArt />
            </Tile>
            <Tile className="md:col-span-2" eyebrow="Low fees" title={<><span className="text-6xl sm:text-7xl">0.1%</span><br />max trading fee.</>} body="Even lower with VIP tiers and the fee-discount token." href="/account?tab=fees" />
            <Tile className="md:col-span-2" eyebrow="Convert" title="Swap any coin in one tap." body="Guaranteed quote. Zero trading fees." href="/convert">
              <div className="flex items-center justify-center gap-3 text-sm font-medium">
                <span className="flex items-center gap-2 rounded-full bg-panel2 px-3 py-1.5"><CoinMark base="ETH" size={20} />ETH</span>
                <span className="text-muted">→</span>
                <span className="flex items-center gap-2 rounded-full bg-panel2 px-3 py-1.5"><CoinMark base="BTC" size={20} />BTC</span>
              </div>
            </Tile>
            <Tile className="md:col-span-2" eyebrow="Cash in, cash out" title="Free bank deposits." body="Fund in AED or INR by bank transfer — no fees from us. Or pay by card and Apple Pay through licensed partners." href="/wallet" />
            <Tile className="md:col-span-2" eyebrow="P2P" title="Trade directly. Escrow protected." body="Pay with Aani, UPI or bank transfer. Crypto stays in escrow until the seller confirms." href="/p2p" />
            <Tile className="md:col-span-3" dark eyebrow="Security" title="Your account. Locked down." body="Two-factor authentication, withdrawal whitelists with a 24-hour hold, email confirmations, institutional custody and a full activity log.">
              <svg viewBox="0 0 24 24" className="h-16 w-16 text-[#30d158]" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg>
            </Tile>
            <Tile className="md:col-span-3" eyebrow="For builders" title="An API for your strategies." body="HMAC-signed API keys with read or trade permissions, sub-accounts for each bot, and real-time WebSocket feeds." href="/account?tab=api">
              <pre className="num overflow-hidden rounded-xl bg-panel2 p-4 text-[12px] leading-relaxed text-muted">{`POST /api/orders
{ "symbol": "BTCUSDT", "side": "BUY",
  "type": "LIMIT", "price": "64000",
  "quantity": "0.01" }`}</pre>
            </Tile>
          </div>
        </div>
      </section>

      {/* ---------- Markets ---------- */}
      <section className="px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-[1000px]">
          <Reveal className="mb-10 flex flex-wrap items-end gap-4">
            <div>
              <div className="eyebrow">Markets</div>
              <h2 className="headline mt-2 text-4xl sm:text-5xl">Today&apos;s prices.</h2>
            </div>
            <Link href="/markets" className="link-arrow ml-auto">All {markets.length || ''} markets ›</Link>
          </Reveal>
          <Reveal><MarketTable limit={8} compact /></Reveal>
        </div>
      </section>

      {/* ---------- Numbers ---------- */}
      <section className="bg-[#1d1d1f] px-6 py-24 text-white">
        <div className="mx-auto grid max-w-[1000px] gap-12 text-center sm:grid-cols-4">
          {[
            [`$${fmtCompact(totalVolume)}`, '24h market volume tracked'],
            ['0', 'fees on bank deposits'],
            ['0.1%', 'maximum trading fee'],
            ['24/7', 'markets never close'],
          ].map(([v, l], i) => (
            <Reveal key={l} delay={i * 80}>
              <div className="num headline text-5xl">{v}</div>
              <div className="mt-2 text-sm text-white/60">{l}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- Regions ---------- */}
      <section className="px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-[1000px]">
          <Reveal className="mb-12 text-center">
            <h2 className="headline text-4xl sm:text-5xl">Built for where you are.</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-muted">Local currency, local payment rails, local support.</p>
          </Reveal>
          <div className="grid gap-5 md:grid-cols-2">
            {[
              { flag: '🇦🇪', name: 'United Arab Emirates', cur: 'AED', rails: 'Instant transfers (Aani / IPP) and bank transfer', p2p: 'Aani and UAE bank transfer' },
              { flag: '🇮🇳', name: 'India', cur: 'INR', rails: 'IMPS, NEFT and RTGS bank transfer', p2p: 'UPI, IMPS and bank transfer' },
            ].map((r, i) => (
              <Reveal key={r.cur} delay={i * 100}>
                <div className="h-full rounded-[28px] bg-section p-8">
                  <div className="text-5xl" aria-hidden>{r.flag}</div>
                  <h3 className="headline mt-4 text-2xl">{r.name}</h3>
                  <dl className="mt-5 space-y-3 text-[15px]">
                    <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">Currency</dt><dd>{r.cur}</dd></div>
                    <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">Deposits</dt><dd>{r.rails} — free</dd></div>
                    <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">P2P</dt><dd>{r.p2p}</dd></div>
                  </dl>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="px-6 pb-12 pt-8 text-center">
        <Reveal>
          <ZentraMark size={72} className="mx-auto mb-6 drop-shadow-[0_12px_30px_rgba(94,92,230,0.35)]" />
          <h2 className="headline text-5xl sm:text-6xl">Start in minutes.</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted">Create an account, verify your identity, and make your first trade — all from your phone or desktop.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href={cta.href} className="btn-brand px-7 py-3 text-base">{cta.label}</Link>
            <Link href="/support" className="link-arrow text-base">Questions? Visit support ›</Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
