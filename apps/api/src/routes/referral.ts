/** Referral program: users earn REFERRAL_RATE of the trading fees paid by people who sign up with their link. */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { requireSession } from '../lib/auth.js';
import { forbidden } from '../lib/errors.js';
import { REFERRAL_RATE } from '../engine/fees.js';
import { newReferralCode } from './auth.js';

const maskEmail = (e: string) => {
  const [u, d] = e.split('@');
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(2, Math.min(6, u.length - 2)))}@${d}`;
};

export async function referralRoutes(app: FastifyInstance) {
  app.get('/api/referral', { preHandler: requireSession }, async (req) => {
    const u = req.user!;
    if (u.parentId) throw forbidden('Referrals are managed from your main account');
    let code = u.referralCode;
    if (!code) {
      // accounts created before the referral program get a code on first visit
      for (let i = 0; i < 5 && !code; i++) {
        try {
          code = (await prisma.user.update({ where: { id: u.id }, data: { referralCode: newReferralCode() } })).referralCode;
        } catch {
          /* collision — retry */
        }
      }
    }
    const [referees, totals, byReferee, recent] = await Promise.all([
      prisma.user.findMany({
        where: { referredById: u.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, email: true, createdAt: true, kycStatus: true },
      }),
      prisma.referralReward.groupBy({ by: ['asset'], where: { referrerId: u.id }, _sum: { amount: true, usdValue: true } }),
      prisma.referralReward.groupBy({ by: ['refereeId'], where: { referrerId: u.id }, _sum: { usdValue: true } }),
      prisma.referralReward.findMany({ where: { referrerId: u.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);
    const earnedBy = new Map(byReferee.map((r) => [r.refereeId, r._sum.usdValue?.toNumber() ?? 0]));
    const totalUsd = totals.reduce((s, t) => s + (t._sum.usdValue?.toNumber() ?? 0), 0);
    const refereeCount = await prisma.user.count({ where: { referredById: u.id } });
    return {
      code,
      link: `${config.webUrl}/register?ref=${code}`,
      commissionRate: REFERRAL_RATE,
      stats: {
        friends: refereeCount,
        trading: byReferee.length,
        totalUsd,
        byAsset: totals.map((t) => ({ asset: t.asset, amount: t._sum.amount?.toString() ?? '0', usd: t._sum.usdValue?.toNumber() ?? 0 })),
      },
      referees: referees.map((r) => ({ id: r.id, email: maskEmail(r.email), joinedAt: r.createdAt, verified: r.kycStatus === 'APPROVED', earnedUsd: earnedBy.get(r.id) ?? 0 })),
      recent: recent.map((r) => ({ id: r.id, asset: r.asset, amount: r.amount.toString(), usd: r.usdValue.toNumber(), createdAt: r.createdAt })),
    };
  });
}
