'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Logo } from './Logo';
import { NotificationBell } from './NotificationBell';
import { useAuth } from '@/lib/auth';
import { useT, LANGUAGES, type Lang } from '@/lib/i18n';
import { api } from '@/lib/api';

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

function LangSelect() {
  const { lang, setLang } = useT();
  return (
    <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="rounded-md border-0 bg-transparent py-1 pl-1 pr-6 text-xs text-muted outline-none hover:text-fg">
      {LANGUAGES.map((l) => <option key={l.code} value={l.code} className="bg-panel text-fg">{l.label}</option>)}
    </select>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (!user) return null;
  const items = [
    { href: '/account', label: t('nav.account') },
    ...(!user.isSubAccount ? [{ href: '/sub-accounts', label: t('nav.subaccounts') }] : []),
    { href: '/account?tab=fees', label: t('nav.fees') },
    { href: '/support', label: t('nav.support') },
    { href: '/announcements', label: t('nav.announcements') },
  ];
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted hover:text-fg" title={user.email}>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/20 text-xs font-bold text-brand">{(user.name || user.email)[0].toUpperCase()}</span>
        <span className="max-w-[120px] truncate">{user.subLabel || user.name || user.email.split('@')[0]}</span> ▾
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-xl">
          <div className="truncate border-b border-line px-4 py-2 text-xs text-muted">{user.isSubAccount ? `Sub-account: ${user.subLabel}` : user.email}</div>
          {items.map((i) => (
            <Link key={i.href} href={i.href} onClick={() => setOpen(false)} className="block px-4 py-2 text-sm hover:bg-panel2">{i.label}</Link>
          ))}
          <button
            className="block w-full border-t border-line px-4 py-2 text-left text-sm text-down hover:bg-panel2"
            onClick={async () => {
              await logout();
              router.push('/login');
            }}
          >
            {t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { user, logout, tradingMode, refresh } = useAuth();
  const { t } = useT();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const links = [
    { href: '/markets', label: t('nav.markets') },
    { href: '/trade/BTCUSDT', label: t('nav.trade'), match: '/trade' },
    { href: '/convert', label: t('nav.convert') },
    { href: '/p2p', label: t('nav.p2p') },
    ...(user ? [{ href: '/wallet', label: t('nav.wallet') }, { href: '/orders', label: t('nav.orders') }] : []),
    ...(user?.role === 'ADMIN' ? [{ href: '/admin', label: t('nav.admin') }] : []),
  ];

  const returnToMain = async () => {
    await api('/api/subaccounts/return', { method: 'POST' });
    await refresh();
    router.push('/sub-accounts');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
      {user?.actingFrom ? (
        <div className="flex flex-wrap items-center justify-center gap-2 bg-up/15 px-4 py-1 text-center text-xs">
          {t('banner.sub')} <b>{user.subLabel}</b>
          <button onClick={returnToMain} className="font-semibold text-brand underline">{t('banner.return')}</button>
        </div>
      ) : (
        tradingMode === 'paper' && <div className="bg-brand/15 px-4 py-1 text-center text-xs text-fg">{t('banner.paper')}</div>
      )}
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex">
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
        <div className="ml-auto flex items-center gap-1">
          <LangSelect />
          <ThemeToggle />
          {user && <NotificationBell />}
          {user ? (
            <div className="hidden lg:block"><AccountMenu /></div>
          ) : (
            <div className="hidden items-center gap-2 lg:flex">
              <Link href="/login" className="btn-ghost py-1.5">{t('nav.login')}</Link>
              <Link href="/register" className="btn-brand py-1.5">{t('nav.signup')}</Link>
            </div>
          )}
          <button className="rounded-md p-2 text-xl lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">☰</button>
        </div>
      </div>
      {open && (
        <div className="border-t border-line px-4 py-3 lg:hidden">
          <nav className="flex flex-col gap-1">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-md px-2 py-2 text-sm hover:bg-panel2">{l.label}</Link>
            ))}
            {user ? (
              <>
                <Link href="/account" className="rounded-md px-2 py-2 text-sm hover:bg-panel2">{t('nav.account')}</Link>
                {!user.isSubAccount && <Link href="/sub-accounts" className="rounded-md px-2 py-2 text-sm hover:bg-panel2">{t('nav.subaccounts')}</Link>}
                <Link href="/support" className="rounded-md px-2 py-2 text-sm hover:bg-panel2">{t('nav.support')}</Link>
                <Link href="/announcements" className="rounded-md px-2 py-2 text-sm hover:bg-panel2">{t('nav.announcements')}</Link>
                <button className="rounded-md px-2 py-2 text-left text-sm text-down hover:bg-panel2" onClick={async () => { await logout(); router.push('/login'); }}>{t('nav.logout')}</button>
              </>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link href="/login" className="btn-ghost">{t('nav.login')}</Link>
                <Link href="/register" className="btn-brand">{t('nav.signup')}</Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
