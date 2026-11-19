import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/Toast';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { I18nProvider } from '@/lib/i18n';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });
const brand = process.env.NEXT_PUBLIC_BRAND_NAME || 'Crypto Exchange';

export const metadata: Metadata = {
  title: { default: `${brand} — Trade crypto`, template: `%s | ${brand}` },
  description: 'Spot crypto exchange with live markets, advanced charts and a real matching engine.',
};
export const viewport: Viewport = { themeColor: '#0b0d12', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">
        <I18nProvider>
          <AuthProvider>
            <ToastProvider>
              <Header />
              <main className="min-h-[calc(100vh-200px)]">{children}</main>
              <Footer />
            </ToastProvider>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
