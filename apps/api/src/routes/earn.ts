/**
 * Simple Earn: flexible (redeem any time, interest paid every accrual period) and locked products
 * (fixed term, principal + interest paid at maturity). Interest is paid by the house treasury.
 *
 * NOTE (live mode): yield must come from a real source (staking, institutional lending) and offering
 * it may need its own regulatory approval. Products are admin-managed; set them to what you can fund.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EarnPosition, EarnProduct } from '@prisma/client';
import { prisma, D, ZERO, type Dec } from '../db.js';
import { config } from '../config.js';
import { requireAdmin, requireAuth, requireSession } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { getTreasuryId } from '../lib/treasury.js';
import { scheduleJob } from '../lib/jobs.js';
import { adjustBalance, debitAvailable, notifyUser } from '../engine/engine.js';
import { usdPrice } from './wallet.js';

const YEAR_MS = 365 * 86400e3;
/** How often interest is credited. Paper mode defaults to hourly so you can watch it work. */
const ACCRUAL_MS = Number(process.env.EARN_ACCRUAL_MINUTES || (config.isLive ? 1440 : 60)) * 60_000;

const serProduct = (p: EarnProduct & { _total?: number }) => ({
  ...p, apr: p.apr.toString(), minAmount: p.minAmount.toString(), capacity: p.capacity?.toString() ?? null,
});
const serPos = (p: EarnPosition & { product?: EarnProduct }) => ({
  ...p, amount: p.amount.toString(), apr: p.apr.toString(), earned: p.earned.toString(), product: p.product ? serProduct(p.product) : undefined,
});

/** Pays the treasury-funded interest. In live mode the treasury must actually hold it. */
async function payInterest(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], userId: string, asset: string, amount: Dec) {
  const house = getTreasuryId();
  if (config.isLive) {
    const r = await tx.balance.updateMany({ where: { userId: house, asset, available: { gte: amount } }, data: { available: { decrement: amount } } });
    if (!r.count) throw new Error(`Treasury has insufficient ${asset} to pay Earn interest`);
  } else {
    await adjustBalance(tx, house, asset, amount.neg());
  }
  await adjustBalance(tx, userId, asset, amount);
}

/** Accrues interest since lastAccrualAt. Flexible: paid out now. Locked: added to `earned`, paid at maturity. */
async function accrue(pos: EarnPosition & { product: EarnProduct }, now: Date, closing = false) {
  const until = pos.maturesAt && pos.maturesAt < now ? pos.maturesAt : now;
  const elapsed = until.getTime() - pos.lastAccrualAt.getTime();
  if (elapsed <= 0 && !closing) return;
  const interest = pos.amount.mul(pos.apr).mul(Math.max(0, elapsed)).div(YEAR_MS).toDecimalPlaces(8, D.ROUND_DOWN);
  const matured = !!pos.maturesAt && pos.maturesAt <= now;
  const finish = closing || matured;

  await prisma.$transaction(async (tx) => {
    // optimistic claim: only one accrual per period can win
    const r = await tx.earnPosition.updateMany({
      where: { id: pos.id, status: 'ACTIVE', lastAccrualAt: pos.lastAccrualAt },
      data: {
        lastAccrualAt: until,
        earned: { increment: interest },
        ...(finish ? { status: 'REDEEMED', redeemedAt: now } : {}),
      },
    });
    if (r.count !== 1) return;
    const asset = pos.product.asset;
    if (pos.product.type === 'FLEXIBLE') {
      if (interest.gt(0)) await payInterest(tx, pos.userId, asset, interest);
    } else if (finish) {
      const totalInterest = pos.earned.plus(interest);
      if (totalInterest.gt(0)) await payInterest(tx, pos.userId, asset, totalInterest);
    }
    if (finish) {
      // principal back to the user
      await adjustBalance(tx, pos.userId, asset, pos.amount);
      await tx.transaction.create({
        data: { userId: pos.userId, type: 'EARN', status: 'COMPLETED', asset, amount: pos.amount, note: `Earn redemption (${pos.product.type.toLowerCase()})` },
      });
    }
    const paid = pos.product.type === 'FLEXIBLE' ? interest : finish ? pos.earned.plus(interest) : ZERO;
    if (paid.gt(0)) {
      await tx.transaction.create({ data: { userId: pos.userId, type: 'EARN', status: 'COMPLETED', asset, amount: paid, note: 'Earn interest' } });
    }
  });
  notifyUser(pos.userId);
  if (matured && !closing) {
    await notify(pos.userId, {
      type: 'wallet',
      title: 'Locked Earn matured',
      body: `${pos.amount} ${pos.product.asset} plus interest has been returned to your wallet.`,
      link: '/earn',
    });
  }
}

export async function earnRoutes(app: FastifyInstance) {
  scheduleJob('earn-accrual', 60_000, async () => {
    const now = new Date();
    const due = await prisma.earnPosition.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ lastAccrualAt: { lte: new Date(now.getTime() - ACCRUAL_MS) } }, { maturesAt: { lte: now } }],
      },
      include: { product: true },
      take: 500,
    });
    for (const p of due) await accrue(p, now).catch((e) => console.error('[earn] accrual failed', p.id, e.message));
  });

  app.get('/api/earn/products', async () => {
    const products = await prisma.earnProduct.findMany({ where: { enabled: true }, orderBy: [{ asset: 'asc' }, { durationDays: 'asc' }] });
    const used = await prisma.earnPosition.groupBy({ by: ['productId'], where: { status: 'ACTIVE' }, _sum: { amount: true } });
    const usedBy = new Map(used.map((u) => [u.productId, u._sum.amount?.toString() ?? '0']));
    return products.map((p) => ({ ...serProduct(p), subscribed: usedBy.get(p.id) ?? '0', usdPrice: usdPrice(p.asset) }));
  });

  app.get('/api/earn/positions', { preHandler: requireAuth }, async (req) => {
    const rows = await prisma.earnPosition.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { product: true },
      take: 100,
    });
    // show interest accrued since the last payout (not yet credited)
    const now = Date.now();
    return rows.map((p) => ({
      ...serPos(p),
      pending: p.status === 'ACTIVE'
        ? p.amount.mul(p.apr).mul(Math.max(0, Math.min(now, p.maturesAt?.getTime() ?? now) - p.lastAccrualAt.getTime())).div(YEAR_MS).toDecimalPlaces(8).toString()
        : '0',
      usdPrice: usdPrice(p.product.asset),
    }));
  });

  app.post('/api/earn/subscribe', { preHandler: requireSession, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ productId: z.string(), amount: z.string().regex(/^\d+(\.\d+)?$/) }).parse(req.body);
    const u = req.user!;
    if (config.isLive && u.kycStatus !== 'APPROVED') throw forbidden('Complete identity verification (KYC) to use Earn');
    const product = await prisma.earnProduct.findUnique({ where: { id: b.productId } });
    if (!product?.enabled) throw notFound('Product not available');
    const asset = await prisma.asset.findUnique({ where: { symbol: product.asset } });
    const amount = new D(b.amount).toDecimalPlaces(asset?.precision ?? 8, D.ROUND_DOWN);
    if (amount.lte(0) || amount.lt(product.minAmount)) throw badRequest(`Minimum is ${product.minAmount} ${product.asset}`);
    const pos = await prisma.$transaction(async (tx) => {
      if (product.capacity) {
        const used = await tx.earnPosition.aggregate({ where: { productId: product.id, status: 'ACTIVE' }, _sum: { amount: true } });
        if ((used._sum.amount ?? ZERO).plus(amount).gt(product.capacity)) throw badRequest('This product is fully subscribed');
      }
      await debitAvailable(tx, u.id, product.asset, amount);
      await tx.transaction.create({
        data: { userId: u.id, type: 'EARN', status: 'COMPLETED', asset: product.asset, amount: amount.neg(), note: `Earn subscription (${product.type.toLowerCase()}${product.durationDays ? ` ${product.durationDays}d` : ''})` },
      });
      return tx.earnPosition.create({
        data: {
          userId: u.id, productId: product.id, amount, apr: product.apr,
          maturesAt: product.type === 'LOCKED' ? new Date(Date.now() + product.durationDays * 86400e3) : null,
        },
      });
    });
    await audit(req, u.id, 'earn.subscribed', { productId: product.id, amount: amount.toString() });
    notifyUser(u.id);
    return serPos(pos);
  });

  app.post('/api/earn/positions/:id/redeem', { preHandler: requireSession }, async (req) => {
    const pos = await prisma.earnPosition.findFirst({ where: { id: (req.params as any).id, userId: req.user!.id, status: 'ACTIVE' }, include: { product: true } });
    if (!pos) throw notFound('Position not found');
    if (pos.product.type === 'LOCKED') throw badRequest(`Locked until ${pos.maturesAt?.toISOString().slice(0, 10)} — it will be returned automatically`);
    await accrue(pos, new Date(), true);
    const after = await prisma.earnPosition.findUnique({ where: { id: pos.id } });
    if (after?.status !== 'REDEEMED') throw badRequest('Please try again');
    await audit(req, req.user!.id, 'earn.redeemed', { id: pos.id });
    return { ok: true };
  });

  // ---------- admin ----------
  const productBody = z.object({
    asset: z.string().toUpperCase(),
    type: z.enum(['FLEXIBLE', 'LOCKED']),
    durationDays: z.coerce.number().int().min(0).max(365).default(0),
    apr: z.coerce.number().finite().min(0).max(1),
    minAmount: z.coerce.number().finite().min(0).default(0),
    capacity: z.coerce.number().finite().positive().nullable().optional(),
    enabled: z.boolean().default(true),
  });

  app.get('/api/admin/earn/products', { preHandler: requireAdmin }, async () => {
    const products = await prisma.earnProduct.findMany({ orderBy: [{ asset: 'asc' }, { durationDays: 'asc' }] });
    const used = await prisma.earnPosition.groupBy({ by: ['productId'], where: { status: 'ACTIVE' }, _sum: { amount: true }, _count: true });
    const by = new Map(used.map((u) => [u.productId, u]));
    return products.map((p) => ({ ...serProduct(p), subscribed: by.get(p.id)?._sum.amount?.toString() ?? '0', positions: by.get(p.id)?._count ?? 0 }));
  });

  app.post('/api/admin/earn/products', { preHandler: requireAdmin }, async (req) => {
    const b = productBody.parse(req.body);
    if (b.type === 'LOCKED' && b.durationDays < 1) throw badRequest('Locked products need a duration');
    if (!(await prisma.asset.findUnique({ where: { symbol: b.asset } }))) throw badRequest('Unknown asset');
    const p = await prisma.earnProduct.create({ data: { ...b, capacity: b.capacity ?? null } });
    await audit(req, req.user!.id, 'admin.earn_product_created', { id: p.id });
    return serProduct(p);
  });

  app.patch('/api/admin/earn/products/:id', { preHandler: requireAdmin }, async (req) => {
    const b = z.object({ apr: z.coerce.number().finite().min(0).max(1).optional(), enabled: z.boolean().optional(), capacity: z.coerce.number().finite().positive().nullable().optional() }).parse(req.body);
    const p = await prisma.earnProduct.update({ where: { id: (req.params as any).id }, data: b }).catch(() => {
      throw notFound();
    });
    await audit(req, req.user!.id, 'admin.earn_product_updated', { id: p.id, ...b });
    return serProduct(p);
  });
}
