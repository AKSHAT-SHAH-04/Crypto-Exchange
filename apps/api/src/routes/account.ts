import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { publicUser, requireAuth, requireSession, setSession } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { encrypt, randomToken } from '../lib/crypto.js';
import { passwordSchema } from './auth.js';
import { getPair } from '../engine/engine.js';

const code6 = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export async function accountRoutes(app: FastifyInstance) {
  app.patch('/api/account/profile', { preHandler: requireSession }, async (req) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    const u = await prisma.user.update({ where: { id: req.user!.id }, data: { name } });
    return publicUser(u);
  });

  // ---------- password ----------
  app.post('/api/account/password', { preHandler: requireSession, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ current: z.string().optional(), next: passwordSchema }).parse(req.body);
    const u = req.user!;
    if (u.passwordHash && !(body.current && (await bcrypt.compare(body.current, u.passwordHash)))) throw badRequest('Current password is incorrect');
    const updated = await prisma.user.update({
      where: { id: u.id },
      data: { passwordHash: await bcrypt.hash(body.next, 12), tokenVersion: { increment: 1 } },
    });
    setSession(reply, updated); // keep this device signed in, sign out others
    await audit(req, u.id, 'account.password_changed');
    return { ok: true };
  });

  // ---------- 2FA (TOTP) ----------
  app.post('/api/account/2fa/setup', { preHandler: requireSession }, async (req) => {
    const u = req.user!;
    if (u.totpEnabled) throw badRequest('2FA is already enabled');
    const secret = authenticator.generateSecret();
    await prisma.user.update({ where: { id: u.id }, data: { totpSecret: secret } });
    const otpauth = authenticator.keyuri(u.email, config.brand, secret);
    return { secret, otpauth, qr: await QRCode.toDataURL(otpauth) };
  });

  app.post('/api/account/2fa/enable', { preHandler: requireSession }, async (req) => {
    const { code } = z.object({ code: code6 }).parse(req.body);
    const u = req.user!;
    if (!u.totpSecret || !authenticator.check(code, u.totpSecret)) throw badRequest('Invalid code — check your authenticator app');
    await prisma.user.update({ where: { id: u.id }, data: { totpEnabled: true } });
    await audit(req, u.id, 'account.2fa_enabled');
    return { ok: true };
  });

  app.post('/api/account/2fa/disable', { preHandler: requireSession }, async (req) => {
    const { code } = z.object({ code: code6 }).parse(req.body);
    const u = req.user!;
    if (!u.totpEnabled || !u.totpSecret || !authenticator.check(code, u.totpSecret)) throw badRequest('Invalid code');
    await prisma.user.update({ where: { id: u.id }, data: { totpEnabled: false, totpSecret: null } });
    await audit(req, u.id, 'account.2fa_disabled');
    return { ok: true };
  });

  // ---------- KYC ----------
  app.get('/api/account/kyc', { preHandler: requireSession }, async (req) => {
    const latest = await prisma.kycSubmission.findFirst({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
    return { status: req.user!.kycStatus, submission: latest && { ...latest, idNumber: `•••• ${latest.idNumber.slice(-4)}` } };
  });

  app.post('/api/account/kyc', { preHandler: requireSession }, async (req) => {
    const body = z
      .object({
        fullName: z.string().trim().min(3).max(100),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
        country: z.string().trim().min(2).max(60),
        idType: z.enum(['PASSPORT', 'NATIONAL_ID', 'DRIVING_LICENSE', 'PAN']),
        idNumber: z.string().trim().min(4).max(40),
      })
      .parse(req.body);
    const u = req.user!;
    if (u.kycStatus === 'PENDING' || u.kycStatus === 'APPROVED') throw badRequest(`KYC is already ${u.kycStatus.toLowerCase()}`);
    const age = (Date.now() - new Date(body.dateOfBirth).getTime()) / (365.25 * 86400e3);
    if (!(age >= 18)) throw badRequest('You must be at least 18 years old');
    await prisma.$transaction([
      prisma.kycSubmission.create({ data: { userId: u.id, ...body } }),
      prisma.user.update({ where: { id: u.id }, data: { kycStatus: 'PENDING' } }),
    ]);
    await audit(req, u.id, 'account.kyc_submitted');
    return { ok: true };
  });

  // ---------- API keys ----------
  app.get('/api/account/api-keys', { preHandler: requireSession }, async (req) => {
    const keys = await prisma.apiKey.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
    return keys.map(({ secretEncrypted, ...k }) => k);
  });

  app.post('/api/account/api-keys', { preHandler: requireSession }, async (req) => {
    const body = z.object({ label: z.string().trim().min(1).max(40), canTrade: z.boolean().default(false), code: z.string().optional() }).parse(req.body);
    const u = req.user!;
    if (u.totpEnabled && (!body.code || !authenticator.check(body.code, u.totpSecret!))) throw badRequest('Invalid 2FA code');
    if ((await prisma.apiKey.count({ where: { userId: u.id } })) >= 10) throw badRequest('Maximum of 10 API keys');
    const key = `ck_${randomToken(16)}`;
    const secret = randomToken(32);
    const rec = await prisma.apiKey.create({ data: { userId: u.id, label: body.label, key, secretEncrypted: encrypt(secret), canTrade: body.canTrade } });
    await audit(req, u.id, 'account.api_key_created', { id: rec.id, canTrade: body.canTrade });
    return { id: rec.id, label: rec.label, key, secret, canTrade: rec.canTrade, createdAt: rec.createdAt };
  });

  app.delete('/api/account/api-keys/:id', { preHandler: requireSession }, async (req) => {
    const r = await prisma.apiKey.deleteMany({ where: { id: (req.params as any).id, userId: req.user!.id } });
    if (!r.count) throw notFound();
    await audit(req, req.user!.id, 'account.api_key_deleted', { id: (req.params as any).id });
    return { ok: true };
  });

  // ---------- favorites ----------
  app.get('/api/account/favorites', { preHandler: requireAuth }, async (req) =>
    (await prisma.favorite.findMany({ where: { userId: req.user!.id } })).map((f) => f.symbol),
  );
  app.put('/api/account/favorites/:symbol', { preHandler: requireAuth }, async (req) => {
    const symbol = String((req.params as any).symbol).toUpperCase();
    if (!getPair(symbol)) throw notFound('Market not found');
    await prisma.favorite.upsert({ where: { userId_symbol: { userId: req.user!.id, symbol } }, create: { userId: req.user!.id, symbol }, update: {} });
    return { ok: true };
  });
  app.delete('/api/account/favorites/:symbol', { preHandler: requireAuth }, async (req) => {
    await prisma.favorite.deleteMany({ where: { userId: req.user!.id, symbol: String((req.params as any).symbol).toUpperCase() } });
    return { ok: true };
  });

  // ---------- activity ----------
  app.get('/api/account/activity', { preHandler: requireSession }, async (req) =>
    prisma.auditLog.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, action: true, ip: true, userAgent: true, createdAt: true, meta: true },
    }),
  );
}
