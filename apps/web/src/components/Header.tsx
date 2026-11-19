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
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch {}
  };
  return (
    <button onClick={toggle} className="rounded-full p-2 text-muted transition hover:text-fg" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" /></svg>
      )}
    </button>
  );
}

function LangSelect() {
  const { lang, setLang } = useT();
  return (
    <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="cursor-pointer appearance-none rounded-full border-0 bg-transparent px-2 py-1 text-xs text-muted outline-none hover:text-fg">
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
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-xs text-muted transition hover:text-fg" title={user.email} aria-label="Account menu">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-fg text-[11px] font-semibold text-bg">{(user.name || user.email)[0].toUpperCase()}</span>
        <span className="max-w-[110px] truncate">{user.subLabel || user.name || user.email.split('@')[0]}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-2xl border border-line/60 bg-panel/95 py-1.5 shadow-2xl backdrop-blur-xl">
          <div className="truncate border-b border-line/60 px-4 pb-2 pt-1 text-xs text-muted">{user.isSubAccount ? `Sub-account: ${user.subLabel}` : user.email}</div>
          {items.map((i) => (
            <Link key={i.href} href={i.href} onClick={() => setOpen(false)} className="mx-1.5 block rounded-lg px-3 py-2 text-sm hover:bg-panel2">{i.label}</Link>
          ))}
          <button
            className="mx-1.5 mt-1 block w-[calc(100%-12px)] rounded-lg px-3 py-2 text-left text-sm text-down hover:bg-panel2"
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
    <header className="sticky top-0 z-40">
      <div className="border-b border-line/50 bg-bg/70 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-12 max-w-[1200px] items-center gap-6 px-4 lg:px-6">
        <Logo />
        <nav className="hidden flex-1 items-center justify-center gap-0.5 lg:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={clsx('rounded-full px-3 py-1 text-xs transition hover:text-fg', path?.startsWith(l.match ?? l.href) ? 'text-fg' : 'text-fg/70')}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 lg:ml-0">
          <LangSelect />
          <ThemeToggle />
          {user && <NotificationBell />}
          {user ? (
            <div className="hidden lg:block"><AccountMenu /></div>
          ) : (
            <div className="hidden items-center gap-2 lg:flex">
              <Link href="/login" className="px-2 text-xs text-fg/80 hover:text-fg">{t('nav.login')}</Link>
              <Link href="/register" className="btn-brand px-3.5 py-1 text-xs">{t('nav.signup')}</Link>
            </div>
          )}
          <button className="rounded-full p-2 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">{open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}</svg>
          </button>
        </div>
      </div>
      </div>
      {user?.actingFrom ? (
        <div className="flex flex-wrap items-center justify-center gap-2 bg-section px-4 py-2 text-center text-xs">
          {t('banner.sub')} <b>{user.subLabel}</b>
          <button onClick={returnToMain} className="font-medium text-brand hover:underline">{t('banner.return')} ›</button>
        </div>
      ) : (
        tradingMode === 'paper' && <div className="bg-section px-4 py-2 text-center text-xs text-muted">{t('banner.paper')}</div>
      )}
      {open && (
        <div className="border-b border-line/50 bg-bg/95 px-6 py-4 backdrop-blur-xl lg:hidden">
          <nav className="flex flex-col gap-1">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-lg px-2 py-2.5 text-lg font-semibold tracking-tight hover:text-brand">{l.label}</Link>
            ))}
            {user ? (
              <>
                <Link href="/account" className="rounded-lg px-2 py-2.5 text-lg font-semibold tracking-tight hover:text-brand">{t('nav.account')}</Link>
                {!user.isSubAccount && <Link href="/sub-accounts" className="rounded-lg px-2 py-2.5 text-lg font-semibold tracking-tight hover:text-brand">{t('nav.subaccounts')}</Link>}
                <Link href="/support" className="rounded-lg px-2 py-2.5 text-lg font-semibold tracking-tight hover:text-brand">{t('nav.support')}</Link>
                <Link href="/announcements" className="rounded-lg px-2 py-2.5 text-lg font-semibold tracking-tight hover:text-brand">{t('nav.announcements')}</Link>
                <button className="rounded-lg px-2 py-2.5 text-left text-lg font-semibold tracking-tight text-down" onClick={async () => { await logout(); router.push('/login'); }}>{t('nav.logout')}</button>
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
