import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, D } from '../db.js';
import { requireAdmin } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { sha256 } from '../lib/crypto.js';
import { adjustBalance, cancelAllForUser, listPairs, notifyUser, reloadPairs } from '../engine/engine.js';
import { updateFeedPairs } from '../market/feed.js';
import { serializePair } from './markets.js';

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/api/admin/stats', async () => {
    const dayAgo = new Date(Date.now() - 86400e3);
    const [users, newUsers, kycPending, withdrawalsPending, trades24h, openOrders] = await Promise.all([
      prisma.user.count({ where: { role: 'USER' } }),
      prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.kycSubmission.count({ where: { status: 'PENDING' } }),
      prisma.transaction.count({ where: { type: 'WITHDRAWAL', status: 'PENDING_APPROVAL' } }),
      prisma.trade.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.order.count({ where: { status: { in: ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'] } } }),
    ]);
    const fees = await prisma.trade.findMany({ where: { createdAt: { gte: dayAgo } }, select: { symbol: true, price: true, buyerFee: true, sellerFee: true } });
    const feesUsd = fees.reduce((s, t) => s + t.buyerFee.mul(t.price).plus(t.sellerFee).toNumber(), 0);
    return { users, newUsers, kycPending, withdrawalsPending, trades24h, openOrders, feesUsd24h: feesUsd };
  });

  // ---------- users ----------
  app.get('/api/admin/users', async (req) => {
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    const users = await prisma.user.findMany({
      where: { role: { not: 'SYSTEM' }, ...(q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, email: true, name: true, role: true, frozen: true, emailVerified: true, totpEnabled: true, kycStatus: true, createdAt: true },
    });
    return users;
  });

  app.get('/api/admin/users/:id', async (req) => {
    const id = (req.params as any).id;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, role: true, frozen: true, emailVerified: true, totpEnabled: true, kycStatus: true, createdAt: true, balances: true },
    });
    if (!user) throw notFound();
    return { ...user, balances: user.balances.map((b) => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString() })) };
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const id = (req.params as any).id;
    const body = z.object({ frozen: z.boolean().optional(), role: z.enum(['USER', 'ADMIN']).optional() }).parse(req.body);
    if (id === req.user!.id) throw badRequest("You can't modify your own account here");
    const user = await prisma.user.update({
      where: { id },
      data: { ...body, ...(body.frozen ? { tokenVersion: { increment: 1 } } : {}) },
    });
    if (body.frozen) await cancelAllForUser(id);
    await audit(req, req.user!.id, 'admin.user_updated', { target: id, ...body });
    return { ok: true, frozen: user.frozen, role: user.role };
  });

  app.post('/api/admin/users/:id/adjust', async (req) => {
    const id = (req.params as any).id;
    const body = z.object({ asset: z.string(), amount: z.string().regex(/^-?\d+(\.\d+)?$/), note: z.string().max(200) }).parse(req.body);
    const amount = new D(body.amount);
    await prisma.$transaction(async (tx) => {
      if (amount.lt(0)) {
        const r = await tx.balance.updateMany({ where: { userId: id, asset: body.asset, available: { gte: amount.neg() } }, data: { available: { increment: amount } } });
        if (!r.count) throw badRequest('Insufficient available balance');
      } else await adjustBalance(tx, id, body.asset, amount);
      await tx.transaction.create({ data: { userId: id, type: 'ADJUSTMENT', status: 'COMPLETED', asset: body.asset, amount, note: body.note } });
    });
    await audit(req, req.user!.id, 'admin.balance_adjusted', { target: id, ...body });
    notifyUser(id);
    return { ok: true };
  });

  // ---------- KYC ----------
  app.get('/api/admin/kyc', async (req) => {
    const { status } = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING') }).parse(req.query);
    return prisma.kycSubmission.findMany({ where: { status }, orderBy: { createdAt: 'asc' }, take: 100, include: { user: { select: { email: true } } } });
  });

  app.post('/api/admin/kyc/:id', async (req) => {
    const id = (req.params as any).id;
    const body = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().max(300).optional() }).parse(req.body);
    const sub = await prisma.kycSubmission.findUnique({ where: { id } });
    if (!sub || sub.status !== 'PENDING') throw badRequest('Submission is not pending');
    await prisma.$transaction([
      prisma.kycSubmission.update({ where: { id }, data: { status: body.decision, reviewNote: body.note, reviewedBy: req.user!.id, reviewedAt: new Date() } }),
      prisma.user.update({ where: { id: sub.userId }, data: { kycStatus: body.decision } }),
    ]);
    await audit(req, req.user!.id, 'admin.kyc_reviewed', { submission: id, decision: body.decision });
    return { ok: true };
  });

  // ---------- withdrawals ----------
  app.get('/api/admin/withdrawals', async (req) => {
    const { status } = z.object({ status: z.enum(['AWAITING_EMAIL', 'PENDING_APPROVAL', 'COMPLETED', 'REJECTED', 'CANCELED']).default('PENDING_APPROVAL') }).parse(req.query);
    const rows = await prisma.transaction.findMany({
      where: { type: 'WITHDRAWAL', status },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { user: { select: { email: true } } },
    });
    return rows.map((t) => ({ ...t, amount: t.amount.toString(), fee: t.fee.toString() }));
  });

  app.post('/api/admin/withdrawals/:id', async (req) => {
    const id = (req.params as any).id;
    const body = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().max(300).optional() }).parse(req.body);
    const tx = await prisma.$transaction(async (t) => {
      const w = await t.transaction.findUnique({ where: { id } });
      if (!w || w.type !== 'WITHDRAWAL') throw notFound();
      const r = await t.transaction.updateMany({
        where: { id, status: 'PENDING_APPROVAL' },
        data: {
          status: body.decision === 'APPROVE' ? 'COMPLETED' : 'REJECTED',
          note: body.note,
          txHash: body.decision === 'APPROVE' ? `0x${sha256(id + Date.now())}` : null,
        },
      });
      if (!r.count) throw badRequest('Withdrawal is not pending approval');
      if (body.decision === 'APPROVE') await adjustBalance(t, w.userId, w.asset, new D(0), w.amount.neg());
      else await adjustBalance(t, w.userId, w.asset, w.amount, w.amount.neg());
      return w;
    });
    await audit(req, req.user!.id, 'admin.withdrawal_reviewed', { id, decision: body.decision });
    notifyUser(tx.userId);
    return { ok: true };
  });

  // ---------- pairs & fees ----------
  app.get('/api/admin/pairs', async () => {
    await reloadPairs();
    return listPairs().map(serializePair);
  });

  const feeSchema = z.coerce.number().min(0).max(0.05);

  app.post('/api/admin/pairs', async (req) => {
    const body = z
      .object({
        base: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/),
        quote: z.literal('USDT').default('USDT'),
        name: z.string().trim().min(1).max(40),
        pricePrecision: z.coerce.number().int().min(0).max(8),
        qtyPrecision: z.coerce.number().int().min(0).max(8),
        makerFee: feeSchema.default(0.001),
        takerFee: feeSchema.default(0.001),
      })
      .parse(req.body);
    const symbol = `${body.base}${body.quote}`;
    if (await prisma.pair.findUnique({ where: { symbol } })) throw badRequest('Pair already exists');
    // Validate that the reference market exists so the market maker has a price to follow.
    let seedPrice = 1;
    try {
      const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw badRequest(`No reference market found for ${symbol}`);
      seedPrice = +((await r.json()) as any).price;
    } catch (e) {
      if (e instanceof Error && 'statusCode' in e) throw e;
    }
    await prisma.$transaction([
      prisma.asset.upsert({ where: { symbol: body.base }, create: { symbol: body.base, name: body.name, networks: ['ERC20'] }, update: {} }),
      prisma.pair.create({
        data: {
          symbol, base: body.base, quote: body.quote, pricePrecision: body.pricePrecision, qtyPrecision: body.qtyPrecision,
          makerFee: body.makerFee, takerFee: body.takerFee, seedPrice,
        },
      }),
    ]);
    await reloadPairs();
    await updateFeedPairs(listPairs().map((p) => ({ symbol: p.symbol, seedPrice: p.seedPrice.toNumber() })));
    await audit(req, req.user!.id, 'admin.pair_listed', { symbol });
    return { ok: true, symbol };
  });

  app.patch('/api/admin/pairs/:symbol', async (req) => {
    const symbol = (req.params as any).symbol;
    const body = z.object({ enabled: z.boolean().optional(), makerFee: feeSchema.optional(), takerFee: feeSchema.optional(), minNotional: z.coerce.number().min(0).optional() }).parse(req.body);
    await prisma.pair.update({ where: { symbol }, data: body }).catch(() => {
      throw notFound('Pair not found');
    });
    await reloadPairs();
    await audit(req, req.user!.id, 'admin.pair_updated', { symbol, ...body });
    return { ok: true };
  });

  // ---------- audit ----------
  app.get('/api/admin/audit', async (req) => {
    const { action } = z.object({ action: z.string().optional() }).parse(req.query);
    return prisma.auditLog.findMany({
      where: action ? { action: { contains: action } } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { email: true } } },
    });
  });
}
