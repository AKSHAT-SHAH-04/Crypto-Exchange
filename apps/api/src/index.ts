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

const app = Fastify({
  logger: { level: config.isProd ? 'info' : 'warn' },
  trustProxy: true,
  bodyLimit: 64 * 1024,
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: config.webUrl, credentials: true });
await app.register(cookie);
await app.register(rateLimit, { max: 600, timeWindow: '1 minute', redis });
await app.register(websocket);

// Authenticate (cookie session or signed API key) after the body is parsed, then enforce CSRF.
app.addHook('preValidation', async (req, reply) => {
  await resolveUser(req);
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (unsafe && req.url.startsWith('/api/') && req.authVia !== 'apikey') {
    const header = String(req.headers['x-csrf-token'] ?? '');
    const cookieVal = req.cookies[CSRF_COOKIE] ?? '';
    if (!header || !cookieVal || !safeEqual(header, cookieVal)) {
      return reply.code(403).send({ error: 'Invalid CSRF token. Refresh the page and try again.' });
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

app.get('/api/health', async () => ({ ok: true, mode: config.tradingMode, time: Date.now() }));

await registerGateway(app);
await app.register(authRoutes);
await app.register(marketRoutes);
await app.register(orderRoutes);
await app.register(walletRoutes);
await app.register(accountRoutes);
await app.register(adminRoutes);

await initEngine();
await startFeed(listPairs().filter((p) => p.enabled).map((p) => ({ symbol: p.symbol, seedPrice: p.seedPrice.toNumber() })));
startFeedLoops();
startMarketMaker();

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`[api] listening on http://localhost:${config.port} (mode: ${config.tradingMode})`);

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
