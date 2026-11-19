import Link from 'next/link';
import { brand } from '@/lib/format';

export function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight" aria-label={`${brand} home`}>
      <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0071e3" />
            <stop offset="1" stopColor="#30c48d" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#lg)" />
        <path d="M9.5 20.5l4.5-5.5 3.5 3.5 5.5-8" stroke="white" strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{brand}</span>
    </Link>
  );
}
