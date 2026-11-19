/**
 * Inbound webhooks from the custodian, bank partners and on/off-ramp partners.
 * All are verified against the *raw* request body before anything is parsed or acted on, and every
 * effect is idempotent (see lib/settlement.ts). Balances are only ever credited from the custodian
 * (on-chain, confirmed) or the bank partner (settled transfer) — never from a ramp partner's word.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma, D } from '../db.js';
import { hmac, safeEqual } from '../lib/crypto.js';
import { verifyFireblocksWebhook } from '../custody/fireblocks.js';
import { completeWithdrawal, creditDeposit, failDeposit, failWithdrawal, recordPendingDeposit } from '../lib/settlement.js';
import { notify } from '../lib/notify.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const FAILED = ['FAILED', 'REJECTED', 'CANCELLED', 'BLOCKED', 'TIMEOUT'];

export function namesMatch(a: string, b: string) {
  const tokens = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1);
  const ta = new Set(tokens(a));
  const tb = tokens(b);
  const shared = tb.filter((t) => ta.has(t)).length;
  return shared >= Math.min(2, ta.size, tb.length) && shared > 0;
}

export async function webhookRoutes(app: FastifyInstance) {
  // Keep the exact bytes for signature checks (scoped to this plugin only).
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 256 * 1024 }, (req, body, done) => {
    (req as FastifyRequest).rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  // ---------------- Fireblocks ----------------
  app.post('/api/webhooks/fireblocks', async (req, reply) => {
    if (config.custodyProvider !== 'fireblocks') return reply.code(404).send();
    if (!verifyFireblocksWebhook(req.rawBody ?? '', req.headers['fireblocks-signature'] as string | undefined)) {
      req.log.warn('fireblocks webhook: bad signature');
      return reply.code(401).send({ error: 'bad signature' });
    }
    const evt = req.body as { type?: string; data?: any };
    if (!evt?.data || !['TRANSACTION_CREATED', 'TRANSACTION_STATUS_UPDATED'].includes(evt.type ?? '')) return { ok: true };
    const d = evt.data;
    const status = String(d.status ?? '');
    const txHash = d.txHash || null;

    // Outgoing: one of our withdrawals (externalTxId = our Transaction id)
    if (d.externalTxId) {
      const w = await prisma.transaction.findUnique({ where: { id: String(d.externalTxId) } });
      if (w?.type === 'WITHDRAWAL') {
        if (status === 'COMPLETED') await completeWithdrawal(w, txHash);
        else if (FAILED.includes(status)) await failWithdrawal(w, `custodian status ${status}${d.subStatus ? ` (${d.subStatus})` : ''}`);
        else if (txHash) await prisma.transaction.update({ where: { id: w.id }, data: { txHash } });
      }
      return { ok: true };
    }

    // Incoming: a deposit into the omnibus vault
    if (d.destination?.type === 'VAULT_ACCOUNT' && String(d.destination.id) === config.fireblocks.vaultAccountId && d.destinationAddress) {
      const addr = await prisma.depositAddress.findFirst({
        where: { provider: 'fireblocks', address: String(d.destinationAddress), ...(d.destinationTag ? { tag: String(d.destinationTag) } : {}) },
      });
      if (!addr) {
        req.log.error({ id: d.id, address: d.destinationAddress }, 'fireblocks deposit to unknown address — needs manual review');
        return { ok: true };
      }
      const amount = new D(String(d.amountInfo?.amount ?? d.netAmount ?? d.amount ?? '0'));
      if (amount.lte(0)) return { ok: true };
      const deposit = {
        userId: addr.userId, asset: addr.asset, network: addr.network, amount, rail: 'CRYPTO' as const,
        provider: 'fireblocks', providerRef: `fireblocks:${d.id}`, address: addr.address, txHash,
      };
      if (status === 'COMPLETED') await creditDeposit(deposit);
      else if (FAILED.includes(status)) await failDeposit(deposit.providerRef, `custodian status ${status}`);
      else await recordPendingDeposit(deposit);
    }
    return { ok: true };
  });

  // ---------------- Bank partner (generic) ----------------
  // POST body examples (signed with X-Signature: hex HMAC-SHA256(BANK_WEBHOOK_SECRET, rawBody)):
  //   {"event":"credit","currency":"AED","amount":"1500.00","reference":"CXAB12CD34","bankTxnId":"FT2611...","senderName":"Jane Doe"}
  //   {"event":"payout","transactionId":"<our withdrawal id>","status":"COMPLETED","bankRef":"UTR123..."}
  app.post('/api/webhooks/bank', async (req, reply) => {
    if (!config.bankWebhookSecret) return reply.code(404).send();
    const sig = String(req.headers['x-signature'] ?? '');
    if (!sig || !safeEqual(hmac(config.bankWebhookSecret, req.rawBody ?? ''), sig)) return reply.code(401).send({ error: 'bad signature' });
    const b = req.body as any;
    if (b?.event === 'credit') {
      const ref = await prisma.fiatDepositRef.findUnique({ where: { reference: String(b.reference ?? '').trim().toUpperCase() } });
      if (!ref || ref.currency !== b.currency || !b.bankTxnId) {
        req.log.error({ b }, 'bank credit with unknown reference — needs manual reconciliation');
        return { ok: true, matched: false };
      }
      const user = await prisma.user.findUnique({ where: { id: ref.userId }, include: { kyc: { where: { status: 'APPROVED' }, take: 1, orderBy: { createdAt: 'desc' } } } });
      const kycName = user?.kyc[0]?.fullName;
      // third-party payments are not allowed: sender must match the verified name, else hold for compliance review
      const hold = !kycName ? 'Held: account not KYC-verified' : b.senderName && !namesMatch(kycName, String(b.senderName)) ? `Held: sender "${b.senderName}" does not match account holder` : undefined;
      await creditDeposit(
        {
          userId: ref.userId, asset: ref.currency, network: 'BANK', amount: new D(String(b.amount)).toDecimalPlaces(2, D.ROUND_DOWN),
          rail: 'BANK', provider: 'bank', providerRef: `bank:${b.bankTxnId}`, note: b.senderName ? `From ${b.senderName}` : null,
        },
        { holdForReview: hold },
      );
      if (hold) await notify(ref.userId, { type: 'wallet', title: 'Deposit under review', body: `Your ${b.amount} ${b.currency} transfer is being reviewed by our compliance team.`, link: '/wallet' });
      return { ok: true, matched: true, held: !!hold };
    }
    if (b?.event === 'payout' && b.transactionId) {
      const w = await prisma.transaction.findUnique({ where: { id: String(b.transactionId) } });
      if (w?.type === 'WITHDRAWAL' && w.rail === 'BANK') {
        if (b.status === 'COMPLETED') await completeWithdrawal(w, b.bankRef ?? null);
        else if (FAILED.includes(String(b.status))) await failWithdrawal(w, b.reason ?? 'bank payout failed');
      }
      return { ok: true };
    }
    return { ok: true };
  });

  // ---------------- On/off-ramp partners (status tracking only) ----------------
  app.post('/api/webhooks/ramp/:provider', async (req, reply) => {
    const provider = (req.params as any).provider as string;
    let data: any;
    if (provider === 'onramper') {
      const secret = config.ramp.onramperWebhookSecret;
      const sig = String(req.headers['x-onramper-webhook-signature'] ?? '');
      if (!secret || !sig || !safeEqual(hmac(secret, req.rawBody ?? ''), sig)) return reply.code(401).send({ error: 'bad signature' });
      const b = req.body as any;
      data = b?.payload ?? b;
    } else if (provider === 'transak') {
      // Transak posts {"data": "<JWT>"} signed with your access/webhook secret
      const secret = config.ramp.transakWebhookSecret;
      try {
        const decoded = jwt.verify(String((req.body as any)?.data ?? ''), secret, { algorithms: ['HS256'] }) as any;
        data = decoded?.webhookData ?? decoded;
      } catch {
        return reply.code(401).send({ error: 'bad signature' });
      }
    } else return reply.code(404).send();

    const ourId = String(data?.partnerContext ?? data?.partnerOrderId ?? '');
    if (!ourId) return { ok: true };
    const order = await prisma.rampOrder.findUnique({ where: { id: ourId } });
    if (!order || order.provider !== provider) return { ok: true };
    const status = String(data.status ?? data.statusReason ?? 'UPDATED').toUpperCase().slice(0, 40);
    await prisma.rampOrder.update({
      where: { id: order.id },
      data: {
        status,
        providerOrderId: order.providerOrderId ?? (data.id ? String(data.id) : data.orderId ? String(data.orderId) : null),
        fiatAmount: data.fiatAmount ? new D(String(data.fiatAmount)) : undefined,
        cryptoAmount: data.cryptoAmount ? new D(String(data.cryptoAmount)) : undefined,
        // SELL: the partner tells us where to send the crypto; the user still confirms the transfer in-app
        ...(order.side === 'SELL' && (data.depositAddress || data.walletAddress) ? { walletAddress: String(data.depositAddress ?? data.walletAddress) } : {}),
      },
    });
    await notify(order.userId, {
      type: 'wallet',
      title: `${order.side === 'BUY' ? 'Buy' : 'Sell'} order ${status.toLowerCase().replace(/_/g, ' ')}`,
      body: `${order.asset} via ${provider}`,
      link: '/wallet?tab=ramp',
    });
    return { ok: true };
  });
}
