import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticator } from 'otplib';
import { prisma, D, ZERO } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireSession } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { emails } from '../lib/email.js';
import { consumeToken, issueToken } from '../lib/tokens.js';
import { sha256 } from '../lib/crypto.js';
import { getPrice } from '../market/feed.js';
import { adjustBalance, lockFunds, notifyUser } from '../engine/engine.js';

export function usdPrice(asset: string) {
  if (asset === 'USDT' || asset === 'USDC') return 1;
  return getPrice(`${asset}USDT`) ?? 0;
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function fakeAddress(seed: string, network: string) {
  const h = sha256(seed) + sha256(seed + '2');
  const b58 = (n: number) => Array.from({ length: n }, (_, i) => B58[parseInt(h.slice(i * 2, i * 2 + 2), 16) % 58]).join('');
  switch (network) {
    case 'BTC': return `bc1q${h.slice(0, 38)}`;
    case 'TRC20': return `T${b58(33)}`;
    case 'SOL': return b58(44);
    case 'XRP': return `r${b58(33)}`;
    default: return `0x${h.slice(0, 40)}`;
  }
}

const serializeTx = (t: any) => ({ ...t, amount: t.amount.toString(), fee: t.fee.toString() });

export async function walletRoutes(app: FastifyInstance) {
  app.get('/api/wallet/assets', async () => {
    const assets = await prisma.asset.findMany({ where: { enabled: true }, orderBy: { symbol: 'asc' } });
    return assets.map((a) => ({ ...a, minWithdraw: a.minWithdraw.toString(), withdrawFee: a.withdrawFee.toString(), usdPrice: usdPrice(a.symbol) }));
  });

  app.get('/api/wallet/balances', { preHandler: requireAuth }, async (req) => {
    const [assets, rows] = await Promise.all([
      prisma.asset.findMany({ where: { enabled: true } }),
      prisma.balance.findMany({ where: { userId: req.user!.id } }),
    ]);
    const byAsset = new Map(rows.map((r) => [r.asset, r]));
    let total = 0;
    const balances = assets
      .map((a) => {
        const b = byAsset.get(a.symbol);
        const available = b?.available ?? ZERO;
        const locked = b?.locked ?? ZERO;
        const price = usdPrice(a.symbol);
        const usdValue = available.plus(locked).toNumber() * price;
        total += usdValue;
        return { asset: a.symbol, name: a.name, available: available.toString(), locked: locked.toString(), usdPrice: price, usdValue };
      })
      .sort((x, y) => y.usdValue - x.usdValue || x.asset.localeCompare(y.asset));
    return { totalUsd: total, balances, tradingMode: config.tradingMode };
  });

  app.get('/api/wallet/deposit-address', { preHandler: requireAuth }, async (req) => {
    const q = z.object({ asset: z.string(), network: z.string() }).parse(req.query);
    const asset = await prisma.asset.findUnique({ where: { symbol: q.asset } });
    if (!asset || !asset.networks.includes(q.network)) throw badRequest('Unsupported asset/network');
    return {
      asset: q.asset,
      network: q.network,
      address: fakeAddress(`${req.user!.id}:${q.asset}:${q.network}`, q.network),
      demo: config.tradingMode === 'paper',
    };
  });

  /** Paper trading only: instantly credit demo funds. */
  app.post('/api/wallet/demo-deposit', { preHandler: requireSession, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    if (config.tradingMode !== 'paper') throw forbidden('Demo deposits are disabled in live mode');
    const body = z.object({ asset: z.string(), amount: z.string().regex(/^\d+(\.\d+)?$/) }).parse(req.body);
    const asset = await prisma.asset.findUnique({ where: { symbol: body.asset } });
    if (!asset) throw badRequest('Unknown asset');
    const amount = new D(body.amount).toDecimalPlaces(asset.precision, D.ROUND_DOWN);
    if (amount.lte(0)) throw badRequest('Amount must be positive');
    if (amount.toNumber() * usdPrice(asset.symbol) > 100_000) throw badRequest('Demo deposits are limited to $100,000 per request');
    const network = asset.networks[0];
    await prisma.$transaction(async (tx) => {
      await adjustBalance(tx, req.user!.id, asset.symbol, amount);
      await tx.transaction.create({
        data: {
          userId: req.user!.id, type: 'DEPOSIT', status: 'COMPLETED', asset: asset.symbol, network, amount,
          address: fakeAddress(`${req.user!.id}:${asset.symbol}:${network}`, network), txHash: `demo-${sha256(String(Date.now())).slice(0, 48)}`,
          note: 'Demo deposit',
        },
      });
    });
    await audit(req, req.user!.id, 'wallet.demo_deposit', { asset: asset.symbol, amount: amount.toString() });
    notifyUser(req.user!.id);
    return { ok: true };
  });

  app.get('/api/wallet/transactions', { preHandler: requireAuth }, async (req) => {
    const q = z.object({ type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'BONUS', 'ADJUSTMENT']).optional() }).parse(req.query);
    const rows = await prisma.transaction.findMany({
      where: { userId: req.user!.id, ...(q.type ? { type: q.type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(serializeTx);
  });

  // ---------- withdrawal address whitelist ----------
  app.get('/api/wallet/addresses', { preHandler: requireSession }, async (req) =>
    prisma.withdrawalAddress.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } }),
  );

  app.post('/api/wallet/addresses', { preHandler: requireSession }, async (req) => {
    const body = z
      .object({
        asset: z.string(),
        network: z.string(),
        address: z.string().trim().min(20).max(120).regex(/^[A-Za-z0-9:]+$/, 'Invalid address'),
        label: z.string().trim().min(1).max(40),
        code: z.string().optional(),
      })
      .parse(req.body);
    const asset = await prisma.asset.findUnique({ where: { symbol: body.asset } });
    if (!asset || !asset.networks.includes(body.network)) throw badRequest('Unsupported asset/network');
    const u = req.user!;
    if (u.totpEnabled && (!body.code || !authenticator.check(body.code, u.totpSecret!))) throw badRequest('Invalid 2FA code');
    const addr = await prisma.withdrawalAddress.create({
      data: { userId: u.id, asset: body.asset, network: body.network, address: body.address, label: body.label },
    });
    await audit(req, u.id, 'wallet.address_added', { asset: body.asset, network: body.network, address: body.address });
    return addr;
  });

  app.delete('/api/wallet/addresses/:id', { preHandler: requireSession }, async (req) => {
    const r = await prisma.withdrawalAddress.deleteMany({ where: { id: (req.params as any).id, userId: req.user!.id } });
    if (!r.count) throw notFound();
    await audit(req, req.user!.id, 'wallet.address_removed', { id: (req.params as any).id });
    return { ok: true };
  });

  // ---------- withdrawals ----------
  app.post('/api/wallet/withdraw', { preHandler: requireSession, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ addressId: z.string(), amount: z.string().regex(/^\d+(\.\d+)?$/), code: z.string().optional() }).parse(req.body);
    const u = req.user!;
    if (!u.emailVerified) throw forbidden('Verify your email before withdrawing');
    if (u.kycStatus !== 'APPROVED') throw forbidden('Complete identity verification (KYC) before withdrawing');
    if (u.totpEnabled && (!body.code || !authenticator.check(body.code, u.totpSecret!))) throw badRequest('Invalid 2FA code');
    const addr = await prisma.withdrawalAddress.findFirst({ where: { id: body.addressId, userId: u.id } });
    if (!addr) throw badRequest('Withdrawals can only be sent to a whitelisted address');
    const asset = await prisma.asset.findUnique({ where: { symbol: addr.asset } });
    if (!asset?.enabled) throw badRequest('Asset unavailable');
    const amount = new D(body.amount).toDecimalPlaces(asset.precision, D.ROUND_DOWN);
    if (amount.lt(asset.minWithdraw) || amount.lte(asset.withdrawFee)) throw badRequest(`Minimum withdrawal is ${D.max(asset.minWithdraw, asset.withdrawFee)} ${asset.symbol}`);

    const tx = await prisma.$transaction(async (t) => {
      await lockFunds(t, u.id, asset.symbol, amount);
      return t.transaction.create({
        data: {
          userId: u.id, type: 'WITHDRAWAL', status: 'AWAITING_EMAIL', asset: asset.symbol, network: addr.network,
          amount, fee: asset.withdrawFee, address: addr.address,
        },
      });
    });
    const token = await issueToken(u.id, 'CONFIRM_WITHDRAWAL', 30, tx.id);
    await emails.withdrawal(u.email, token, `Withdraw ${amount} ${asset.symbol} (${addr.network}) to ${addr.address}`);
    await audit(req, u.id, 'wallet.withdraw_requested', { id: tx.id, asset: asset.symbol, amount: amount.toString() });
    notifyUser(u.id);
    return serializeTx(tx);
  });

  app.post('/api/wallet/withdraw/confirm', async (req) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    const rec = await consumeToken(token, 'CONFIRM_WITHDRAWAL');
    if (!rec?.refId) throw badRequest('This confirmation link is invalid or has expired');
    const r = await prisma.transaction.updateMany({
      where: { id: rec.refId, userId: rec.userId, status: 'AWAITING_EMAIL' },
      data: { status: 'PENDING_APPROVAL' },
    });
    if (!r.count) throw badRequest('Withdrawal can no longer be confirmed');
    await audit(req, rec.userId, 'wallet.withdraw_confirmed', { id: rec.refId });
    return { ok: true };
  });

  app.post('/api/wallet/withdraw/:id/cancel', { preHandler: requireSession }, async (req) => {
    const id = (req.params as any).id;
    await prisma.$transaction(async (t) => {
      const tx = await t.transaction.findFirst({ where: { id, userId: req.user!.id, type: 'WITHDRAWAL' } });
      if (!tx) throw notFound();
      const r = await t.transaction.updateMany({
        where: { id, status: { in: ['AWAITING_EMAIL', 'PENDING_APPROVAL'] } },
        data: { status: 'CANCELED' },
      });
      if (!r.count) throw badRequest('Withdrawal can no longer be canceled');
      await adjustBalance(t, tx.userId, tx.asset, tx.amount, tx.amount.neg());
    });
    await audit(req, req.user!.id, 'wallet.withdraw_canceled', { id });
    notifyUser(req.user!.id);
    return { ok: true };
  });
}
