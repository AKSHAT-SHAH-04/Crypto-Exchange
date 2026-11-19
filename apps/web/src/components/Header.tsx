'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Logo } from './Logo';
import { useAuth } from '@/lib/auth';

function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem('theme'); } catch {}
    const isLight = saved === 'light';
    setLight(isLight);
    document.documentElement.classList.toggle('light', isLight);
  }, []);
  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle('light', next);
    try { localStorage.setItem('theme', next ? 'light' : 'dark'); } catch {}
  };
  return (
    <button onClick={toggle} className="rounded-md p-2 text-muted hover:bg-panel2 hover:text-fg" aria-label="Toggle theme">
      {light ? '☾' : '☀'}
    </button>
  );
}

export function Header() {
  const { user, logout, tradingMode } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const links = [
    { href: '/markets', label: 'Markets' },
    { href: '/trade/BTCUSDT', label: 'Trade', match: '/trade' },
    ...(user ? [{ href: '/wallet', label: 'Wallet' }, { href: '/orders', label: 'Orders' }] : []),
    ...(user?.role === 'ADMIN' ? [{ href: '/admin', label: 'Admin' }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
      {tradingMode === 'paper' && (
        <div className="bg-brand/15 px-4 py-1 text-center text-xs text-fg">
          Paper trading mode — all funds are demo funds. Prices mirror the live market.
        </div>
      )}
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={clsx('rounded-md px-3 py-1.5 text-sm font-medium hover:text-fg', path?.startsWith(l.match ?? l.href) ? 'text-fg' : 'text-muted')}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <div className="hidden items-center gap-2 md:flex">
              <Link href="/account" className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-fg" title={user.email}>
                {user.name || user.email.split('@')[0]}
              </Link>
              <button
                className="btn-ghost py-1.5"
                onClick={async () => {
                  await logout();
                  router.push('/login');
                }}
              >
                Log out
              </button>
            </div>
          ) : (
            <div className="hidden items-center gap-2 md:flex">
              <Link href="/login" className="btn-ghost py-1.5">Log in</Link>
              <Link href="/register" className="btn-brand py-1.5">Sign up</Link>
            </div>
          )}
          <button className="rounded-md p-2 text-xl md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">☰</button>
        </div>
      </div>
      {open && (
        <div className="border-t border-line px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-md px-2 py-2 text-sm hover:bg-panel2">{l.label}</Link>
            ))}
            {user ? (
              <>
                <Link href="/account" className="rounded-md px-2 py-2 text-sm hover:bg-panel2">Account</Link>
                <button className="rounded-md px-2 py-2 text-left text-sm hover:bg-panel2" onClick={async () => { await logout(); router.push('/login'); }}>Log out</button>
              </>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link href="/login" className="btn-ghost">Log in</Link>
                <Link href="/register" className="btn-brand">Sign up</Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
