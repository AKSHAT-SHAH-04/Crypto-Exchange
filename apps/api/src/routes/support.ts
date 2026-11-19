import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { audit } from '../lib/audit.js';

const CATEGORIES = ['Account', 'Deposit & Withdrawal', 'Trading', 'P2P', 'KYC', 'API', 'Other'] as const;
const msg = z.object({ body: z.string().trim().min(1).max(5000) });

export async function supportRoutes(app: FastifyInstance) {
  // ---------- user ----------
  app.get('/api/support/tickets', { preHandler: requireAuth }, async (req) =>
    prisma.supportTicket.findMany({ where: { userId: req.user!.id }, orderBy: { updatedAt: 'desc' }, take: 100 }),
  );

  app.post('/api/support/tickets', { preHandler: requireAuth, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ subject: z.string().trim().min(3).max(150), category: z.enum(CATEGORIES), body: z.string().trim().min(1).max(5000) }).parse(req.body);
    const t = await prisma.supportTicket.create({
      data: { userId: req.user!.id, subject: b.subject, category: b.category, messages: { create: { authorId: req.user!.id, body: b.body } } },
    });
    await audit(req, req.user!.id, 'support.ticket_created', { id: t.id });
    return t;
  });

  const getOwn = async (id: string, userId: string) => {
    const t = await prisma.supportTicket.findFirst({ where: { id, userId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!t) throw notFound('Ticket not found');
    return t;
  };

  app.get('/api/support/tickets/:id', { preHandler: requireAuth }, async (req) => getOwn((req.params as any).id, req.user!.id));

  app.post('/api/support/tickets/:id/messages', { preHandler: requireAuth }, async (req) => {
    const t = await getOwn((req.params as any).id, req.user!.id);
    if (t.status === 'CLOSED') throw badRequest('This ticket is closed. Please open a new one.');
    const { body } = msg.parse(req.body);
    await prisma.$transaction([
      prisma.ticketMessage.create({ data: { ticketId: t.id, authorId: req.user!.id, body } }),
      prisma.supportTicket.update({ where: { id: t.id }, data: { status: 'OPEN' } }),
    ]);
    return { ok: true };
  });

  app.post('/api/support/tickets/:id/close', { preHandler: requireAuth }, async (req) => {
    const t = await getOwn((req.params as any).id, req.user!.id);
    await prisma.supportTicket.update({ where: { id: t.id }, data: { status: 'CLOSED' } });
    return { ok: true };
  });

  // ---------- admin ----------
  app.get('/api/admin/tickets', { preHandler: requireAdmin }, async (req) => {
    const { status } = z.object({ status: z.enum(['OPEN', 'ANSWERED', 'CLOSED']).default('OPEN') }).parse(req.query);
    return prisma.supportTicket.findMany({ where: { status }, orderBy: { updatedAt: 'asc' }, take: 100, include: { user: { select: { email: true } } } });
  });

  app.get('/api/admin/tickets/:id', { preHandler: requireAdmin }, async (req) => {
    const t = await prisma.supportTicket.findUnique({
      where: { id: (req.params as any).id },
      include: { messages: { orderBy: { createdAt: 'asc' } }, user: { select: { email: true, name: true } } },
    });
    if (!t) throw notFound();
    return t;
  });

  app.post('/api/admin/tickets/:id/reply', { preHandler: requireAdmin }, async (req) => {
    const id = (req.params as any).id;
    const b = z.object({ body: z.string().trim().min(1).max(5000), close: z.boolean().default(false) }).parse(req.body);
    const t = await prisma.supportTicket.findUnique({ where: { id } });
    if (!t) throw notFound();
    await prisma.$transaction([
      prisma.ticketMessage.create({ data: { ticketId: id, authorId: req.user!.id, staff: true, body: b.body } }),
      prisma.supportTicket.update({ where: { id }, data: { status: b.close ? 'CLOSED' : 'ANSWERED' } }),
    ]);
    await notify(t.userId, { type: 'support', title: 'Support replied to your ticket', body: t.subject, link: `/support/${id}` });
    await audit(req, req.user!.id, 'admin.ticket_replied', { id });
    return { ok: true };
  });
}
