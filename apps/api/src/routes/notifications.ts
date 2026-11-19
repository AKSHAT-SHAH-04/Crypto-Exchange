import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../lib/auth.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/api/notifications', { preHandler: requireAuth }, async (req) => {
    const { unread } = z.object({ unread: z.coerce.boolean().optional() }).parse(req.query);
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where: { userId: req.user!.id, ...(unread ? { read: false } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.notification.count({ where: { userId: req.user!.id, read: false } }),
    ]);
    return { items, unreadCount };
  });

  app.post('/api/notifications/read', { preHandler: requireAuth }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()).max(200).optional() }).parse(req.body ?? {});
    await prisma.notification.updateMany({ where: { userId: req.user!.id, read: false, ...(ids ? { id: { in: ids } } : {}) }, data: { read: true } });
    return { ok: true };
  });

  app.delete('/api/notifications', { preHandler: requireAuth }, async (req) => {
    await prisma.notification.deleteMany({ where: { userId: req.user!.id, read: true } });
    return { ok: true };
  });
}
