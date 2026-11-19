import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';

export async function audit(req: FastifyRequest | null, userId: string | null, action: string, meta?: Record<string, unknown>) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        ip: req?.ip,
        userAgent: req?.headers['user-agent']?.slice(0, 255),
        meta: meta as any,
      },
    });
  } catch (e) {
    console.error('[audit] failed', e);
  }
}
