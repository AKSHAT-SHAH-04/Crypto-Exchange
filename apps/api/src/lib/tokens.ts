import type { TokenPurpose } from '@prisma/client';
import { prisma } from '../db.js';
import { randomToken, sha256 } from './crypto.js';

export async function issueToken(userId: string, purpose: TokenPurpose, ttlMinutes: number, refId?: string) {
  const token = randomToken(24);
  await prisma.token.create({
    data: { userId, purpose, tokenHash: sha256(token), refId, expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
  });
  return token;
}

export async function consumeToken(token: string, purpose: TokenPurpose) {
  const rec = await prisma.token.findUnique({ where: { tokenHash: sha256(token) } });
  if (!rec || rec.purpose !== purpose || rec.usedAt || rec.expiresAt < new Date()) return null;
  const res = await prisma.token.updateMany({ where: { id: rec.id, usedAt: null }, data: { usedAt: new Date() } });
  return res.count === 1 ? rec : null;
}
