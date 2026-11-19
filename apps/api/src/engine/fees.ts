/**
 * VIP fee tiers (by 30-day spot volume in USD) and the fee-discount token.
 * The pair's maker/taker fee (set by admins) is multiplied by the tier multiplier.
 */
import { prisma } from '../db.js';

export const FEE_TOKEN = (process.env.FEE_DISCOUNT_ASSET || 'BNB').toUpperCase();
export const FEE_TOKEN_DISCOUNT = Number(process.env.FEE_DISCOUNT_RATE || '0.25');

export const VIP_TIERS = [
  { level: 0, minVolume: 0, makerMult: 1, takerMult: 1 },
  { level: 1, minVolume: 1_000_000, makerMult: 0.9, takerMult: 0.9 },
  { level: 2, minVolume: 5_000_000, makerMult: 0.8, takerMult: 0.85 },
  { level: 3, minVolume: 20_000_000, makerMult: 0.6, takerMult: 0.8 },
  { level: 4, minVolume: 100_000_000, makerMult: 0.4, takerMult: 0.7 },
  { level: 5, minVolume: 500_000_000, makerMult: 0.2, takerMult: 0.6 },
] as const;

export interface FeeProfile {
  level: number;
  makerMult: number;
  takerMult: number;
  payWithToken: boolean;
  volume30d: number;
}

const cache = new Map<string, { at: number; p: FeeProfile }>();
const TTL = 5 * 60_000;

export async function volume30d(userId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ v: string | null }[]>`
    SELECT COALESCE(SUM(price * quantity), 0)::text AS v FROM "Trade"
    WHERE ("buyerId" = ${userId} OR "sellerId" = ${userId}) AND "createdAt" > now() - interval '30 days'`;
  return Number(rows[0]?.v ?? 0);
}

export function tierFor(volume: number, override?: number | null) {
  if (override !== null && override !== undefined) return VIP_TIERS[Math.max(0, Math.min(VIP_TIERS.length - 1, override))];
  return [...VIP_TIERS].reverse().find((t) => volume >= t.minVolume) ?? VIP_TIERS[0];
}

export async function getFeeProfile(userId: string, fresh = false): Promise<FeeProfile> {
  const hit = cache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.p;
  const [user, vol] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { payFeesWithToken: true, vipOverride: true } }),
    volume30d(userId),
  ]);
  const t = tierFor(vol, user?.vipOverride);
  const p = { level: t.level, makerMult: t.makerMult, takerMult: t.takerMult, payWithToken: !!user?.payFeesWithToken, volume30d: vol };
  cache.set(userId, { at: Date.now(), p });
  return p;
}

export const invalidateFeeProfile = (userId: string) => cache.delete(userId);
