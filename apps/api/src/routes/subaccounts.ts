/**
 * Sub-accounts: a master account can create up to 20 sub-accounts (no separate login), move funds
 * between them, and switch into one to trade. Sub-accounts can't withdraw or create sub-accounts.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma, D, ZERO } from '../db.js';
import { requireSession, setSession, publicUser } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { randomToken } from '../lib/crypto.js';
import { adjustBalance, debitAvailable, notifyUser } from '../engine/engine.js';
import { usdPrice } from './wallet.js';

/** The master account behind the current session (itself, or the actor when switched into a sub). */
async function masterOf(req: FastifyRequest) {
  const id = req.actorId ?? req.user!.id;
  const master = await prisma.user.findUnique({ where: { id } });
  if (!master || master.parentId) throw forbidden('Sub-accounts cannot manage sub-accounts');
  return master;
}

export async function subAccountRoutes(app: FastifyInstance) {
  app.get('/api/subaccounts', { preHandler: requireSession }, async (req) => {
    const master = await masterOf(req);
    const subs = await prisma.user.findMany({
      where: { parentId: master.id },
      orderBy: { createdAt: 'asc' },
      include: { balances: true },
    });
    const value = (bs: { asset: string; available: any; locked: any }[]) =>
      bs.reduce((s, b) => s + b.available.plus(b.locked).toNumber() * usdPrice(b.asset), 0);
    const masterBalances = await prisma.balance.findMany({ where: { userId: master.id } });
    return {
      master: { id: master.id, email: master.email, totalUsd: value(masterBalances) },
      subs: subs.map((s) => ({
        id: s.id, label: s.subLabel, email: s.email, frozen: s.frozen, createdAt: s.createdAt, totalUsd: value(s.balances),
        balances: s.balances.filter((b) => b.available.plus(b.locked).gt(0)).map((b) => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString() })),
      })),
      current: req.user!.id,
    };
  });

  app.post('/api/subaccounts', { preHandler: requireSession }, async (req) => {
    const { label } = z.object({ label: z.string().trim().min(1).max(30).regex(/^[\w\- ]+$/, 'Letters, numbers, spaces, - and _ only') }).parse(req.body);
    const master = await masterOf(req);
    if ((await prisma.user.count({ where: { parentId: master.id } })) >= 20) throw badRequest('Maximum of 20 sub-accounts');
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sub';
    const sub = await prisma.user.create({
      data: {
        email: `${slug}.${randomToken(4)}@sub.${master.id}.local`,
        name: label, subLabel: label, parentId: master.id, emailVerified: true, kycStatus: master.kycStatus,
      },
    });
    await audit(req, master.id, 'subaccount.created', { id: sub.id, label });
    return { id: sub.id, label, email: sub.email };
  });

  app.post('/api/subaccounts/transfer', { preHandler: requireSession }, async (req) => {
    const b = z
      .object({ fromId: z.string(), toId: z.string(), asset: z.string(), amount: z.string().regex(/^\d+(\.\d+)?$/) })
      .parse(req.body);
    const master = await masterOf(req);
    if (b.fromId === b.toId) throw badRequest('Choose two different accounts');
    const family = new Set([master.id, ...(await prisma.user.findMany({ where: { parentId: master.id }, select: { id: true } })).map((u) => u.id)]);
    if (!family.has(b.fromId) || !family.has(b.toId)) throw notFound('Account not found');
    const frozen = await prisma.user.count({ where: { id: { in: [b.fromId, b.toId] }, OR: [{ frozen: true }, { frozenByAdmin: true }] } });
    if (frozen) throw forbidden('Transfers to or from a frozen account are not allowed');
    const asset = await prisma.asset.findUnique({ where: { symbol: b.asset } });
    if (!asset) throw badRequest('Unknown asset');
    const amount = new D(b.amount).toDecimalPlaces(asset.precision, D.ROUND_DOWN);
    if (amount.lte(ZERO)) throw badRequest('Amount must be positive');
    await prisma.$transaction(async (tx) => {
      await debitAvailable(tx, b.fromId, asset.symbol, amount);
      await adjustBalance(tx, b.toId, asset.symbol, amount);
      await tx.transaction.createMany({
        data: [
          { userId: b.fromId, type: 'TRANSFER', status: 'COMPLETED', asset: asset.symbol, amount: amount.neg(), note: 'Internal transfer out' },
          { userId: b.toId, type: 'TRANSFER', status: 'COMPLETED', asset: asset.symbol, amount, note: 'Internal transfer in' },
        ],
      });
    });
    await audit(req, master.id, 'subaccount.transfer', { ...b, amount: amount.toString() });
    notifyUser(b.fromId);
    notifyUser(b.toId);
    return { ok: true };
  });

  app.patch('/api/subaccounts/:id', { preHandler: requireSession }, async (req) => {
    const master = await masterOf(req);
    const { frozen } = z.object({ frozen: z.boolean() }).parse(req.body);
    const r = await prisma.user.updateMany({
      where: { id: (req.params as any).id, parentId: master.id, frozenByAdmin: false },
      data: { frozen, tokenVersion: { increment: 1 } },
    });
    if (!r.count) throw notFound('Sub-account not found (or frozen by support)');
    return { ok: true };
  });

  /** Switch the browser session into a sub-account. */
  app.post('/api/subaccounts/:id/switch', { preHandler: requireSession }, async (req, reply) => {
    const master = await masterOf(req);
    const sub = await prisma.user.findFirst({ where: { id: (req.params as any).id, parentId: master.id } });
    if (!sub) throw notFound();
    if (sub.frozen) throw forbidden('This sub-account is frozen');
    setSession(reply, sub, master);
    await audit(req, master.id, 'subaccount.switch', { to: sub.id });
    return { user: publicUser(sub, master) };
  });

  /** Return from a sub-account to the master account. */
  app.post('/api/subaccounts/return', { preHandler: requireSession }, async (req, reply) => {
    if (!req.actorId) return { ok: true };
    const master = await prisma.user.findUnique({ where: { id: req.actorId } });
    if (!master) throw notFound();
    setSession(reply, master);
    return { user: publicUser(master) };
  });
}
