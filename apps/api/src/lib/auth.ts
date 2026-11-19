import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { decrypt, hmac, randomToken, safeEqual } from './crypto.js';
import { forbidden, unauthorized } from './errors.js';

export const SESSION_COOKIE = 'cx_session';
export const CSRF_COOKIE = 'cx_csrf';
const SESSION_TTL_S = 60 * 60 * 24 * 7;

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    authVia?: 'session' | 'apikey';
    apiKeyCanTrade?: boolean;
  }
}

type Purpose = 'session' | '2fa' | 'ws';

export function signJwt(sub: string, purpose: Purpose, extra: Record<string, unknown> = {}, expiresIn: number = SESSION_TTL_S) {
  return jwt.sign({ sub, purpose, ...extra }, config.jwtSecret, { expiresIn });
}

export function verifyJwt(token: string, purpose: Purpose): (jwt.JwtPayload & { sub: string; tv?: number }) | null {
  try {
    const p = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    if (p.purpose !== purpose || typeof p.sub !== 'string') return null;
    return p as any;
  } catch {
    return null;
  }
}

const cookieOpts = { path: '/', sameSite: 'lax' as const, secure: config.isProd };

export function setSession(reply: FastifyReply, user: User) {
  const token = signJwt(user.id, 'session', { tv: user.tokenVersion });
  reply.setCookie(SESSION_COOKIE, token, { ...cookieOpts, httpOnly: true, maxAge: SESSION_TTL_S });
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function ensureCsrfCookie(req: FastifyRequest, reply: FastifyReply) {
  let token = req.cookies[CSRF_COOKIE];
  if (!token) {
    token = randomToken(16);
    reply.setCookie(CSRF_COOKIE, token, { ...cookieOpts, httpOnly: false, maxAge: SESSION_TTL_S });
  }
  return token;
}

/** Resolves req.user from session cookie or signed API key headers. Never throws. */
export async function resolveUser(req: FastifyRequest) {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string') {
    const ts = String(req.headers['x-api-timestamp'] ?? '');
    const sig = String(req.headers['x-api-signature'] ?? '');
    if (!ts || !sig || Math.abs(Date.now() - Number(ts)) > 30_000) return;
    const key = await prisma.apiKey.findUnique({ where: { key: apiKey }, include: { user: true } });
    if (!key) return;
    const body = req.body ? JSON.stringify(req.body) : '';
    const expected = hmac(decrypt(key.secretEncrypted), `${ts}${req.method}${req.url}${body}`);
    if (!safeEqual(expected, sig)) return;
    req.user = key.user;
    req.authVia = 'apikey';
    req.apiKeyCanTrade = key.canTrade;
    prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    return;
  }
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return;
  const payload = verifyJwt(token, 'session');
  if (!payload) return;
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.tokenVersion !== payload.tv) return;
  req.user = user;
  req.authVia = 'session';
}

export async function requireAuth(req: FastifyRequest) {
  if (!req.user) throw unauthorized();
  if (req.user.frozen) throw forbidden('Account is frozen. Contact support.');
}

export async function requireTrade(req: FastifyRequest) {
  await requireAuth(req);
  if (req.authVia === 'apikey' && !req.apiKeyCanTrade) throw forbidden('API key lacks trade permission');
}

/** Session-only endpoints (account security, withdrawals) cannot be driven by API keys. */
export async function requireSession(req: FastifyRequest) {
  await requireAuth(req);
  if (req.authVia !== 'session') throw forbidden('This endpoint requires a browser session');
}

export async function requireAdmin(req: FastifyRequest) {
  await requireSession(req);
  if (req.user!.role !== 'ADMIN') throw forbidden('Admins only');
}

export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    emailVerified: u.emailVerified,
    totpEnabled: u.totpEnabled,
    kycStatus: u.kycStatus,
    hasPassword: !!u.passwordHash,
    createdAt: u.createdAt,
  };
}
