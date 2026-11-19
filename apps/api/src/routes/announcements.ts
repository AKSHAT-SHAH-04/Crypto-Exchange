import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAdmin } from '../lib/auth.js';
import { notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const body = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(1).max(20_000),
  category: z.enum(['General', 'New Listing', 'Maintenance', 'Promotion', 'Product', 'Security']).default('General'),
  pinned: z.boolean().default(false),
  published: z.boolean().default(true),
});

export async function announcementRoutes(app: FastifyInstance) {
  app.get('/api/announcements', async (req) => {
    const { category } = z.object({ category: z.string().optional() }).parse(req.query);
    return prisma.announcement.findMany({
      where: { published: true, ...(category ? { category } : {}) },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
  });

  app.get('/api/announcements/:id', async (req) => {
    const a = await prisma.announcement.findFirst({ where: { id: (req.params as any).id, published: true } });
    if (!a) throw notFound();
    return a;
  });

  app.get('/api/admin/announcements', { preHandler: requireAdmin }, async () =>
    prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
  );

  app.post('/api/admin/announcements', { preHandler: requireAdmin }, async (req) => {
    const a = await prisma.announcement.create({ data: body.parse(req.body) });
    await audit(req, req.user!.id, 'admin.announcement_created', { id: a.id });
    return a;
  });

  app.patch('/api/admin/announcements/:id', { preHandler: requireAdmin }, async (req) => {
    const id = (req.params as any).id;
    const a = await prisma.announcement.update({ where: { id }, data: body.partial().parse(req.body) }).catch(() => {
      throw notFound();
    });
    await audit(req, req.user!.id, 'admin.announcement_updated', { id });
    return a;
  });

  app.delete('/api/admin/announcements/:id', { preHandler: requireAdmin }, async (req) => {
    const id = (req.params as any).id;
    await prisma.announcement.delete({ where: { id } }).catch(() => {
      throw notFound();
    });
    await audit(req, req.user!.id, 'admin.announcement_deleted', { id });
    return { ok: true };
  });
}
