import type { MetadataRoute } from 'next';

const brand = process.env.NEXT_PUBLIC_BRAND_NAME || 'Zentra';

/** Web app manifest: lets users install the exchange to their home screen like a native app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${brand} — Crypto exchange`,
    short_name: brand,
    description: 'Buy, sell and trade crypto with free bank deposits and low fees.',
    start_url: '/markets',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    categories: ['finance'],
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Trade BTC', url: '/trade/BTCUSDT' },
      { name: 'Wallet', url: '/wallet' },
      { name: 'Convert', url: '/convert' },
    ],
  };
}
