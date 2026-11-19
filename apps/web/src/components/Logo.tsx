import Link from 'next/link';
import { useId } from 'react';
import { brand } from '@/lib/format';

/**
 * Zentra mark: a "Z" split into two slanted bars — the two sides of a trade meeting in the middle.
 * Gradient runs blue → indigo → mint. Brand files: /public/brand/.
 */
export function ZentraMark({ size = 22, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id={`zg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0a84ff" />
          <stop offset=".55" stopColor="#5e5ce6" />
          <stop offset="1" stopColor="#30d1a0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#zg${id})`} />
      <path d="M8.5 8.5h15l-5.6 6H8.5z" fill="#fff" />
      <path d="M23.5 23.5h-15l5.6-6h9.4z" fill="#fff" fillOpacity=".72" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={`${brand} home`}>
      <ZentraMark size={22} />
      <span className="text-[17px] font-semibold tracking-[-0.03em]">{brand}</span>
    </Link>
  );
}
