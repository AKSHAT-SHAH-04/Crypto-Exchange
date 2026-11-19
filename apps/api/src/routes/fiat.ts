/**
 * Fiat rails (AED / INR / USD) over bank transfer — the lowest-cost way in and out (no card fees).
 *
 * Deposits: the user sends a bank transfer to the company collection account quoting their personal
 * reference code. The bank partner's webhook (or an admin reconciling the statement) credits it. Transfers
 * from a name that doesn't match the KYC'd holder are held for compliance review (no third-party payments).
 * Withdrawals: only to the user's own bank account (holder name must match KYC), email-confirmed and
 * admin-approved, then paid out by the bank partner.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { User } from '@prisma/client';
import { prisma, D } from '../db.js';
import { config } from '../config.js';
import { requireAdmin, requireAuth, requireSession } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { emails } from '../lib/email.js';
import { issueToken } from '../lib/tokens.js';
import { randomToken } from '../lib/crypto.js';
import { requireTotpIfEnabled } from '../lib/totp.js';
import { creditDeposit, completeWithdrawal, failDeposit, failWithdrawal } from '../lib/settlement.js';
import { lockFunds, notifyUser } from '../engine/engine.js';
import { namesMatch } from './webhooks.js';

const BANK_FORMATS: Record<string, z.ZodTypeAny> = {
  AED: z.object({
    iban: z.string().trim().toUpperCase().regex(/^AE\d{21}$/, 'UAE IBAN must be AE followed by 21 digits'),
    swift: z.string().trim().toUpperCase().regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, 'Invalid SWIFT/BIC').optional(),
    bankName: z.string().trim().min(2).max(80),
  }),
  INR: z.object({
    accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'Account number must be 9–18 digits'),
    ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC'),
    bankName: z.string().trim().min(2).max(80),
  }),
  USD: z.object({
    routingNumber: z.string().trim().regex(/^\d{9}$/, 'ACH routing number must be 9 digits'),
    accountNumber: z.string().trim().regex(/^\d{4,17}$/, 'Account number must be 4–17 digits'),
    accountType: z.enum(['checking', 'savings']),
    bankName: z.string().trim().min(2).max(80),
  }),
};

const currencyCountry = (cur: string) => Object.entries(config.countryCurrency).find(([, c]) => c === cur)?.[0];
const mask = (d: Record<string, string>) => {
  const n = d.iban ?? d.accountNumber ?? '';
  return `${d.bankName ?? 'Bank'} ••••${n.slice(-4)}`;
};

async function kycName(userId: string) {
  const k = await prisma.kycSubmission.findFirst({ where: { userId, status: 'APPROVED' }, orderBy: { createdAt: 'desc' } });
  return k?.fullName ?? null;
}

/** Fiat is available only in the user's own (non-blocked) country currency, after KYC. */
function assertFiatUser(u: User, currency: string) {
  if (!config.fiatCurrencies.includes(currency)) throw badRequest('Unsupported currency');
  if (u.parentId) throw forbidden('Fiat deposits and withdrawals are not available for sub-accounts');
  if (u.kycStatus !== 'APPROVED' || !u.country) throw forbidden('Complete identity verification (KYC) first');
  if (config.blockedCountries.includes(u.country)) throw forbidden('Not available in your region');
  if (config.countryCurrency[u.country] !== currency) throw forbidden(`${currency} is not available for residents of ${u.country}`);
}

export async function fiatRoutes(app: FastifyInstance) {
  app.get('/api/fiat/currencies', { preHandler: requireAuth }, async (req) => {
    const u = req.user!;
    return config.fiatCurrencies.map((c) => {
      const country = currencyCountry(c);
      return {
        currency: c,
        country,
        available: !!u.country && config.countryCurrency[u.country] === c && !config.blockedCountries.includes(u.country) && u.kycStatus === 'APPROVED',
        bankConfigured: !!config.bankDetails[c],
        depositFee: '0',
        withdrawFee: config.fiatWithdrawFee[c] ?? '0',
        minWithdraw: config.fiatMinWithdraw[c] ?? '0',
      };
    });
  });

  app.get('/api/fiat/deposit/:currency', { preHandler: requireSession }, async (req) => {
    const currency = String((req.params as any).currency).toUpperCase();
    const u = req.user!;
    assertFiatUser(u, currency);
    const bank = config.bankDetails[currency];
    if (!bank) return { currency, available: false, message: `${currency} bank deposits are coming soon.` };
    let ref = await prisma.fiatDepositRef.findUnique({ where: { userId_currency: { userId: u.id, currency } } });
    if (!ref) {
      for (let i = 0; i < 5 && !ref; i++) {
        try {
          ref = await prisma.fiatDepositRef.create({ data: { userId: u.id, currency, reference: `CX${randomToken(4).toUpperCase()}` } });
        } catch {
          /* reference collision — retry */
        }
      }
    }
    return {
      currency,
      available: true,
      reference: ref!.reference,
      bank,
      fee: '0',
      notes: [
        'Send only from a bank account in your own name — third-party transfers are returned.',
        `Always include your reference ${ref!.reference} in the transfer description.`,
        currency === 'AED' ? 'Instant transfers (Aani / IPP) usually arrive within minutes; regular transfers same business day.'
          : currency === 'INR' ? 'IMPS arrives within minutes; NEFT/RTGS within banking hours.'
          : 'ACH transfers take 1–3 business days; wires usually same day.',
      ],
    };
  });

  // ---------- bank accounts (withdrawal destinations) ----------
  app.get('/api/fiat/bank-accounts', { preHandler: requireSession }, async (req) =>
    (await prisma.bankAccount.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } })).map((b) => ({
      ...b, display: mask(b.details as Record<string, string>),
    })),
  );

  app.post('/api/fiat/bank-accounts', { preHandler: requireSession }, async (req) => {
    const b = z.object({ currency: z.string(), label: z.string().trim().min(1).max(40), holder: z.string().trim().min(3).max(100), details: z.record(z.unknown()), code: z.string().optional() }).parse(req.body);
    const currency = b.currency.toUpperCase();
    const u = req.user!;
    assertFiatUser(u, currency);
    const details = BANK_FORMATS[currency].parse(b.details);
    const name = await kycName(u.id);
    if (!name || !namesMatch(name, b.holder)) throw badRequest('The account holder name must match your verified identity');
    if (!(await requireTotpIfEnabled(u, b.code))) throw badRequest('Invalid 2FA code');
    if ((await prisma.bankAccount.count({ where: { userId: u.id } })) >= 5) throw badRequest('Maximum of 5 bank accounts');
    const acct = await prisma.bankAccount.create({ data: { userId: u.id, currency, country: u.country!, holder: b.holder, label: b.label, details } });
    await audit(req, u.id, 'fiat.bank_account_added', { id: acct.id, currency });
    return { ...acct, display: mask(details as Record<string, string>) };
  });

  app.delete('/api/fiat/bank-accounts/:id', { preHandler: requireSession }, async (req) => {
    const r = await prisma.bankAccount.deleteMany({ where: { id: (req.params as any).id, userId: req.user!.id } });
    if (!r.count) throw notFound();
    await audit(req, req.user!.id, 'fiat.bank_account_removed', { id: (req.params as any).id });
    return { ok: true };
  });

  // ---------- withdraw to bank ----------
  app.post('/api/fiat/withdraw', { preHandler: requireSession, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ bankAccountId: z.string(), amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Up to 2 decimals'), code: z.string().optional() }).parse(req.body);
    const u = req.user!;
    const acct = await prisma.bankAccount.findFirst({ where: { id: b.bankAccountId, userId: u.id } });
    if (!acct) throw notFound('Bank account not found');
    assertFiatUser(u, acct.currency);
    if (config.isLive && Date.now() - acct.createdAt.getTime() < 24 * 3600e3) throw forbidden('For your security, new bank accounts can be used 24 hours after they are added');
    if (!u.emailVerified) throw forbidden('Verify your email before withdrawing');
    if (!(await requireTotpIfEnabled(u, b.code))) throw badRequest('Invalid 2FA code');
    const amount = new D(b.amount);
    const fee = new D(config.fiatWithdrawFee[acct.currency] ?? '0');
    const min = new D(config.fiatMinWithdraw[acct.currency] ?? '0');
    if (amount.lt(min) || amount.lte(fee)) throw badRequest(`Minimum withdrawal is ${D.max(min, fee)} ${acct.currency}`);
    const tx = await prisma.$transaction(async (t) => {
      await lockFunds(t, u.id, acct.currency, amount);
      return t.transaction.create({
        data: {
          userId: u.id, type: 'WITHDRAWAL', status: 'AWAITING_EMAIL', asset: acct.currency, network: 'BANK', rail: 'BANK',
          amount, fee, bankAccountId: acct.id, address: mask(acct.details as Record<string, string>),
        },
      });
    });
    const token = await issueToken(u.id, 'CONFIRM_WITHDRAWAL', 30, tx.id);
    await emails.withdrawal(u.email, token, `Withdraw ${amount} ${acct.currency} to ${mask(acct.details as Record<string, string>)}`);
    await audit(req, u.id, 'fiat.withdraw_requested', { id: tx.id, currency: acct.currency, amount: amount.toString() });
    notifyUser(u.id);
    return { ...tx, amount: tx.amount.toString(), fee: tx.fee.toString() };
  });

  // ---------- admin: reconciliation & payouts ----------
  /** Manually credit a bank transfer from the statement (when the bank has no webhook). */
  app.post('/api/admin/fiat/deposits', { preHandler: requireAdmin }, async (req) => {
    const b = z
      .object({ reference: z.string().trim().toUpperCase(), currency: z.string().toUpperCase(), amount: z.string().regex(/^\d+(\.\d{1,2})?$/), bankTxnId: z.string().trim().min(3), senderName: z.string().trim().max(100).optional() })
      .parse(req.body);
    const ref = await prisma.fiatDepositRef.findUnique({ where: { reference: b.reference } });
    if (!ref || ref.currency !== b.currency) throw badRequest('No user has this reference for that currency');
    const credited = await creditDeposit({
      userId: ref.userId, asset: ref.currency, network: 'BANK', amount: new D(b.amount), rail: 'BANK', provider: 'bank:manual',
      providerRef: `bank:${b.bankTxnId}`, note: b.senderName ? `From ${b.senderName} (manual)` : 'Manual reconciliation',
    });
    await audit(req, req.user!.id, 'admin.fiat_deposit_credited', { ...b, credited });
    if (!credited) throw badRequest('This bank transaction was already credited');
    return { ok: true };
  });

  app.get('/api/admin/fiat/held', { preHandler: requireAdmin }, async () => {
    const rows = await prisma.transaction.findMany({
      where: { type: 'DEPOSIT', rail: 'BANK', status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true } } },
    });
    return rows.map((t) => ({ ...t, amount: t.amount.toString(), fee: t.fee.toString() }));
  });

  app.post('/api/admin/fiat/held/:id', { preHandler: requireAdmin }, async (req) => {
    const { decision } = z.object({ decision: z.enum(['APPROVE', 'REJECT']) }).parse(req.body);
    const t = await prisma.transaction.findUnique({ where: { id: (req.params as any).id } });
    if (!t || t.status !== 'PENDING_APPROVAL' || t.type !== 'DEPOSIT' || !t.providerRef) throw notFound();
    if (decision === 'APPROVE') {
      await creditDeposit({ userId: t.userId, asset: t.asset, network: t.network, amount: t.amount, rail: 'BANK', provider: t.provider ?? 'bank', providerRef: t.providerRef });
    } else {
      await failDeposit(t.providerRef, 'Rejected by compliance — funds will be returned to the sender');
    }
    await audit(req, req.user!.id, 'admin.fiat_deposit_reviewed', { id: t.id, decision });
    return { ok: true };
  });

  /** Mark an approved bank withdrawal as paid out (or failed) when the bank partner has no webhook. */
  app.post('/api/admin/fiat/payouts/:id', { preHandler: requireAdmin }, async (req) => {
    const b = z.object({ status: z.enum(['COMPLETED', 'FAILED']), bankRef: z.string().trim().max(80).optional(), reason: z.string().max(200).optional() }).parse(req.body);
    const w = await prisma.transaction.findUnique({ where: { id: (req.params as any).id } });
    if (!w || w.type !== 'WITHDRAWAL' || w.rail !== 'BANK' || w.status !== 'PROCESSING') throw badRequest('Withdrawal is not awaiting payout');
    const ok = b.status === 'COMPLETED' ? await completeWithdrawal(w, b.bankRef ?? null) : await failWithdrawal(w, b.reason ?? 'payout failed');
    await audit(req, req.user!.id, 'admin.fiat_payout', { id: w.id, ...b });
    return { ok };
  });
}
