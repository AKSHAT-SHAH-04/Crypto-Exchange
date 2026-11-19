/**
 * P2P marketplace (crypto <-> INR) with on-platform escrow.
 *
 * Ads are posted from the advertiser's point of view:
 *   SELL ad: advertiser sells crypto. The whole ad amount is locked (escrowed) when posted.
 *   BUY ad:  advertiser buys crypto. The taker (seller) has their crypto locked when opening an order.
 * Order lifecycle: PENDING_PAYMENT -> (buyer marks paid) PAID -> (seller releases) COMPLETED
 *   - buyer may cancel before release; unpaid orders auto-cancel after the payment window
 *   - either party can open a DISPUTE once paid; an admin then releases or cancels.
 * Fiat moves off-platform (UPI/bank); only the crypto leg is settled here.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticator } from 'otplib';
import type { P2POrder, Prisma, User } from '@prisma/client';
import { prisma, D } from '../db.js';
import { publish } from '../redis.js';
import { requireAdmin, requireSession } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { adjustBalance, lockFunds, notifyUser } from '../engine/engine.js';

type Tx = Prisma.TransactionClient;

const PAYMENT_TYPES = ['UPI', 'IMPS', 'BANK', 'PAYTM'] as const;
const ACTIVE = ['PENDING_PAYMENT', 'PAID', 'DISPUTED'] as const;

const paymentDetails = {
  UPI: z.object({ upiId: z.string().trim().regex(/^[\w.\-]{2,}@[a-zA-Z]{2,}$/, 'Invalid UPI ID'), name: z.string().trim().min(2).max(80) }),
  PAYTM: z.object({ phone: z.string().trim().regex(/^\d{10}$/, '10-digit phone number'), name: z.string().trim().min(2).max(80) }),
  BANK: z.object({ accountNumber: z.string().trim().regex(/^\d{6,18}$/), ifsc: z.string().trim().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC'), name: z.string().trim().min(2).max(80), bank: z.string().trim().min(2).max(60) }),
  IMPS: z.object({ accountNumber: z.string().trim().regex(/^\d{6,18}$/), ifsc: z.string().trim().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC'), name: z.string().trim().min(2).max(80), bank: z.string().trim().min(2).max(60) }),
};

function requireP2PUser(u: User) {
  if (u.parentId) throw forbidden('P2P is not available for sub-accounts');
  if (u.kycStatus !== 'APPROVED') throw forbidden('Complete identity verification (KYC) to use P2P');
}

const ser = (o: any) => {
  const out: any = { ...o };
  for (const k of ['price', 'amount', 'fiatAmount', 'totalAmount', 'remaining', 'minFiat', 'maxFiat']) if (out[k] !== undefined && out[k] !== null) out[k] = out[k].toString();
  return out;
};

async function systemMessage(tx: Tx | typeof prisma, orderId: string, body: string) {
  await tx.p2PMessage.create({ data: { orderId, system: true, body } });
}

function ping(o: P2POrder, title: string, body: string) {
  for (const uid of [o.buyerId, o.sellerId]) {
    publish({ ch: 'user', userId: uid, data: { type: 'p2p', orderId: o.id } });
    notify(uid, { type: 'p2p', title, body, link: `/p2p/order/${o.id}` });
    notifyUser(uid);
  }
}

/** Seller's escrowed crypto goes to the buyer. */
async function releaseOrder(tx: Tx, o: P2POrder, by: string) {
  const r = await tx.p2POrder.updateMany({ where: { id: o.id, status: { in: ['PAID', 'DISPUTED'] } }, data: { status: 'COMPLETED', completedAt: new Date() } });
  if (!r.count) throw badRequest('Order can no longer be released');
  await adjustBalance(tx, o.sellerId, o.asset, new D(0), o.amount.neg());
  await adjustBalance(tx, o.buyerId, o.asset, o.amount);
  await tx.transaction.createMany({
    data: [
      { userId: o.sellerId, type: 'P2P', status: 'COMPLETED', asset: o.asset, amount: o.amount.neg(), note: `P2P sell · order ${o.id.slice(-8)}` },
      { userId: o.buyerId, type: 'P2P', status: 'COMPLETED', asset: o.asset, amount: o.amount, note: `P2P buy · order ${o.id.slice(-8)}` },
    ],
  });
  await systemMessage(tx, o.id, `Crypto released by ${by}. Order completed.`);
}

/** Returns escrow: to the SELL ad (stays locked for future orders) or back to a BUY-ad taker's balance. */
async function cancelOrderTx(tx: Tx, o: P2POrder, reason: string, allowed: readonly string[]) {
  const r = await tx.p2POrder.updateMany({ where: { id: o.id, status: { in: [...allowed] as any } }, data: { status: 'CANCELED', cancelReason: reason } });
  if (!r.count) throw badRequest('Order can no longer be canceled');
  const ad = await tx.p2PAd.findUniqueOrThrow({ where: { id: o.adId } });
  if (ad.side === 'SELL') {
    if (ad.status === 'CLOSED') await adjustBalance(tx, o.sellerId, o.asset, o.amount, o.amount.neg());
    else await tx.p2PAd.update({ where: { id: ad.id }, data: { remaining: { increment: o.amount } } });
  } else {
    await adjustBalance(tx, o.sellerId, o.asset, o.amount, o.amount.neg());
    await tx.p2PAd.update({ where: { id: ad.id }, data: { remaining: { increment: o.amount } } });
  }
  await systemMessage(tx, o.id, `Order canceled: ${reason}`);
}

async function userStats(ids: string[]) {
  const since = new Date(Date.now() - 30 * 86400e3);
  const rows = await prisma.p2POrder.groupBy({
    by: ['makerId', 'status'],
    where: { makerId: { in: ids }, createdAt: { gte: since }, status: { in: ['COMPLETED', 'CANCELED'] } },
    _count: true,
  });
  const out: Record<string, { completed: number; rate: number }> = {};
  for (const id of ids) {
    const done = rows.find((r) => r.makerId === id && r.status === 'COMPLETED')?._count ?? 0;
    const canceled = rows.find((r) => r.makerId === id && r.status === 'CANCELED')?._count ?? 0;
    out[id] = { completed: done, rate: done + canceled ? Math.round((done / (done + canceled)) * 1000) / 10 : 100 };
  }
  return out;
}

export async function p2pRoutes(app: FastifyInstance) {
  // auto-cancel unpaid orders after the payment window
  setInterval(async () => {
    const expired = await prisma.p2POrder.findMany({ where: { status: 'PENDING_PAYMENT', expiresAt: { lt: new Date() } }, take: 50 });
    for (const o of expired) {
      try {
        await prisma.$transaction((tx) => cancelOrderTx(tx, o, 'payment window expired', ['PENDING_PAYMENT']));
        ping(o, 'P2P order expired', `Order ${o.id.slice(-8)} was canceled because payment wasn't marked in time.`);
      } catch {
        /* state changed meanwhile */
      }
    }
  }, 30_000);

  // ---------- payment methods ----------
  app.get('/api/p2p/payment-methods', { preHandler: requireSession }, async (req) =>
    prisma.p2PPaymentMethod.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'asc' } }),
  );

  app.post('/api/p2p/payment-methods', { preHandler: requireSession }, async (req) => {
    const b = z.object({ type: z.enum(PAYMENT_TYPES), label: z.string().trim().min(1).max(40), details: z.record(z.unknown()) }).parse(req.body);
    const details = paymentDetails[b.type].parse(b.details);
    if ((await prisma.p2PPaymentMethod.count({ where: { userId: req.user!.id } })) >= 10) throw badRequest('Maximum of 10 payment methods');
    const m = await prisma.p2PPaymentMethod.create({ data: { userId: req.user!.id, type: b.type, label: b.label, details } });
    await audit(req, req.user!.id, 'p2p.payment_method_added', { id: m.id, type: b.type });
    return m;
  });

  app.delete('/api/p2p/payment-methods/:id', { preHandler: requireSession }, async (req) => {
    const r = await prisma.p2PPaymentMethod.deleteMany({ where: { id: (req.params as any).id, userId: req.user!.id } });
    if (!r.count) throw notFound();
    return { ok: true };
  });

  // ---------- marketplace ----------
  app.get('/api/p2p/ads', async (req) => {
    const q = z
      .object({
        // what the *taker* wants to do
        side: z.enum(['BUY', 'SELL']).default('BUY'),
        asset: z.string().default('USDT'),
        payment: z.enum(PAYMENT_TYPES).optional(),
        amount: z.coerce.number().positive().optional(),
      })
      .parse(req.query);
    const adSide = q.side === 'BUY' ? 'SELL' : 'BUY';
    const ads = await prisma.p2PAd.findMany({
      where: {
        status: 'ONLINE', side: adSide, asset: q.asset, remaining: { gt: 0 },
        ...(q.payment ? { paymentTypes: { has: q.payment } } : {}),
        ...(q.amount ? { minFiat: { lte: q.amount }, maxFiat: { gte: q.amount } } : {}),
        user: { frozen: false },
      },
      orderBy: { price: adSide === 'SELL' ? 'asc' : 'desc' },
      take: 100,
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    const stats = await userStats([...new Set(ads.map((a) => a.userId))]);
    return ads
      .map((a) => {
        // an ad can't sell more than it still has
        const maxByRemaining = a.remaining.mul(a.price).toDecimalPlaces(2, D.ROUND_DOWN);
        const effMax = D.min(a.maxFiat, maxByRemaining);
        const { user, ...ad } = a;
        return {
          ...ser(ad), effectiveMaxFiat: effMax.toString(),
          advertiser: { id: user.id, name: user.name || user.email.split('@')[0], ...stats[user.id] },
        };
      })
      .filter((a) => +a.effectiveMaxFiat >= +a.minFiat);
  });

  // ---------- my ads ----------
  app.get('/api/p2p/my-ads', { preHandler: requireSession }, async (req) =>
    (await prisma.p2PAd.findMany({ where: { userId: req.user!.id, status: { not: 'CLOSED' } }, orderBy: { createdAt: 'desc' } })).map(ser),
  );

  app.post('/api/p2p/ads', { preHandler: requireSession, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z
      .object({
        side: z.enum(['BUY', 'SELL']),
        asset: z.string(),
        price: z.coerce.number().positive(),
        totalAmount: z.coerce.number().positive(),
        minFiat: z.coerce.number().min(100),
        maxFiat: z.coerce.number().positive(),
        paymentTypes: z.array(z.enum(PAYMENT_TYPES)).min(1),
        terms: z.string().trim().max(1000).optional(),
        payWindowMin: z.coerce.number().int().min(15).max(120).default(15),
      })
      .refine((x) => x.maxFiat >= x.minFiat, { message: 'Max limit must be ≥ min limit', path: ['maxFiat'] })
      .parse(req.body);
    const u = req.user!;
    requireP2PUser(u);
    const asset = await prisma.asset.findUnique({ where: { symbol: b.asset } });
    if (!asset?.enabled) throw badRequest('Asset not available');
    if (b.side === 'SELL') {
      const methods = await prisma.p2PPaymentMethod.count({ where: { userId: u.id, type: { in: b.paymentTypes } } });
      if (!methods) throw badRequest('Add a payment method for at least one selected payment type first');
    }
    const total = new D(b.totalAmount).toDecimalPlaces(asset.precision, D.ROUND_DOWN);
    if ((await prisma.p2PAd.count({ where: { userId: u.id, status: { not: 'CLOSED' } } })) >= 10) throw badRequest('Maximum of 10 active ads');
    const ad = await prisma.$transaction(async (tx) => {
      if (b.side === 'SELL') await lockFunds(tx, u.id, asset.symbol, total);
      return tx.p2PAd.create({
        data: {
          userId: u.id, side: b.side, asset: asset.symbol, price: new D(b.price).toDecimalPlaces(2), totalAmount: total, remaining: total,
          minFiat: b.minFiat, maxFiat: b.maxFiat, paymentTypes: b.paymentTypes, terms: b.terms, payWindowMin: b.payWindowMin,
        },
      });
    });
    await audit(req, u.id, 'p2p.ad_created', { id: ad.id, side: ad.side, asset: ad.asset });
    notifyUser(u.id);
    return ser(ad);
  });

  app.patch('/api/p2p/ads/:id', { preHandler: requireSession }, async (req) => {
    const b = z.object({ status: z.enum(['ONLINE', 'OFFLINE']).optional(), price: z.coerce.number().positive().optional() }).parse(req.body);
    const r = await prisma.p2PAd.updateMany({
      where: { id: (req.params as any).id, userId: req.user!.id, status: { not: 'CLOSED' } },
      data: { ...(b.status ? { status: b.status } : {}), ...(b.price ? { price: new D(b.price).toDecimalPlaces(2) } : {}) },
    });
    if (!r.count) throw notFound();
    return { ok: true };
  });

  /** Close an ad: refunds any unsold escrow (SELL ads). Requires no active orders. */
  app.delete('/api/p2p/ads/:id', { preHandler: requireSession }, async (req) => {
    const id = (req.params as any).id;
    await prisma.$transaction(async (tx) => {
      const ad = await tx.p2PAd.findFirst({ where: { id, userId: req.user!.id, status: { not: 'CLOSED' } } });
      if (!ad) throw notFound();
      if (await tx.p2POrder.count({ where: { adId: id, status: { in: [...ACTIVE] } } })) throw badRequest('Ad has active orders; finish them first');
      await tx.p2PAd.update({ where: { id }, data: { status: 'CLOSED', remaining: 0 } });
      if (ad.side === 'SELL' && ad.remaining.gt(0)) await adjustBalance(tx, ad.userId, ad.asset, ad.remaining, ad.remaining.neg());
    });
    notifyUser(req.user!.id);
    return { ok: true };
  });

  // ---------- orders ----------
  app.post('/api/p2p/orders', { preHandler: requireSession, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ adId: z.string(), fiatAmount: z.coerce.number().positive() }).parse(req.body);
    const u = req.user!;
    requireP2PUser(u);
    if ((await prisma.p2POrder.count({ where: { OR: [{ buyerId: u.id }, { sellerId: u.id }], status: 'PENDING_PAYMENT' } })) >= 3)
      throw badRequest('You have too many unpaid orders');
    const order = await prisma.$transaction(async (tx) => {
      const ad = await tx.p2PAd.findUnique({ where: { id: b.adId }, include: { user: true } });
      if (!ad || ad.status !== 'ONLINE' || ad.user.frozen) throw badRequest('This ad is no longer available');
      if (ad.userId === u.id) throw badRequest("You can't trade with your own ad");
      const fiat = new D(b.fiatAmount).toDecimalPlaces(2, D.ROUND_DOWN);
      if (fiat.lt(ad.minFiat) || fiat.gt(ad.maxFiat)) throw badRequest(`Amount must be between ₹${ad.minFiat} and ₹${ad.maxFiat}`);
      const amount = fiat.div(ad.price).toDecimalPlaces(8, D.ROUND_DOWN);
      if (amount.lte(0)) throw badRequest('Amount too small');
      const r = await tx.p2PAd.updateMany({ where: { id: ad.id, remaining: { gte: amount } }, data: { remaining: { decrement: amount } } });
      if (!r.count) throw badRequest('Not enough left on this ad — try a smaller amount');
      const takerIsBuyer = ad.side === 'SELL';
      if (!takerIsBuyer) {
        const methods = await tx.p2PPaymentMethod.count({ where: { userId: u.id, type: { in: ad.paymentTypes } } });
        if (!methods) throw badRequest(`Add a ${ad.paymentTypes.join('/')} payment method so the buyer can pay you`);
        await lockFunds(tx, u.id, ad.asset, amount);
      }
      const o = await tx.p2POrder.create({
        data: {
          adId: ad.id, makerId: ad.userId, buyerId: takerIsBuyer ? u.id : ad.userId, sellerId: takerIsBuyer ? ad.userId : u.id,
          asset: ad.asset, fiat: ad.fiat, price: ad.price, amount, fiatAmount: fiat,
          expiresAt: new Date(Date.now() + ad.payWindowMin * 60_000),
        },
      });
      await systemMessage(tx, o.id, `Order created. The buyer must pay ₹${fiat} within ${ad.payWindowMin} minutes and then mark the order as paid. ${amount} ${ad.asset} is held in escrow.`);
      return o;
    });
    await audit(req, u.id, 'p2p.order_created', { id: order.id });
    ping(order, 'New P2P order', `Order ${order.id.slice(-8)}: ${order.amount} ${order.asset} for ₹${order.fiatAmount}`);
    return ser(order);
  });

  app.get('/api/p2p/orders', { preHandler: requireSession }, async (req) => {
    const { active } = z.object({ active: z.coerce.boolean().optional() }).parse(req.query);
    const uid = req.user!.id;
    const rows = await prisma.p2POrder.findMany({
      where: { OR: [{ buyerId: uid }, { sellerId: uid }], ...(active ? { status: { in: [...ACTIVE] } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((o) => ({ ...ser(o), role: o.buyerId === uid ? 'BUYER' : 'SELLER' }));
  });

  const loadOrder = async (id: string, uid: string, admin = false) => {
    const o = await prisma.p2POrder.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } }, ad: true } });
    if (!o || (!admin && o.buyerId !== uid && o.sellerId !== uid)) throw notFound('Order not found');
    return o;
  };

  app.get('/api/p2p/orders/:id', { preHandler: requireSession }, async (req) => {
    const uid = req.user!.id;
    const o = await loadOrder((req.params as any).id, uid, req.user!.role === 'ADMIN');
    const [buyer, seller, sellerMethods] = await Promise.all([
      prisma.user.findUnique({ where: { id: o.buyerId }, select: { name: true, email: true } }),
      prisma.user.findUnique({ where: { id: o.sellerId }, select: { name: true, email: true } }),
      // the buyer needs the seller's payment details to pay
      prisma.p2PPaymentMethod.findMany({ where: { userId: o.sellerId, type: { in: o.ad.paymentTypes } } }),
    ]);
    const display = (u: { name: string | null; email: string } | null) => u?.name || u?.email.split('@')[0] || '—';
    const { ad, ...rest } = o;
    return {
      ...ser(rest),
      role: o.buyerId === uid ? 'BUYER' : o.sellerId === uid ? 'SELLER' : 'ADMIN',
      buyerName: display(buyer),
      sellerName: display(seller),
      terms: ad.terms,
      paymentTypes: ad.paymentTypes,
      sellerPaymentMethods: o.status === 'COMPLETED' || o.status === 'CANCELED' ? [] : sellerMethods,
    };
  });

  app.post('/api/p2p/orders/:id/paid', { preHandler: requireSession }, async (req) => {
    const o = await loadOrder((req.params as any).id, req.user!.id);
    if (o.buyerId !== req.user!.id) throw forbidden('Only the buyer can mark the order as paid');
    await prisma.$transaction(async (tx) => {
      const r = await tx.p2POrder.updateMany({ where: { id: o.id, status: 'PENDING_PAYMENT', expiresAt: { gt: new Date() } }, data: { status: 'PAID', paidAt: new Date() } });
      if (!r.count) throw badRequest('Order can no longer be marked as paid');
      await systemMessage(tx, o.id, 'Buyer marked the payment as sent. Seller: confirm the money arrived in your account, then release the crypto.');
    });
    ping(o, 'P2P: payment marked as sent', `Order ${o.id.slice(-8)} — please check your account and release.`);
    return { ok: true };
  });

  app.post('/api/p2p/orders/:id/release', { preHandler: requireSession }, async (req) => {
    const { code } = z.object({ code: z.string().optional() }).parse(req.body ?? {});
    const u = req.user!;
    const o = await loadOrder((req.params as any).id, u.id);
    if (o.sellerId !== u.id) throw forbidden('Only the seller can release');
    if (o.status !== 'PAID') throw badRequest('You can release only after the buyer marks the order as paid');
    if (u.totpEnabled && (!code || !authenticator.check(code, u.totpSecret!))) throw badRequest('Invalid 2FA code');
    await prisma.$transaction((tx) => releaseOrder(tx, o, 'seller'));
    await audit(req, u.id, 'p2p.order_released', { id: o.id });
    ping(o, 'P2P order completed', `${o.amount} ${o.asset} released for order ${o.id.slice(-8)}.`);
    return { ok: true };
  });

  app.post('/api/p2p/orders/:id/cancel', { preHandler: requireSession }, async (req) => {
    const { reason } = z.object({ reason: z.string().trim().max(200).optional() }).parse(req.body ?? {});
    const o = await loadOrder((req.params as any).id, req.user!.id);
    if (o.buyerId !== req.user!.id) throw forbidden('Only the buyer can cancel. If there is a problem, open a dispute.');
    await prisma.$transaction((tx) => cancelOrderTx(tx, o, reason || 'canceled by buyer', ['PENDING_PAYMENT', 'PAID']));
    await audit(req, req.user!.id, 'p2p.order_canceled', { id: o.id });
    ping(o, 'P2P order canceled', `Order ${o.id.slice(-8)} was canceled by the buyer.`);
    return { ok: true };
  });

  app.post('/api/p2p/orders/:id/dispute', { preHandler: requireSession }, async (req) => {
    const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
    const o = await loadOrder((req.params as any).id, req.user!.id);
    await prisma.$transaction(async (tx) => {
      const r = await tx.p2POrder.updateMany({ where: { id: o.id, status: 'PAID' }, data: { status: 'DISPUTED', disputeReason: reason } });
      if (!r.count) throw badRequest('Disputes can be opened only after the order is marked as paid');
      await systemMessage(tx, o.id, `Dispute opened: ${reason}. Our support team will review the chat and payment proof.`);
    });
    await audit(req, req.user!.id, 'p2p.dispute_opened', { id: o.id });
    ping(o, 'P2P dispute opened', `Order ${o.id.slice(-8)} is under review.`);
    return { ok: true };
  });

  app.post('/api/p2p/orders/:id/messages', { preHandler: requireSession, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { body } = z.object({ body: z.string().trim().min(1).max(1000) }).parse(req.body);
    const o = await loadOrder((req.params as any).id, req.user!.id);
    const m = await prisma.p2PMessage.create({ data: { orderId: o.id, senderId: req.user!.id, body } });
    const other = o.buyerId === req.user!.id ? o.sellerId : o.buyerId;
    publish({ ch: 'user', userId: other, data: { type: 'p2p', orderId: o.id } });
    publish({ ch: 'user', userId: req.user!.id, data: { type: 'p2p', orderId: o.id } });
    return m;
  });

  // ---------- admin ----------
  app.get('/api/admin/p2p/orders', { preHandler: requireAdmin }, async (req) => {
    const { status } = z.object({ status: z.enum(['PENDING_PAYMENT', 'PAID', 'COMPLETED', 'CANCELED', 'DISPUTED']).default('DISPUTED') }).parse(req.query);
    return (await prisma.p2POrder.findMany({ where: { status }, orderBy: { updatedAt: 'asc' }, take: 100 })).map(ser);
  });

  app.post('/api/admin/p2p/orders/:id/resolve', { preHandler: requireAdmin }, async (req) => {
    const { outcome, note } = z.object({ outcome: z.enum(['RELEASE', 'CANCEL']), note: z.string().max(300).optional() }).parse(req.body);
    const o = await loadOrder((req.params as any).id, req.user!.id, true);
    if (o.status !== 'DISPUTED') throw badRequest('Order is not in dispute');
    await prisma.$transaction(async (tx) => {
      if (outcome === 'RELEASE') await releaseOrder(tx, o, 'support (dispute resolved for buyer)');
      else await cancelOrderTx(tx, o, `dispute resolved for seller${note ? `: ${note}` : ''}`, ['DISPUTED']);
    });
    await audit(req, req.user!.id, 'admin.p2p_dispute_resolved', { id: o.id, outcome });
    ping(o, 'P2P dispute resolved', `Order ${o.id.slice(-8)}: ${outcome === 'RELEASE' ? 'crypto released to buyer' : 'order canceled, crypto returned'}.`);
    return { ok: true };
  });
}
