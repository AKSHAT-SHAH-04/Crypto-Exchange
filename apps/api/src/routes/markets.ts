import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getBook, getPair, listPairs } from '../engine/engine.js';
import { getCandles, getMarketTrades, getTicker, INTERVALS } from '../market/feed.js';
import { notFound } from '../lib/errors.js';

export function serializePair(p: NonNullable<ReturnType<typeof getPair>>) {
  return {
    symbol: p.symbol, base: p.base, quote: p.quote, pricePrecision: p.pricePrecision, qtyPrecision: p.qtyPrecision,
    minNotional: p.minNotional.toString(), makerFee: p.makerFee.toString(), takerFee: p.takerFee.toString(), enabled: p.enabled,
  };
}

export async function marketRoutes(app: FastifyInstance) {
  app.get('/api/markets', async () =>
    listPairs()
      .filter((p) => p.enabled)
      .map((p) => ({ ...serializePair(p), ticker: getTicker(p.symbol) ?? null })),
  );

  const pairOr404 = (symbol: string) => {
    const p = getPair(symbol.toUpperCase());
    if (!p || !p.enabled) throw notFound('Market not found');
    return p;
  };

  app.get('/api/markets/:symbol', async (req) => {
    const p = pairOr404((req.params as any).symbol);
    return { ...serializePair(p), ticker: getTicker(p.symbol) ?? null };
  });

  app.get('/api/markets/:symbol/depth', async (req) => {
    const p = pairOr404((req.params as any).symbol);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    return getBook(p.symbol)!.depth(limit);
  });

  app.get('/api/markets/:symbol/trades', async (req) => getMarketTrades(pairOr404((req.params as any).symbol).symbol));

  app.get('/api/markets/:symbol/klines', async (req) => {
    const p = pairOr404((req.params as any).symbol);
    const q = z
      .object({ interval: z.enum(INTERVALS).default('1h'), limit: z.coerce.number().int().min(10).max(1000).default(500) })
      .parse(req.query);
    return getCandles(p.symbol, q.interval, q.limit);
  });
}
