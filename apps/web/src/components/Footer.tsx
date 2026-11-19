'use client';
import Link from 'next/link';
import { brand } from '@/lib/format';
import { useT } from '@/lib/i18n';

export function Footer() {
  const { t } = useT();
  const cols = [
    { title: 'Trade', links: [['/markets', t('nav.markets')], ['/trade/BTCUSDT', 'Spot trading'], ['/convert', t('nav.convert')], ['/p2p', 'P2P']] },
    { title: 'Grow', links: [['/earn', t('nav.earn')], ['/auto-invest', t('nav.autoinvest')], ['/referral', t('nav.referral')]] },
    { title: 'Account', links: [['/wallet', t('nav.wallet')], ['/account?tab=security', 'Security'], ['/account?tab=fees', t('nav.fees')], ['/sub-accounts', t('nav.subaccounts')]] },
    { title: 'Support', links: [['/support', 'Help center'], ['/announcements', t('nav.announcements')], ['/account?tab=api', 'API']] },
  ];
  return (
    <footer className="mt-16 bg-section text-xs text-muted">
      <div className="mx-auto max-w-[1000px] px-6 py-8">
        <p className="border-b border-line pb-4 leading-relaxed">
          Crypto assets are volatile and you can lose some or all of the money you invest. Paper trading mode uses demo funds only. Services are
          available in the United Arab Emirates and India only, subject to identity verification, and are not offered to US persons.
        </p>
        <div className="grid grid-cols-2 gap-6 py-6 sm:grid-cols-4">
          {cols.map((c) => (
            <div key={c.title}>
              <div className="mb-2 font-semibold text-fg">{c.title}</div>
              <ul className="space-y-1.5">
                {c.links.map(([href, label]) => <li key={href}><Link href={href} className="hover:text-fg hover:underline">{label}</Link></li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-4">
          <span>Copyright © {new Date().getFullYear()} {brand}. All rights reserved.</span>
          <span className="sm:ml-auto">United Arab Emirates · India</span>
        </div>
      </div>
    </footer>
  );
}
