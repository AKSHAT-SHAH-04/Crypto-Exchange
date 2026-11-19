import Link from 'next/link';
import { brand } from '@/lib/format';

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgb(var(--brand))" />
            <stop offset="1" stopColor="rgb(var(--up))" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#lg)" />
        <path d="M10 20l4-5 3 3 5-7" stroke="white" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[17px]">{brand}</span>
    </Link>
  );
}
