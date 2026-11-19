function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const json = <T>(name: string, fallback: T): T => {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
};

const tradingMode = env('TRADING_MODE', 'paper') as 'paper' | 'live';
if (!['paper', 'live'].includes(tradingMode)) throw new Error('TRADING_MODE must be "paper" or "live"');

export interface BankDetails {
  bankName: string;
  accountName: string;
  /** AE: IBAN, IN: account number, US: account number */
  accountNumber: string;
  /** AE: SWIFT/BIC, IN: IFSC, US: ACH routing number */
  routingCode: string;
  extra?: string;
}

export const config = {
  env: env('NODE_ENV', 'development'),
  isProd: env('NODE_ENV', 'development') === 'production',
  // PaaS hosts (Railway, Render, Fly) inject PORT
  port: Number(process.env.PORT || env('API_PORT', '4000')),
  webUrl: env('WEB_URL', 'http://localhost:3000'),
  redisUrl: env('REDIS_URL', 'redis://localhost:6379'),
  jwtSecret: env('JWT_SECRET'),
  encryptionKey: Buffer.from(env('ENCRYPTION_KEY', '0'.repeat(64)), 'hex'),
  tradingMode,
  isLive: tradingMode === 'live',
  signupBonus: env('SIGNUP_BONUS_USDT', '10000'),
  externalFeed: env('EXTERNAL_FEED_ENABLED', 'true') === 'true',
  /** Seconds without a real price update before a market is treated as stale (live mode halts it). */
  priceStaleSeconds: Number(env('PRICE_STALE_SECONDS', '30')),
  /** The demo market maker trades with unlimited funds, so it is only allowed in paper mode. */
  marketMakerEnabled: env('MARKET_MAKER_ENABLED', tradingMode === 'paper' ? 'true' : 'false') === 'true',
  /** Number of reverse proxies in front of the API (0 = direct). Controls trust of X-Forwarded-For. */
  trustProxyHops: Number(env('TRUST_PROXY_HOPS', '0')),
  resendKey: process.env.RESEND_API_KEY || '',
  emailFrom: env('EMAIL_FROM', 'Exchange <no-reply@example.com>'),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  brand: env('NEXT_PUBLIC_BRAND_NAME', 'Zentra'),

  // ---------- jurisdictions ----------
  /** If set, only residents of these ISO-2 countries can complete KYC. */
  allowedCountries: list(env('ALLOWED_COUNTRIES', 'AE,IN')),
  /** Blocked by KYC country and by IP country header. */
  blockedCountries: list(env('BLOCKED_COUNTRIES', 'US')),
  /** Header set by your CDN/edge with the client's ISO-2 country (Cloudflare: cf-ipcountry). */
  geoIpHeader: env('GEO_IP_HEADER', 'cf-ipcountry').toLowerCase(),

  // ---------- custody ----------
  custodyProvider: env('CUSTODY_PROVIDER', 'demo') as 'demo' | 'fireblocks',
  fireblocks: {
    baseUrl: env('FIREBLOCKS_BASE_URL', 'https://sandbox-api.fireblocks.io'),
    apiKey: process.env.FIREBLOCKS_API_KEY || '',
    /** PEM private key (literal, with \n escapes) or base64 of the PEM */
    secretKey: process.env.FIREBLOCKS_SECRET_KEY || '',
    vaultAccountId: process.env.FIREBLOCKS_VAULT_ACCOUNT_ID || '',
    webhookPublicKey: process.env.FIREBLOCKS_WEBHOOK_PUBLIC_KEY || '',
    /** Maps "<ASSET>:<NETWORK>" to a Fireblocks asset id, e.g. {"USDT:TRC20":"TRX_USDT_S2UK"} */
    assetMap: json<Record<string, string>>('FIREBLOCKS_ASSET_MAP', {
      'BTC:BTC': 'BTC',
      'ETH:ERC20': 'ETH',
      'USDT:ERC20': 'USDT_ERC20',
      'USDT:TRC20': 'TRX_USDT_S2UK',
      'SOL:SOL': 'SOL',
      'TRX:TRC20': 'TRX',
    }),
  },

  // ---------- fiat rails ----------
  fiatCurrencies: list(env('FIAT_CURRENCIES', 'AED,INR,USD')),
  /** Which fiat currency each country banks in. */
  countryCurrency: json<Record<string, string>>('COUNTRY_CURRENCY', { AE: 'AED', IN: 'INR', US: 'USD' }),
  /** Company collection account per currency, shown as deposit instructions. */
  bankDetails: json<Record<string, BankDetails>>('FIAT_BANK_DETAILS', {}),
  /** HMAC secret for bank-partner credit/payout webhooks (empty = webhook disabled). */
  bankWebhookSecret: process.env.BANK_WEBHOOK_SECRET || '',
  /** Flat fiat withdrawal fee per currency (deposits by bank transfer are free). */
  fiatWithdrawFee: json<Record<string, string>>('FIAT_WITHDRAW_FEE', { AED: '0', INR: '0', USD: '0' }),
  fiatMinWithdraw: json<Record<string, string>>('FIAT_MIN_WITHDRAW', { AED: '50', INR: '1000', USD: '20' }),
  /** Static fallback FX (units per 1 USD) used when the live FX source is unreachable. AED is pegged. */
  fxFallback: json<Record<string, number>>('FX_FALLBACK', { AED: 3.6725, INR: 88.5, USD: 1 }),
  fxUrl: env('FX_RATES_URL', 'https://open.er-api.com/v6/latest/USD'),

  // ---------- on/off-ramp partners ----------
  ramp: {
    /** onramper (aggregator: picks the cheapest provider per quote) | transak | none */
    provider: env('RAMP_PROVIDER', 'onramper') as 'onramper' | 'transak' | 'none',
    onramperApiKey: process.env.ONRAMPER_API_KEY || '',
    onramperSecret: process.env.ONRAMPER_SIGNING_SECRET || '',
    onramperWebhookSecret: process.env.ONRAMPER_WEBHOOK_SECRET || '',
    transakApiKey: process.env.TRANSAK_API_KEY || '',
    transakEnv: env('TRANSAK_ENV', 'STAGING') as 'STAGING' | 'PRODUCTION',
    transakWebhookSecret: process.env.TRANSAK_WEBHOOK_SECRET || '',
  },
};

// ---------- startup safety checks ----------
const fail = (m: string) => {
  throw new Error(`[config] ${m}`);
};
if (config.encryptionKey.length !== 32) fail('ENCRYPTION_KEY must be 32 bytes of hex (64 chars)');
if (config.isProd) {
  if (config.jwtSecret.startsWith('change-me') || config.jwtSecret.length < 32) fail('JWT_SECRET must be a long random value in production');
  if (config.encryptionKey.equals(Buffer.alloc(32))) fail('ENCRYPTION_KEY must not be all zeros in production');
  if (!config.webUrl.startsWith('https://')) fail('WEB_URL must be https in production');
}
if (config.isLive) {
  if (!config.isProd) fail('TRADING_MODE=live requires NODE_ENV=production');
  if (config.marketMakerEnabled) fail('MARKET_MAKER_ENABLED must be false in live mode (the demo market maker has unlimited funds)');
  if (config.custodyProvider === 'demo') fail('CUSTODY_PROVIDER=demo is not allowed in live mode — configure a real custodian');
  if (!config.externalFeed) fail('EXTERNAL_FEED_ENABLED must be true in live mode (no simulated prices)');
  if (!config.resendKey) fail('RESEND_API_KEY is required in live mode (withdrawal confirmations, password resets)');
}
if (config.custodyProvider === 'fireblocks') {
  const f = config.fireblocks;
  if (!f.apiKey || !f.secretKey || !f.vaultAccountId || !f.webhookPublicKey) {
    fail('Fireblocks custody needs FIREBLOCKS_API_KEY, FIREBLOCKS_SECRET_KEY, FIREBLOCKS_VAULT_ACCOUNT_ID and FIREBLOCKS_WEBHOOK_PUBLIC_KEY');
  }
}
