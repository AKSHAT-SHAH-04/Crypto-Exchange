import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authenticator } from 'otplib';
import { prisma, D } from '../db.js';
import { config } from '../config.js';
import {
  clearSession, ensureCsrfCookie, publicUser, requireAuth, requireSession, setSession, signJwt, verifyJwt,
} from '../lib/auth.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { emails } from '../lib/email.js';
import { consumeToken, issueToken } from '../lib/tokens.js';
import { randomToken } from '../lib/crypto.js';

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[0-9]/, 'Password needs a number');

const strictLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

/** Creates a user with the paper-trading signup bonus. */
export async function createUser(data: { email: string; name?: string | null; passwordHash?: string; googleId?: string; emailVerified?: boolean }) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data });
    if (config.tradingMode === 'paper') {
      const amount = new D(config.signupBonus);
      await tx.balance.create({ data: { userId: user.id, asset: 'USDT', available: amount } });
      await tx.transaction.create({
        data: { userId: user.id, type: 'BONUS', status: 'COMPLETED', asset: 'USDT', amount, note: 'Paper trading welcome bonus' },
      });
    }
    return user;
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/csrf', async (req, reply) => ({ csrfToken: ensureCsrfCookie(req, reply) }));

  app.get('/api/auth/me', async (req, reply) => {
    ensureCsrfCookie(req, reply);
    const actor = req.actorId ? await prisma.user.findUnique({ where: { id: req.actorId }, select: { email: true } }) : null;
    return { user: req.user ? publicUser(req.user, actor) : null, googleEnabled: !!config.googleClientId, tradingMode: config.tradingMode };
  });

  app.post('/api/auth/register', strictLimit, async (req, reply) => {
    const body = z
      .object({ email: z.string().email().max(200), password: passwordSchema, name: z.string().trim().max(80).optional() })
      .parse(req.body);
    const email = body.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) throw badRequest('An account with this email already exists');
    const user = await createUser({ email, name: body.name || null, passwordHash: await bcrypt.hash(body.password, 12) });
    const token = await issueToken(user.id, 'VERIFY_EMAIL', 60 * 24);
    await emails.verify(email, token);
    await audit(req, user.id, 'auth.register');
    setSession(reply, user);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/login', strictLimit, async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    const ok = user?.passwordHash && (await bcrypt.compare(body.password, user.passwordHash));
    if (!user || !ok) {
      await audit(req, user?.id ?? null, 'auth.login_failed', { email: body.email });
      throw unauthorized('Invalid email or password');
    }
    if (user.frozen) throw unauthorized('Account is frozen. Contact support.');
    if (user.totpEnabled) {
      return { twoFactorRequired: true, ticket: signJwt(user.id, '2fa', {}, 300) };
    }
    setSession(reply, user);
    await audit(req, user.id, 'auth.login');
    return { user: publicUser(user) };
  });

  app.post('/api/auth/login/2fa', strictLimit, async (req, reply) => {
    const body = z.object({ ticket: z.string(), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const p = verifyJwt(body.ticket, '2fa');
    if (!p) throw unauthorized('Login session expired, please sign in again');
    const user = await prisma.user.findUnique({ where: { id: p.sub } });
    if (!user?.totpSecret || !authenticator.check(body.code, user.totpSecret)) {
      await audit(req, p.sub, 'auth.2fa_failed');
      throw unauthorized('Invalid authentication code');
    }
    setSession(reply, user);
    await audit(req, user.id, 'auth.login', { twoFactor: true });
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.user) await audit(req, req.user.id, 'auth.logout');
    clearSession(reply);
    return { ok: true };
  });

  /** Signs out every device by bumping tokenVersion. */
  app.post('/api/auth/logout-all', { preHandler: requireSession }, async (req, reply) => {
    await prisma.user.update({ where: { id: req.user!.id }, data: { tokenVersion: { increment: 1 } } });
    await audit(req, req.user!.id, 'auth.logout_all');
    clearSession(reply);
    return { ok: true };
  });

  app.post('/api/auth/verify-email', async (req) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    const rec = await consumeToken(token, 'VERIFY_EMAIL');
    if (!rec) throw badRequest('This verification link is invalid or has expired');
    await prisma.user.update({ where: { id: rec.userId }, data: { emailVerified: true } });
    await audit(req, rec.userId, 'auth.email_verified');
    return { ok: true };
  });

  app.post('/api/auth/resend-verification', { preHandler: requireAuth, ...strictLimit }, async (req) => {
    if (req.user!.emailVerified) return { ok: true };
    await emails.verify(req.user!.email, await issueToken(req.user!.id, 'VERIFY_EMAIL', 60 * 24));
    return { ok: true };
  });

  app.post('/api/auth/forgot-password', strictLimit, async (req) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user) {
      await emails.reset(user.email, await issueToken(user.id, 'RESET_PASSWORD', 60));
      await audit(req, user.id, 'auth.password_reset_requested');
    }
    return { ok: true }; // never reveal whether the email exists
  });

  app.post('/api/auth/reset-password', strictLimit, async (req) => {
    const body = z.object({ token: z.string().min(10), password: passwordSchema }).parse(req.body);
    const rec = await consumeToken(body.token, 'RESET_PASSWORD');
    if (!rec) throw badRequest('This reset link is invalid or has expired');
    await prisma.user.update({
      where: { id: rec.userId },
      data: { passwordHash: await bcrypt.hash(body.password, 12), tokenVersion: { increment: 1 } },
    });
    await audit(req, rec.userId, 'auth.password_reset');
    return { ok: true };
  });

  /** Short-lived token used to authenticate the WebSocket private channel. */
  app.get('/api/auth/ws-token', { preHandler: requireAuth }, async (req) => ({
    token: signJwt(req.user!.id, 'ws', {}, 60),
  }));

  // ---------- Google OAuth ----------
  app.get('/api/auth/google', async (req, reply) => {
    if (!config.googleClientId) throw badRequest('Google login is not configured');
    const state = randomToken(16);
    reply.setCookie('cx_oauth_state', state, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 600 });
    const params = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: `${config.webUrl}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string };
    const fail = (why: string) => reply.redirect(`${config.webUrl}/login?error=${encodeURIComponent(why)}`);
    if (!q.code || !q.state || q.state !== req.cookies.cx_oauth_state) return fail('Google sign-in failed (state mismatch)');
    reply.clearCookie('cx_oauth_state', { path: '/' });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: `${config.webUrl}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return fail('Google sign-in failed');
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access_token}` } });
    const info = (await infoRes.json()) as { sub: string; email: string; email_verified: boolean; name?: string };
    if (!info.email_verified) return fail('Your Google email is not verified');

    let user = await prisma.user.findFirst({ where: { OR: [{ googleId: info.sub }, { email: info.email.toLowerCase() }] } });
    if (!user) {
      user = await createUser({ email: info.email.toLowerCase(), name: info.name, googleId: info.sub, emailVerified: true });
      await audit(req, user.id, 'auth.register', { via: 'google' });
    } else if (!user.googleId) {
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId: info.sub, emailVerified: true } });
    }
    if (user.frozen) return fail('Account is frozen');
    if (user.totpEnabled) {
      const ticket = signJwt(user.id, '2fa', {}, 300);
      return reply.redirect(`${config.webUrl}/login?ticket=${encodeURIComponent(ticket)}`);
    }
    setSession(reply, user);
    await audit(req, user.id, 'auth.login', { via: 'google' });
    return reply.redirect(`${config.webUrl}/markets`);
  });
}
