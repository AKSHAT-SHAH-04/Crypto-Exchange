/** Convert: instant swap between any two listed assets at the reference price minus a small spread. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { prisma, D } from '../db.js';
import { redis } from '../redis.js';
import { requireTrade, requireAuth } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { adjustBalance, debitAvailable, notifyUser } from '../engine/engine.js';
import { usdPrice } from './wallet.js';

const SPREAD = Number(process.env.CONVERT_SPREAD || '0.002'); // 0.2%
const QUOTE_TTL_S = 10;

interface Quote {
  id: string;
  userId: string;
  from: string;
  to: string;
  fromAmount: string;
  toAmount: string;
  rate: string;
  expiresAt: number;
}

export async function convertRoutes(app: FastifyInstance) {
  app.get('/api/convert/quote', { preHandler: requireTrade, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const q = z.object({ from: z.string(), to: z.string(), amount: z.string().regex(/^\d+(\.\d+)?$/) }).parse(req.query);
    if (q.from === q.to) throw badRequest('Choose two different assets');
    const [fa, ta] = await Promise.all([prisma.asset.findUnique({ where: { symbol: q.from } }), prisma.asset.findUnique({ where: { symbol: q.to } })]);
    if (!fa?.enabled || !ta?.enabled) throw badRequest('Asset not available for convert');
    const pf = usdPrice(fa.symbol);
    const pt = usdPrice(ta.symbol);
    if (!pf || !pt) throw badRequest('No price available for this pair right now');
    const fromAmount = new D(q.amount).toDecimalPlaces(fa.precision, D.ROUND_DOWN);
    const usd = fromAmount.toNumber() * pf;
    if (usd < 1) throw badRequest('Minimum convert value is $1');
    if (usd > 1_000_000) throw badRequest('Maximum convert value is $1,000,000');
    const rate = new D(pf).div(pt).mul(1 - SPREAD);
    const toAmount = fromAmount.mul(rate).toDecimalPlaces(ta.precision, D.ROUND_DOWN);
    const quote: Quote = {
      id: randomUUID(), userId: req.user!.id, from: fa.symbol, to: ta.symbol,
      fromAmount: fromAmount.toString(), toAmount: toAmount.toString(), rate: rate.toSignificantDigits(10).toString(),
      expiresAt: Date.now() + QUOTE_TTL_S * 1000,
    };
    await redis.set(`exchange:convert:${quote.id}`, JSON.stringify(quote), 'EX', QUOTE_TTL_S);
    const { userId, ...pub } = quote;
    return { ...pub, inverseRate: new D(1).div(rate).toSignificantDigits(10).toString() };
  });

  app.post('/api/convert/accept', { preHandler: requireTrade }, async (req) => {
    const { quoteId } = z.object({ quoteId: z.string().uuid() }).parse(req.body);
    const raw = await redis.getdel(`exchange:convert:${quoteId}`);
    if (!raw) throw badRequest('Quote expired, please refresh');
    const q = JSON.parse(raw) as Quote;
    if (q.userId !== req.user!.id || q.expiresAt < Date.now()) throw badRequest('Quote expired, please refresh');
    const rec = await prisma.$transaction(async (tx) => {
      await debitAvailable(tx, q.userId, q.from, new D(q.fromAmount));
      await adjustBalance(tx, q.userId, q.to, new D(q.toAmount));
      return tx.convertTrade.create({
        data: { userId: q.userId, fromAsset: q.from, toAsset: q.to, fromAmount: q.fromAmount, toAmount: q.toAmount, price: q.rate },
      });
    });
    await audit(req, q.userId, 'convert.executed', { from: q.from, to: q.to, fromAmount: q.fromAmount, toAmount: q.toAmount });
    notifyUser(q.userId);
    return { ...rec, fromAmount: rec.fromAmount.toString(), toAmount: rec.toAmount.toString(), price: rec.price.toString() };
  });

  app.get('/api/convert/history', { preHandler: requireAuth }, async (req) => {
    const rows = await prisma.convertTrade.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((r) => ({ ...r, fromAmount: r.fromAmount.toString(), toAmount: r.toAmount.toString(), price: r.price.toString() }));
  });
}
