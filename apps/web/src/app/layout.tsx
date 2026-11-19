import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/Toast';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { I18nProvider } from '@/lib/i18n';
import { ServiceWorker } from '@/components/ServiceWorker';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const brand = process.env.NEXT_PUBLIC_BRAND_NAME || 'Zentra';

export const metadata: Metadata = {
  title: { default: `${brand} — Trade crypto`, template: `%s | ${brand}` },
  description: 'Spot crypto exchange with live markets, advanced charts and a real matching engine.',
  applicationName: brand,
  appleWebApp: { capable: true, title: brand, statusBarStyle: 'default' },
};
export const viewport: Viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#ffffff' }, { media: '(prefers-color-scheme: dark)', color: '#000000' }],
  width: 'device-width',
  initialScale: 1,
};

// Apply the saved theme before first paint (no flash).
const themeScript = `try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans">
        <ServiceWorker />
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
