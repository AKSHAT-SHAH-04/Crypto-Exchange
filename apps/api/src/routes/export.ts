/** CSV statements for trades, orders, transactions and converts. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../lib/auth.js';

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  // quote, and neutralise spreadsheet formula injection
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';

export async function exportRoutes(app: FastifyInstance) {
  app.get('/api/export/:kind', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const kind = z.enum(['trades', 'orders', 'transactions', 'converts']).parse((req.params as any).kind);
    const q = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
    const uid = req.user!.id;
    const createdAt = { gte: q.from ?? new Date(Date.now() - 365 * 86400e3), lte: q.to ?? new Date() };
    let csv: string;
    if (kind === 'trades') {
      const rows = await prisma.trade.findMany({ where: { OR: [{ buyerId: uid }, { sellerId: uid }], createdAt }, orderBy: { createdAt: 'asc' }, take: 50_000 });
      csv = toCsv(
        ['Date (UTC)', 'Pair', 'Side', 'Role', 'Price', 'Quantity', 'Total', 'Fee', 'Fee asset', 'Trade ID'],
        rows.map((t) => {
          const buyer = t.buyerId === uid;
          const maker = buyer ? t.takerSide === 'SELL' : t.takerSide === 'BUY';
          return [t.createdAt, t.symbol, buyer ? 'BUY' : 'SELL', maker ? 'MAKER' : 'TAKER', t.price, t.quantity, t.price.mul(t.quantity),
            buyer ? t.buyerFee : t.sellerFee, (buyer ? t.buyerFeeAsset : t.sellerFeeAsset) ?? '', t.id];
        }),
      );
    } else if (kind === 'orders') {
      const rows = await prisma.order.findMany({ where: { userId: uid, createdAt }, orderBy: { createdAt: 'asc' }, take: 50_000 });
      csv = toCsv(
        ['Date (UTC)', 'Pair', 'Type', 'Side', 'Price', 'Stop price', 'Quantity', 'Filled', 'Avg price', 'Status', 'Order ID'],
        rows.map((o) => [o.createdAt, o.symbol, o.type, o.side, o.price ?? 'MARKET', o.stopPrice ?? '', o.quantity, o.filledQty,
          o.filledQty.gt(0) ? o.quoteFilled.div(o.filledQty).toDecimalPlaces(8) : '', o.status, o.id]),
      );
    } else if (kind === 'transactions') {
      const rows = await prisma.transaction.findMany({ where: { userId: uid, createdAt }, orderBy: { createdAt: 'asc' }, take: 50_000 });
      csv = toCsv(
        ['Date (UTC)', 'Type', 'Asset', 'Amount', 'Fee', 'Network', 'Address', 'TxID', 'Status', 'Note'],
        rows.map((t) => [t.createdAt, t.type, t.asset, t.amount, t.fee, t.network ?? '', t.address ?? '', t.txHash ?? '', t.status, t.note ?? '']),
      );
    } else {
      const rows = await prisma.convertTrade.findMany({ where: { userId: uid, createdAt }, orderBy: { createdAt: 'asc' }, take: 50_000 });
      csv = toCsv(['Date (UTC)', 'From', 'From amount', 'To', 'To amount', 'Rate'], rows.map((c) => [c.createdAt, c.fromAsset, c.fromAmount, c.toAsset, c.toAmount, c.price]));
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return csv;
  });
}
