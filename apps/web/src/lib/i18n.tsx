'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'es', label: 'Español' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];

type Dict = Record<string, string>;

const en: Dict = {
  'nav.markets': 'Markets', 'nav.trade': 'Trade', 'nav.convert': 'Convert', 'nav.p2p': 'P2P', 'nav.wallet': 'Wallet', 'nav.orders': 'Orders',
  'nav.admin': 'Admin', 'nav.account': 'Account', 'nav.subaccounts': 'Sub-accounts', 'nav.support': 'Support', 'nav.announcements': 'Announcements',
  'nav.notifications': 'Notifications', 'nav.fees': 'Fees', 'nav.login': 'Log in', 'nav.signup': 'Sign up', 'nav.logout': 'Log out',
  'banner.paper': 'Paper trading mode — all funds are demo funds. Prices mirror the live market.',
  'banner.sub': 'You are operating sub-account', 'banner.return': 'Return to main account',
  'home.title1': 'Trade crypto with', 'home.title2': 'confidence', 'home.subtitle': 'A fast spot exchange with pro charts, deep liquidity, P2P and bank-grade security.',
  'home.bonus': 'Start with 10,000 demo USDT, no deposit needed.', 'home.start': 'Start trading', 'home.create': 'Create free account', 'home.explore': 'Explore markets',
  'auth.login': 'Log in', 'auth.welcome': 'Welcome back.', 'auth.email': 'Email', 'auth.password': 'Password', 'auth.forgot': 'Forgot password?',
  'auth.new': 'New here?', 'auth.createAccount': 'Create an account', 'auth.google': 'Continue with Google', 'auth.register': 'Create your account',
  'auth.name': 'Name', 'auth.have': 'Already have an account?', 'auth.agree': 'I agree to the Terms of Service and Privacy Policy.',
  'trade.orderbook': 'Order book', 'trade.trades': 'Market trades', 'trade.price': 'Price', 'trade.amount': 'Amount', 'trade.total': 'Total', 'trade.time': 'Time',
  'trade.available': 'Available', 'trade.buy': 'Buy', 'trade.sell': 'Sell', 'trade.limit': 'Limit', 'trade.market': 'Market', 'trade.stopLimit': 'Stop-limit',
  'trade.oco': 'OCO', 'trade.trailing': 'Trailing stop', 'trade.stop': 'Stop', 'trade.trailingDelta': 'Trail %', 'trade.fee': 'Fee (taker)',
  'trade.spread': 'Spread', 'trade.chart': 'Chart', 'trade.depth': 'Depth', 'trade.alert': 'Alert',
  'wallet.estimated': 'Estimated balance', 'wallet.deposit': 'Deposit', 'wallet.withdraw': 'Withdraw', 'wallet.assets': 'Assets',
  'wallet.history': 'Transaction history', 'wallet.export': 'Export CSV', 'common.cancel': 'Cancel', 'common.save': 'Save', 'common.loading': 'Loading…',
};

const hi: Dict = {
  'nav.markets': 'मार्केट्स', 'nav.trade': 'ट्रेड', 'nav.convert': 'कन्वर्ट', 'nav.p2p': 'P2P', 'nav.wallet': 'वॉलेट', 'nav.orders': 'ऑर्डर्स',
  'nav.admin': 'एडमिन', 'nav.account': 'खाता', 'nav.subaccounts': 'सब-अकाउंट्स', 'nav.support': 'सहायता', 'nav.announcements': 'घोषणाएँ',
  'nav.notifications': 'सूचनाएँ', 'nav.fees': 'शुल्क', 'nav.login': 'लॉग इन', 'nav.signup': 'साइन अप', 'nav.logout': 'लॉग आउट',
  'banner.paper': 'पेपर ट्रेडिंग मोड — सभी फंड डेमो हैं। कीमतें लाइव मार्केट जैसी हैं।',
  'banner.sub': 'आप सब-अकाउंट चला रहे हैं', 'banner.return': 'मुख्य खाते पर लौटें',
  'home.title1': 'भरोसे के साथ', 'home.title2': 'क्रिप्टो ट्रेड करें', 'home.subtitle': 'प्रो चार्ट, गहरी लिक्विडिटी, P2P और बैंक-स्तरीय सुरक्षा वाला तेज़ स्पॉट एक्सचेंज।',
  'home.bonus': '10,000 डेमो USDT से शुरुआत करें, कोई जमा ज़रूरी नहीं।', 'home.start': 'ट्रेडिंग शुरू करें', 'home.create': 'मुफ़्त खाता बनाएँ', 'home.explore': 'मार्केट देखें',
  'auth.login': 'लॉग इन', 'auth.welcome': 'फिर से स्वागत है।', 'auth.email': 'ईमेल', 'auth.password': 'पासवर्ड', 'auth.forgot': 'पासवर्ड भूल गए?',
  'auth.new': 'नए हैं?', 'auth.createAccount': 'खाता बनाएँ', 'auth.google': 'Google से जारी रखें', 'auth.register': 'अपना खाता बनाएँ',
  'auth.name': 'नाम', 'auth.have': 'पहले से खाता है?', 'auth.agree': 'मैं सेवा की शर्तों और गोपनीयता नीति से सहमत हूँ।',
  'trade.orderbook': 'ऑर्डर बुक', 'trade.trades': 'मार्केट ट्रेड्स', 'trade.price': 'कीमत', 'trade.amount': 'मात्रा', 'trade.total': 'कुल', 'trade.time': 'समय',
  'trade.available': 'उपलब्ध', 'trade.buy': 'खरीदें', 'trade.sell': 'बेचें', 'trade.limit': 'लिमिट', 'trade.market': 'मार्केट', 'trade.stopLimit': 'स्टॉप-लिमिट',
  'trade.oco': 'OCO', 'trade.trailing': 'ट्रेलिंग स्टॉप', 'trade.stop': 'स्टॉप', 'trade.trailingDelta': 'ट्रेल %', 'trade.fee': 'शुल्क (टेकर)',
  'trade.spread': 'स्प्रेड', 'trade.chart': 'चार्ट', 'trade.depth': 'डेप्थ', 'trade.alert': 'अलर्ट',
  'wallet.estimated': 'अनुमानित बैलेंस', 'wallet.deposit': 'जमा करें', 'wallet.withdraw': 'निकालें', 'wallet.assets': 'एसेट्स',
  'wallet.history': 'लेन-देन इतिहास', 'wallet.export': 'CSV निर्यात', 'common.cancel': 'रद्द करें', 'common.save': 'सहेजें', 'common.loading': 'लोड हो रहा है…',
};

const es: Dict = {
  'nav.markets': 'Mercados', 'nav.trade': 'Operar', 'nav.convert': 'Convertir', 'nav.p2p': 'P2P', 'nav.wallet': 'Billetera', 'nav.orders': 'Órdenes',
  'nav.admin': 'Admin', 'nav.account': 'Cuenta', 'nav.subaccounts': 'Subcuentas', 'nav.support': 'Soporte', 'nav.announcements': 'Anuncios',
  'nav.notifications': 'Notificaciones', 'nav.fees': 'Comisiones', 'nav.login': 'Iniciar sesión', 'nav.signup': 'Registrarse', 'nav.logout': 'Cerrar sesión',
  'banner.paper': 'Modo de práctica: todos los fondos son de demostración. Los precios reflejan el mercado real.',
  'banner.sub': 'Estás operando la subcuenta', 'banner.return': 'Volver a la cuenta principal',
  'home.title1': 'Opera cripto con', 'home.title2': 'confianza', 'home.subtitle': 'Un exchange spot rápido con gráficos profesionales, alta liquidez, P2P y seguridad bancaria.',
  'home.bonus': 'Empieza con 10.000 USDT de demostración, sin depósito.', 'home.start': 'Empezar a operar', 'home.create': 'Crear cuenta gratis', 'home.explore': 'Explorar mercados',
  'auth.login': 'Iniciar sesión', 'auth.welcome': 'Bienvenido de nuevo.', 'auth.email': 'Correo', 'auth.password': 'Contraseña', 'auth.forgot': '¿Olvidaste tu contraseña?',
  'auth.new': '¿Eres nuevo?', 'auth.createAccount': 'Crea una cuenta', 'auth.google': 'Continuar con Google', 'auth.register': 'Crea tu cuenta',
  'auth.name': 'Nombre', 'auth.have': '¿Ya tienes cuenta?', 'auth.agree': 'Acepto los Términos del servicio y la Política de privacidad.',
  'trade.orderbook': 'Libro de órdenes', 'trade.trades': 'Operaciones', 'trade.price': 'Precio', 'trade.amount': 'Cantidad', 'trade.total': 'Total', 'trade.time': 'Hora',
  'trade.available': 'Disponible', 'trade.buy': 'Comprar', 'trade.sell': 'Vender', 'trade.limit': 'Límite', 'trade.market': 'Mercado', 'trade.stopLimit': 'Stop-límite',
  'trade.oco': 'OCO', 'trade.trailing': 'Stop dinámico', 'trade.stop': 'Stop', 'trade.trailingDelta': 'Margen %', 'trade.fee': 'Comisión (taker)',
  'trade.spread': 'Diferencial', 'trade.chart': 'Gráfico', 'trade.depth': 'Profundidad', 'trade.alert': 'Alerta',
  'wallet.estimated': 'Saldo estimado', 'wallet.deposit': 'Depositar', 'wallet.withdraw': 'Retirar', 'wallet.assets': 'Activos',
  'wallet.history': 'Historial de transacciones', 'wallet.export': 'Exportar CSV', 'common.cancel': 'Cancelar', 'common.save': 'Guardar', 'common.loading': 'Cargando…',
};

const dicts: Record<Lang, Dict> = { en, hi, es };

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (key: string) => string }>({
  lang: 'en',
  setLang: () => {},
  t: (k) => en[k] ?? k,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('lang') as Lang | null;
      if (saved && saved in dicts) setLangState(saved);
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('lang', l); } catch {}
  }, []);
  const t = useCallback((key: string) => dicts[lang][key] ?? en[key] ?? key, [lang]);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);
