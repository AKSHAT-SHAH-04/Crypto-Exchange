import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireTrade } from '../lib/auth.js';
import { cancelOrder, placeOco, placeOrder } from '../engine/engine.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';

const num = z.string().regex(/^\d+(\.\d+)?$/, 'Must be a positive number');

const orderSchema = z
  .object({
    symbol: z.string().min(3).max(20),
    side: z.enum(['BUY', 'SELL']),
    type: z.enum(['LIMIT', 'MARKET', 'STOP_LIMIT', 'TRAILING_STOP']),
    quantity: num,
    price: num.optional(),
    stopPrice: num.optional(),
    trailingDelta: num.optional(),
    timeInForce: z.enum(['GTC', 'IOC', 'FOK']).optional(),
    postOnly: z.boolean().optional(),
  })
  .refine((o) => o.type === 'MARKET' || !!o.price, { message: 'Price is required', path: ['price'] })
  .refine((o) => o.type !== 'STOP_LIMIT' || !!o.stopPrice, { message: 'Stop price is required', path: ['stopPrice'] })
  .refine((o) => o.type !== 'TRAILING_STOP' || !!o.trailingDelta, { message: 'Trailing delta is required', path: ['trailingDelta'] });

const ocoSchema = z.object({
  symbol: z.string().min(3).max(20),
  side: z.enum(['BUY', 'SELL']),
  quantity: num,
  price: num,
  stopPrice: num,
  stopLimitPrice: num,
});

export const serializeOrder = (o: any) => ({
  ...o,
  price: o.price?.toString() ?? null,
  stopPrice: o.stopPrice?.toString() ?? null,
  quantity: o.quantity.toString(),
  filledQty: o.filledQty.toString(),
  quoteFilled: o.quoteFilled.toString(),
  lockPrice: undefined,
  trailingDelta: o.trailingDelta?.toString() ?? null,
  avgPrice: o.filledQty.gt(0) ? o.quoteFilled.div(o.filledQty).toString() : null,
});

export async function orderRoutes(app: FastifyInstance) {
  app.post('/api/orders', { preHandler: requireTrade, config: { rateLimit: { max: 60, timeWindow: '10 seconds' } } }, async (req) => {
    const body = orderSchema.parse(req.body);
    const order = await placeOrder(req.user!.id, body);
    await audit(req, req.user!.id, 'order.place', { id: order.id, symbol: order.symbol, side: order.side, type: order.type });
    return serializeOrder(order);
  });

  app.post('/api/orders/oco', { preHandler: requireTrade, config: { rateLimit: { max: 30, timeWindow: '10 seconds' } } }, async (req) => {
    const body = ocoSchema.parse(req.body);
    const r = await placeOco(req.user!.id, body);
    await audit(req, req.user!.id, 'order.place_oco', { ocoId: r.ocoId, symbol: body.symbol, side: body.side });
    return { ocoId: r.ocoId, orders: r.orders.map(serializeOrder) };
  });

  app.delete('/api/orders/:id', { preHandler: requireTrade }, async (req) => {
    const order = await cancelOrder(req.user!.id, (req.params as any).id);
    await audit(req, req.user!.id, 'order.cancel', { id: order.id });
    return serializeOrder(order);
  });

  app.delete('/api/orders', { preHandler: requireTrade }, async (req) => {
    const { symbol } = z.object({ symbol: z.string().optional() }).parse(req.query);
    const open = await prisma.order.findMany({
      where: { userId: req.user!.id, status: { in: ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'] }, ...(symbol ? { symbol } : {}) },
      select: { id: true },
    });
    let canceled = 0;
    for (const o of open) {
      try {
        await cancelOrder(req.user!.id, o.id);
        canceled++;
      } catch {
        /* already filled */
      }
    }
    return { canceled };
  });

  app.get('/api/orders/open', { preHandler: requireAuth }, async (req) => {
    const { symbol } = z.object({ symbol: z.string().optional() }).parse(req.query);
    const rows = await prisma.order.findMany({
      where: { userId: req.user!.id, status: { in: ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'] }, ...(symbol ? { symbol } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(serializeOrder);
  });

  app.get('/api/orders/history', { preHandler: requireAuth }, async (req) => {
    const q = z.object({ symbol: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const rows = await prisma.order.findMany({
      where: { userId: req.user!.id, status: { in: ['FILLED', 'CANCELED', 'REJECTED'] }, ...(q.symbol ? { symbol: q.symbol } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: q.limit,
    });
    return rows.map(serializeOrder);
  });

  app.get('/api/orders/:id', { preHandler: requireAuth }, async (req) => {
    const o = await prisma.order.findFirst({ where: { id: (req.params as any).id, userId: req.user!.id } });
    if (!o) throw badRequest('Order not found');
    return serializeOrder(o);
  });

  app.get('/api/trades/my', { preHandler: requireAuth }, async (req) => {
    const q = z.object({ symbol: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const uid = req.user!.id;
    const rows = await prisma.trade.findMany({
      where: { OR: [{ buyerId: uid }, { sellerId: uid }], ...(q.symbol ? { symbol: q.symbol } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return rows.map((t) => {
      const isBuyer = t.buyerId === uid;
      const isMaker = isBuyer ? t.takerSide === 'SELL' : t.takerSide === 'BUY';
      return {
        id: t.id, symbol: t.symbol, side: isBuyer ? 'BUY' : 'SELL', price: t.price.toString(), quantity: t.quantity.toString(),
        quote: t.price.mul(t.quantity).toString(), fee: (isBuyer ? t.buyerFee : t.sellerFee).toString(),
        feeAsset: (isBuyer ? t.buyerFeeAsset : t.sellerFeeAsset) ?? (isBuyer ? t.symbol.replace(/USDT$/, '') : 'USDT'), role: isMaker ? 'MAKER' : 'TAKER', createdAt: t.createdAt,
      };
    });
  });
}
