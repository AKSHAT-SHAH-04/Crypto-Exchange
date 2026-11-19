import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { config } from './config.js';
import { prisma } from './db.js';
import { redis } from './redis.js';
import { CSRF_COOKIE, resolveUser } from './lib/auth.js';
import { safeEqual } from './lib/crypto.js';
import { HttpError } from './lib/errors.js';
import { initEngine, listPairs } from './engine/engine.js';
import { startMarketMaker } from './engine/marketMaker.js';
import { startFeed, startFeedLoops } from './market/feed.js';
import { registerGateway } from './ws/gateway.js';
import { authRoutes } from './routes/auth.js';
import { marketRoutes } from './routes/markets.js';
import { orderRoutes } from './routes/orders.js';
import { walletRoutes } from './routes/wallet.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { convertRoutes } from './routes/convert.js';
import { alertRoutes } from './routes/alerts.js';
import { feeRoutes } from './routes/fees.js';
import { notificationRoutes } from './routes/notifications.js';
import { announcementRoutes } from './routes/announcements.js';
import { supportRoutes } from './routes/support.js';
import { subAccountRoutes } from './routes/subaccounts.js';
import { exportRoutes } from './routes/export.js';
import { p2pRoutes } from './routes/p2p.js';
import { initAlerts } from './engine/alerts.js';
import { fiatRoutes } from './routes/fiat.js';
import { rampRoutes } from './routes/ramp.js';
import { webhookRoutes } from './routes/webhooks.js';
import { initTreasury } from './lib/treasury.js';
import { startFx } from './lib/fx.js';

const app = Fastify({
  logger: { level: config.isProd ? 'info' : 'warn' },
  // Only trust X-Forwarded-For from the configured number of proxy hops (spoofable otherwise).
  trustProxy: config.trustProxyHops > 0 ? config.trustProxyHops : false,
  bodyLimit: 64 * 1024,
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: config.webUrl, credentials: true });
await app.register(cookie);
await app.register(rateLimit, { max: 600, timeWindow: '1 minute', redis });
await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

// Authenticate (cookie session or signed API key) after the body is parsed, then enforce CSRF.
app.addHook('preValidation', async (req, reply) => {
  await resolveUser(req);
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  // Server-to-server webhooks authenticate with their own signatures instead of CSRF tokens.
  const route = req.routeOptions.url ?? '';
  const isWebhook = route.startsWith('/api/webhooks/');
  if (unsafe && !isWebhook && req.authVia !== 'apikey') {
    const header = String(req.headers['x-csrf-token'] ?? '');
    const cookieVal = req.cookies[CSRF_COOKIE] ?? '';
    if (!header || !cookieVal || !safeEqual(header, cookieVal)) {
      return reply.code(403).send({ error: 'Invalid CSRF token. Refresh the page and try again.' });
    }
  }

  // Geo-restriction: blocked countries (by edge IP header or KYC residence) can't open accounts or move/trade
  // funds. They can still log in, cancel orders, withdraw their own money and contact support.
  if (unsafe && !isWebhook) {
    const ipCountry = String(req.headers[config.geoIpHeader] ?? '').toUpperCase();
    const blocked = (c?: string | null) => !!c && config.blockedCountries.includes(c);
    if (blocked(ipCountry) || blocked(req.user?.country)) {
      const allowed =
        ['/api/auth/login', '/api/auth/login/2fa', '/api/auth/logout', '/api/auth/logout-all', '/api/wallet/withdraw', '/api/wallet/withdraw/confirm',
          '/api/wallet/withdraw/:id/cancel', '/api/wallet/addresses', '/api/fiat/withdraw', '/api/fiat/bank-accounts', '/api/orders/:id', '/api/orders'].includes(route) &&
        !(route === '/api/orders' && req.method === 'POST');
      if (!allowed && !route.startsWith('/api/support/') && !route.startsWith('/api/notifications')) {
        return reply.code(451).send({ error: 'This service is not available in your region.', code: 'GEO_BLOCKED' });
      }
    }
  }
});

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return reply.code(400).send({ error: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input', issues: err.issues });
  }
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
  if ((err as any).statusCode && (err as any).statusCode < 500) return reply.code((err as any).statusCode).send({ error: err.message });
  req.log.error(err);
  console.error(err);
  return reply.code(500).send({ error: 'Internal server error' });
});

// Liveness + dependency check for load balancers / uptime monitors.
app.get('/api/health', async (_req, reply) => {
  const checks: Record<string, boolean> = {};
  checks.db = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  checks.redis = await redis.ping().then((r) => r === 'PONG').catch(() => false);
  const ok = Object.values(checks).every(Boolean);
  return reply.code(ok ? 200 : 503).send({ ok, checks, mode: config.tradingMode, time: Date.now() });
});

/** Public, non-secret configuration the web app needs. */
app.get('/api/meta', async () => ({
  tradingMode: config.tradingMode,
  allowedCountries: config.allowedCountries,
  blockedCountries: config.blockedCountries,
  countryCurrency: config.countryCurrency,
  fiatCurrencies: config.fiatCurrencies,
  rampProvider: config.ramp.provider,
}));

await registerGateway(app);
await app.register(authRoutes);
await app.register(marketRoutes);
await app.register(orderRoutes);
await app.register(walletRoutes);
await app.register(accountRoutes);
await app.register(adminRoutes);
await app.register(convertRoutes);
await app.register(alertRoutes);
await app.register(feeRoutes);
await app.register(notificationRoutes);
await app.register(announcementRoutes);
await app.register(supportRoutes);
await app.register(subAccountRoutes);
await app.register(exportRoutes);
await app.register(p2pRoutes);
await app.register(fiatRoutes);
await app.register(rampRoutes);
await app.register(webhookRoutes);

await initTreasury();
startFx();
await initEngine();
await initAlerts();
await startFeed(listPairs().filter((p) => p.enabled).map((p) => ({ symbol: p.symbol, seedPrice: p.seedPrice.toNumber() })));
startFeedLoops();
if (config.marketMakerEnabled) startMarketMaker();
else console.log('[mm] market maker disabled (liquidity comes from users and API market makers)');

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`[api] listening on http://localhost:${config.port} (mode: ${config.tradingMode})`);

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
