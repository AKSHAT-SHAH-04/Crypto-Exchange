import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireSession } from '../lib/auth.js';
import { FEE_TOKEN, FEE_TOKEN_DISCOUNT, VIP_TIERS, getFeeProfile, invalidateFeeProfile } from '../engine/fees.js';
import { listPairs } from '../engine/engine.js';

export async function feeRoutes(app: FastifyInstance) {
  app.get('/api/fees', async (req) => {
    const pairs = listPairs().filter((p) => p.enabled);
    const base = pairs[0];
    return {
      feeToken: FEE_TOKEN,
      feeTokenDiscount: FEE_TOKEN_DISCOUNT,
      baseMakerFee: base?.makerFee.toString() ?? '0.001',
      baseTakerFee: base?.takerFee.toString() ?? '0.001',
      tiers: VIP_TIERS,
      me: req.user ? await getFeeProfile(req.user.id, true) : null,
    };
  });

  app.patch('/api/fees/settings', { preHandler: requireSession }, async (req) => {
    const { payFeesWithToken } = z.object({ payFeesWithToken: z.boolean() }).parse(req.body);
    await prisma.user.update({ where: { id: req.user!.id }, data: { payFeesWithToken } });
    invalidateFeeProfile(req.user!.id);
    return { ok: true, payFeesWithToken };
  });

  app.get('/api/fees/me', { preHandler: requireAuth }, async (req) => getFeeProfile(req.user!.id, true));
}
