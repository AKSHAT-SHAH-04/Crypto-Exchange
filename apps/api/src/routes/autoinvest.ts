/**
 * Auto-Invest (recurring buys / DCA): buy a fixed amount of a coin every hour/day/week/month,
 * paid from USDT or local fiat. Executes through Convert pricing (0.1% spread, no fee).
 * Three failed runs in a row (e.g. insufficient balance) pause the plan and notify the user.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AutoInvestFrequency, AutoInvestPlan } from '@prisma/client';
import { prisma, D } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireSession } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { scheduleJob } from '../lib/jobs.js';
import { priceConvert, settleConvert } from '../lib/convert.js';
import { notifyUser } from '../engine/engine.js';

const MAX_FAILS = 3;

export function nextRun(from: Date, f: AutoInvestFrequency) {
  const d = new Date(from);
  if (f === 'HOURLY') d.setUTCHours(d.getUTCHours() + 1);
  else if (f === 'DAILY') d.setUTCDate(d.getUTCDate() + 1);
  else if (f === 'WEEKLY') d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

const ser = (p: AutoInvestPlan) => ({
  ...p, amountPerRun: p.amountPerRun.toString(), totalInvested: p.totalInvested.toString(), totalBought: p.totalBought.toString(),
  avgPrice: p.totalBought.gt(0) ? p.totalInvested.div(p.totalBought).toSignificantDigits(10).toString() : null,
});

async function executePlan(plan: AutoInvestPlan) {
  // claim this run: moving nextRunAt forward first means a crash can't cause a double buy
  const next = nextRun(plan.nextRunAt < new Date(Date.now() - 86400e3) ? new Date() : plan.nextRunAt, plan.frequency);
  const claimed = await prisma.autoInvestPlan.updateMany({ where: { id: plan.id, status: 'ACTIVE', nextRunAt: plan.nextRunAt }, data: { nextRunAt: next } });
  if (!claimed.count) return;
  try {
    const user = await prisma.user.findUnique({ where: { id: plan.userId } });
    if (!user || user.frozen || user.frozenByAdmin) throw new Error('Account is frozen');
    const c = await priceConvert(plan.sourceAsset, plan.targetAsset, plan.amountPerRun);
    await settleConvert(plan.userId, c);
    await prisma.$transaction([
      prisma.autoInvestRun.create({ data: { planId: plan.id, ok: true, spent: c.fromAmount, bought: c.toAmount, price: new D(1).div(c.rate).toSignificantDigits(10) } }),
      prisma.autoInvestPlan.update({
        where: { id: plan.id },
        data: { totalInvested: { increment: c.fromAmount }, totalBought: { increment: c.toAmount }, runs: { increment: 1 }, failedRuns: 0 },
      }),
    ]);
    notifyUser(plan.userId);
  } catch (e) {
    const msg = (e as Error).message.slice(0, 200);
    const updated = await prisma.autoInvestPlan.update({ where: { id: plan.id }, data: { failedRuns: { increment: 1 } } });
    await prisma.autoInvestRun.create({ data: { planId: plan.id, ok: false, error: msg } });
    if (updated.failedRuns >= MAX_FAILS) {
      await prisma.autoInvestPlan.update({ where: { id: plan.id }, data: { status: 'PAUSED' } });
      await notify(plan.userId, { type: 'wallet', title: 'Auto-Invest plan paused', body: `Your ${plan.targetAsset} plan failed ${MAX_FAILS} times in a row: ${msg}`, link: '/auto-invest' });
    } else {
      await notify(plan.userId, { type: 'wallet', title: 'Auto-Invest purchase skipped', body: `${plan.targetAsset}: ${msg}`, link: '/auto-invest' });
    }
  }
}

export async function autoInvestRoutes(app: FastifyInstance) {
  scheduleJob('auto-invest', 30_000, async () => {
    const due = await prisma.autoInvestPlan.findMany({ where: { status: 'ACTIVE', nextRunAt: { lte: new Date() } }, orderBy: { nextRunAt: 'asc' }, take: 100 });
    for (const p of due) await executePlan(p);
  });

  app.get('/api/auto-invest', { preHandler: requireAuth }, async (req) => {
    const plans = await prisma.autoInvestPlan.findMany({
      where: { userId: req.user!.id, status: { not: 'ENDED' } },
      orderBy: { createdAt: 'desc' },
      include: { history: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    return plans.map((p) => ({
      ...ser(p),
      history: p.history.map((r) => ({ ...r, spent: r.spent.toString(), bought: r.bought.toString(), price: r.price?.toString() ?? null })),
    }));
  });

  app.post('/api/auto-invest', { preHandler: requireSession }, async (req) => {
    const b = z
      .object({
        sourceAsset: z.string().toUpperCase(),
        targetAsset: z.string().toUpperCase(),
        amountPerRun: z.string().regex(/^\d+(\.\d+)?$/),
        frequency: z.enum(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']),
        startNow: z.boolean().default(true),
      })
      .parse(req.body);
    const u = req.user!;
    if (config.isLive && u.kycStatus !== 'APPROVED') throw forbidden('Complete identity verification (KYC) to use Auto-Invest');
    const target = await prisma.asset.findUnique({ where: { symbol: b.targetAsset } });
    if (!target?.enabled || target.isFiat) throw badRequest('Choose a crypto asset to buy');
    // validates the pair, price availability and the $ minimum without executing
    await priceConvert(b.sourceAsset, b.targetAsset, b.amountPerRun, { minUsd: 1, maxUsd: 100_000 });
    if ((await prisma.autoInvestPlan.count({ where: { userId: u.id, status: { not: 'ENDED' } } })) >= 20) throw badRequest('Maximum of 20 plans');
    const now = new Date();
    const plan = await prisma.autoInvestPlan.create({
      data: {
        userId: u.id, sourceAsset: b.sourceAsset, targetAsset: b.targetAsset, amountPerRun: new D(b.amountPerRun), frequency: b.frequency,
        nextRunAt: b.startNow ? now : nextRun(now, b.frequency),
      },
    });
    await audit(req, u.id, 'autoinvest.created', { id: plan.id, ...b });
    if (b.startNow) await executePlan(plan);
    return ser((await prisma.autoInvestPlan.findUnique({ where: { id: plan.id } }))!);
  });

  app.patch('/api/auto-invest/:id', { preHandler: requireSession }, async (req) => {
    const { status } = z.object({ status: z.enum(['ACTIVE', 'PAUSED']) }).parse(req.body);
    const plan = await prisma.autoInvestPlan.findFirst({ where: { id: (req.params as any).id, userId: req.user!.id, status: { not: 'ENDED' } } });
    if (!plan) throw notFound();
    await prisma.autoInvestPlan.update({
      where: { id: plan.id },
      // resuming schedules the next run from now and clears the failure streak
      data: { status, ...(status === 'ACTIVE' ? { failedRuns: 0, nextRunAt: plan.nextRunAt < new Date() ? new Date() : plan.nextRunAt } : {}) },
    });
    return { ok: true };
  });

  app.delete('/api/auto-invest/:id', { preHandler: requireSession }, async (req) => {
    const r = await prisma.autoInvestPlan.updateMany({ where: { id: (req.params as any).id, userId: req.user!.id }, data: { status: 'ENDED' } });
    if (!r.count) throw notFound();
    return { ok: true };
  });
}
