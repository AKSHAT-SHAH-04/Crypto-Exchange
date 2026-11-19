/** Convert: instant swap between any two listed assets at the reference price minus a small spread. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { prisma, D } from '../db.js';
import { redis } from '../redis.js';
import { requireTrade, requireAuth } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { notifyUser } from '../engine/engine.js';
import { priceConvert, settleConvert } from '../lib/convert.js';

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
    const c = await priceConvert(q.from, q.to, q.amount);
    const quote: Quote = {
      id: randomUUID(), userId: req.user!.id, from: c.from, to: c.to,
      fromAmount: c.fromAmount.toString(), toAmount: c.toAmount.toString(), rate: c.rate.toString(),
      expiresAt: Date.now() + QUOTE_TTL_S * 1000,
    };
    await redis.set(`exchange:convert:${quote.id}`, JSON.stringify(quote), 'EX', QUOTE_TTL_S);
    const { userId, ...pub } = quote;
    return { ...pub, inverseRate: new D(1).div(c.rate).toSignificantDigits(10).toString() };
  });

  app.post('/api/convert/accept', { preHandler: requireTrade }, async (req) => {
    const { quoteId } = z.object({ quoteId: z.string().uuid() }).parse(req.body);
    const raw = await redis.getdel(`exchange:convert:${quoteId}`);
    if (!raw) throw badRequest('Quote expired, please refresh');
    const q = JSON.parse(raw) as Quote;
    if (q.userId !== req.user!.id || q.expiresAt < Date.now()) throw badRequest('Quote expired, please refresh');
    const rec = await settleConvert(q.userId, { from: q.from, to: q.to, fromAmount: new D(q.fromAmount), toAmount: new D(q.toAmount), rate: new D(q.rate) });
    await audit(req, q.userId, 'convert.executed', { from: q.from, to: q.to, fromAmount: q.fromAmount, toAmount: q.toAmount });
    notifyUser(q.userId);
    return { ...rec, fromAmount: rec.fromAmount.toString(), toAmount: rec.toAmount.toString(), price: rec.price.toString() };
  });

  app.get('/api/convert/history', { preHandler: requireAuth }, async (req) => {
    const rows = await prisma.convertTrade.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((r) => ({ ...r, fromAmount: r.fromAmount.toString(), toAmount: r.toAmount.toString(), price: r.price.toString() }));
  });
}
