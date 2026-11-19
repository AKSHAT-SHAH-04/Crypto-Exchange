'use client';
import Link from 'next/link';
import { brand } from '@/lib/format';
import { useT } from '@/lib/i18n';

export function Footer() {
  const { t } = useT();
  const cols = [
    { title: 'Products', links: [['/markets', t('nav.markets')], ['/trade/BTCUSDT', t('nav.trade')], ['/convert', t('nav.convert')], ['/p2p', t('nav.p2p')]] },
    { title: 'Support', links: [['/support', t('nav.support')], ['/announcements', t('nav.announcements')], ['/account?tab=fees', t('nav.fees')], ['/account?tab=api', 'API']] },
  ];
  return (
    <footer className="mt-12 border-t border-line">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <div className="font-bold">{brand}</div>
          <p className="mt-2 text-sm text-muted">Trading crypto carries risk. Paper trading mode uses demo funds only.</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <div className="mb-3 text-sm font-semibold">{c.title}</div>
            <ul className="space-y-2 text-sm text-muted">
              {c.links.map(([href, label]) => <li key={href}><Link href={href} className="hover:text-fg">{label}</Link></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line py-4 text-center text-xs text-muted">© {new Date().getFullYear()} {brand}</div>
    </footer>
  );
}
