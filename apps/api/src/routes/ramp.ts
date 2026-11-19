/**
 * On-ramp / off-ramp partners (card, Apple/Google Pay, local bank rails) via a hosted widget.
 *
 * BUY:  we open the partner widget with the user's own custody deposit address locked in. The partner
 *       charges the user and sends crypto on-chain; the custodian's webhook credits it like any deposit.
 * SELL: the partner tells us (signed webhook) where to send the crypto; the user confirms with 2FA and
 *       it goes through the normal withdrawal pipeline; the partner pays fiat to the user's bank/card.
 *
 * Default provider is Onramper, an aggregator that quotes several licensed providers and routes each
 * order to the cheapest one available for the user's country/payment method — the lowest-fee option.
 * NOTE: verify widget parameter names, crypto ids and URL-signing against the partner sandbox before launch.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, D } from '../db.js';
import { config } from '../config.js';
import { requireSession } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { hmac } from '../lib/crypto.js';
import { requireTotpIfEnabled } from '../lib/totp.js';
import { getOrCreateDepositAddress } from '../custody/index.js';
import { lockFunds, notifyUser } from '../engine/engine.js';

/** Partner crypto identifiers per "<ASSET>:<NETWORK>" (override with RAMP_CRYPTO_MAP JSON). */
const CRYPTO_MAP: Record<string, { onramper: string; transak: { code: string; network: string } }> = {
  'USDT:TRC20': { onramper: 'usdt_trc20', transak: { code: 'USDT', network: 'tron' } },
  'USDT:ERC20': { onramper: 'usdt_ethereum', transak: { code: 'USDT', network: 'ethereum' } },
  'BTC:BTC': { onramper: 'btc', transak: { code: 'BTC', network: 'mainnet' } },
  'ETH:ERC20': { onramper: 'eth', transak: { code: 'ETH', network: 'ethereum' } },
  'SOL:SOL': { onramper: 'sol', transak: { code: 'SOL', network: 'solana' } },
  ...(process.env.RAMP_CRYPTO_MAP ? JSON.parse(process.env.RAMP_CRYPTO_MAP) : {}),
};

function enabledProvider() {
  const r = config.ramp;
  if (r.provider === 'onramper' && r.onramperApiKey) return 'onramper' as const;
  if (r.provider === 'transak' && r.transakApiKey) return 'transak' as const;
  return null;
}

/** Onramper requires sensitive params (wallet addresses) to be HMAC-signed so they can't be swapped. */
function onramperUrl(p: { side: 'BUY' | 'SELL'; fiat: string; amount?: string; cryptoId: string; address?: string; orderId: string }) {
  const params = new URLSearchParams({
    apiKey: config.ramp.onramperApiKey,
    mode: p.side === 'BUY' ? 'buy' : 'sell',
    defaultFiat: p.fiat.toLowerCase(),
    defaultCrypto: p.cryptoId,
    onlyCryptos: p.cryptoId,
    partnerContext: p.orderId,
    redirectAtCheckoutSuccessUrl: `${config.webUrl}/wallet?tab=ramp`,
    ...(p.amount ? { defaultAmount: p.amount } : {}),
  });
  if (p.address) {
    const wallets = `${p.cryptoId}:${p.address}`;
    params.set('wallets', wallets);
    if (config.ramp.onramperSecret) params.set('signature', hmac(config.ramp.onramperSecret, `wallets=${wallets}`));
  }
  return `https://buy.onramper.com/?${params}`;
}

function transakUrl(p: { side: 'BUY' | 'SELL'; fiat: string; amount?: string; code: string; network: string; address?: string; orderId: string; userId: string; email: string }) {
  const base = config.ramp.transakEnv === 'PRODUCTION' ? 'https://global.transak.com' : 'https://global-stg.transak.com';
  const params = new URLSearchParams({
    apiKey: config.ramp.transakApiKey,
    productsAvailed: p.side,
    fiatCurrency: p.fiat,
    cryptoCurrencyCode: p.code,
    network: p.network,
    partnerOrderId: p.orderId,
    partnerCustomerId: p.userId,
    email: p.email,
    redirectURL: `${config.webUrl}/wallet?tab=ramp`,
    ...(p.amount ? { [p.side === 'BUY' ? 'fiatAmount' : 'cryptoAmount']: p.amount } : {}),
    ...(p.address ? { walletAddress: p.address, disableWalletAddressForm: 'true' } : {}),
  });
  return `${base}/?${params}`;
}

export async function rampRoutes(app: FastifyInstance) {
  app.get('/api/ramp/config', async (req) => {
    const provider = enabledProvider();
    const u = req.user;
    return {
      enabled: !!provider,
      provider,
      pairs: Object.keys(CRYPTO_MAP).map((k) => {
        const [asset, network] = k.split(':');
        return { asset, network };
      }),
      fiat: u?.country ? config.countryCurrency[u.country] ?? 'USD' : 'USD',
    };
  });

  app.post('/api/ramp/session', { preHandler: requireSession, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z
      .object({
        side: z.enum(['BUY', 'SELL']),
        asset: z.string(),
        network: z.string(),
        fiatCurrency: z.string().length(3).toUpperCase(),
        amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      })
      .parse(req.body);
    const provider = enabledProvider();
    if (!provider) throw badRequest('Card and bank purchases are not configured yet');
    const u = req.user!;
    if (u.parentId) throw forbidden('Not available for sub-accounts');
    if (u.kycStatus !== 'APPROVED') throw forbidden('Complete identity verification (KYC) first');
    if (u.country && config.blockedCountries.includes(u.country)) throw forbidden('Not available in your region');
    const map = CRYPTO_MAP[`${b.asset}:${b.network}`];
    if (!map) throw badRequest('This coin/network is not available for card purchases');

    const address = b.side === 'BUY' ? (await getOrCreateDepositAddress(u.id, b.asset, b.network)).address : undefined;
    const order = await prisma.rampOrder.create({
      data: { userId: u.id, provider, side: b.side, fiatCurrency: b.fiatCurrency, asset: b.asset, network: b.network, walletAddress: b.side === 'BUY' ? address : null },
    });
    const url =
      provider === 'onramper'
        ? onramperUrl({ side: b.side, fiat: b.fiatCurrency, amount: b.amount, cryptoId: map.onramper, address, orderId: order.id })
        : transakUrl({ side: b.side, fiat: b.fiatCurrency, amount: b.amount, code: map.transak.code, network: map.transak.network, address, orderId: order.id, userId: u.id, email: u.email });
    await audit(req, u.id, 'ramp.session_created', { id: order.id, provider, side: b.side, asset: b.asset });
    return { orderId: order.id, provider, url };
  });

  app.get('/api/ramp/orders', { preHandler: requireSession }, async (req) =>
    (await prisma.rampOrder.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 })).map((o) => ({
      ...o, fiatAmount: o.fiatAmount?.toString() ?? null, cryptoAmount: o.cryptoAmount?.toString() ?? null,
    })),
  );

  /** SELL: send the crypto to the partner's deposit address (from their signed webhook). */
  app.post('/api/ramp/orders/:id/send', { preHandler: requireSession }, async (req) => {
    const { code } = z.object({ code: z.string().optional() }).parse(req.body ?? {});
    const u = req.user!;
    if (!u.totpEnabled) throw forbidden('Enable 2FA to sell crypto to a payment partner');
    if (!(await requireTotpIfEnabled(u, code))) throw badRequest('Invalid 2FA code');
    const o = await prisma.rampOrder.findFirst({ where: { id: (req.params as any).id, userId: u.id, side: 'SELL' } });
    if (!o) throw notFound();
    if (!o.walletAddress || !o.cryptoAmount) throw badRequest('Waiting for the partner to confirm the order');
    const asset = await prisma.asset.findUnique({ where: { symbol: o.asset } });
    if (!asset) throw badRequest('Unknown asset');
    const amount = o.cryptoAmount.plus(asset.withdrawFee); // partner must receive the full amount
    const tx = await prisma.$transaction(async (t) => {
      const r = await t.rampOrder.updateMany({ where: { id: o.id, status: { notIn: ['FUNDING', 'COMPLETED'] } }, data: { status: 'FUNDING' } });
      if (!r.count) throw badRequest('This order was already funded');
      await lockFunds(t, u.id, o.asset, amount);
      return t.transaction.create({
        data: {
          userId: u.id, type: 'WITHDRAWAL', status: 'PENDING_APPROVAL', asset: o.asset, network: o.network, rail: 'CRYPTO',
          amount, fee: asset.withdrawFee, address: o.walletAddress, note: `Sell via ${o.provider} · order ${o.id.slice(-8)}`,
        },
      });
    });
    await audit(req, u.id, 'ramp.sell_funded', { id: o.id, tx: tx.id });
    notifyUser(u.id);
    return { ok: true, withdrawalId: tx.id, amount: new D(amount).toString() };
  });
}
