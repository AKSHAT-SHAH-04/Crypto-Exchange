function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

export const config = {
  env: env('NODE_ENV', 'development'),
  isProd: env('NODE_ENV', 'development') === 'production',
  port: Number(env('API_PORT', '4000')),
  webUrl: env('WEB_URL', 'http://localhost:3000'),
  redisUrl: env('REDIS_URL', 'redis://localhost:6379'),
  jwtSecret: env('JWT_SECRET'),
  encryptionKey: Buffer.from(env('ENCRYPTION_KEY', '0'.repeat(64)), 'hex'),
  tradingMode: env('TRADING_MODE', 'paper') as 'paper' | 'live',
  signupBonus: env('SIGNUP_BONUS_USDT', '10000'),
  externalFeed: env('EXTERNAL_FEED_ENABLED', 'true') === 'true',
  resendKey: process.env.RESEND_API_KEY || '',
  emailFrom: env('EMAIL_FROM', 'Exchange <no-reply@example.com>'),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  brand: env('NEXT_PUBLIC_BRAND_NAME', 'Crypto Exchange'),
};

if (config.isProd && (config.jwtSecret.startsWith('change-me') || config.jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must be a long random value in production');
}
if (config.encryptionKey.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be 32 bytes of hex (64 chars)');
}
