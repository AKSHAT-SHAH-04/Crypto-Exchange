import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, D } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getPair, lastPrice } from '../engine/engine.js';
import { trackAlert, untrackAlert } from '../engine/alerts.js';

const ser = (a: any) => ({ ...a, price: a.price.toString() });

export async function alertRoutes(app: FastifyInstance) {
  app.get('/api/alerts', { preHandler: requireAuth }, async (req) =>
    (await prisma.priceAlert.findMany({ where: { userId: req.user!.id }, orderBy: [{ active: 'desc' }, { createdAt: 'desc' }], take: 100 })).map(ser),
  );

  app.post('/api/alerts', { preHandler: requireAuth }, async (req) => {
    const body = z
      .object({ symbol: z.string(), price: z.string().regex(/^\d+(\.\d+)?$/), note: z.string().max(100).optional() })
      .parse(req.body);
    const symbol = body.symbol.toUpperCase();
    const pair = getPair(symbol);
    if (!pair) throw badRequest('Unknown market');
    const current = lastPrice(symbol);
    if (!current) throw badRequest('No market price yet');
    const price = new D(body.price);
    if (price.eq(current)) throw badRequest('Alert price equals the current price');
    if ((await prisma.priceAlert.count({ where: { userId: req.user!.id, active: true } })) >= 50) throw badRequest('Maximum of 50 active alerts');
    const alert = await prisma.priceAlert.create({
      data: { userId: req.user!.id, symbol, price, direction: price.gt(current) ? 'ABOVE' : 'BELOW', note: body.note },
    });
    trackAlert(alert);
    return ser(alert);
  });

  app.delete('/api/alerts/:id', { preHandler: requireAuth }, async (req) => {
    const id = (req.params as any).id;
    const r = await prisma.priceAlert.deleteMany({ where: { id, userId: req.user!.id } });
    if (!r.count) throw notFound();
    untrackAlert(id);
    return { ok: true };
  });
}
