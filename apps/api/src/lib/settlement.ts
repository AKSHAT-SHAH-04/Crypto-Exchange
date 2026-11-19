/**
 * Exactly-once settlement of deposits and withdrawals reported by custodians / bank partners.
 * Every transition is a conditional UPDATE on the current status, so duplicate or out-of-order
 * webhooks can never credit or refund twice.
 */
import type { Transaction } from '@prisma/client';
import { prisma, D, type Dec } from '../db.js';
import { adjustBalance, notifyUser } from '../engine/engine.js';
import { notify } from './notify.js';
import { getTreasuryId } from './treasury.js';

export interface IncomingDeposit {
  userId: string;
  asset: string;
  network: string | null;
  amount: Dec;
  rail: 'CRYPTO' | 'BANK';
  provider: string;
  providerRef: string;
  address?: string | null;
  txHash?: string | null;
  note?: string | null;
}

/** Records a deposit we've seen but which isn't final yet (e.g. awaiting confirmations). Idempotent. */
export async function recordPendingDeposit(d: IncomingDeposit) {
  return prisma.transaction.upsert({
    where: { providerRef: d.providerRef },
    create: {
      userId: d.userId, type: 'DEPOSIT', status: 'PROCESSING', asset: d.asset, network: d.network, amount: d.amount,
      rail: d.rail, provider: d.provider, providerRef: d.providerRef, address: d.address, txHash: d.txHash, note: d.note,
    },
    update: { txHash: d.txHash ?? undefined },
  });
}

/** Credits a deposit exactly once. Returns true if this call credited it. */
export async function creditDeposit(d: IncomingDeposit, opts: { holdForReview?: string } = {}) {
  await recordPendingDeposit(d);
  if (opts.holdForReview) {
    await prisma.transaction.updateMany({
      where: { providerRef: d.providerRef, status: 'PROCESSING' },
      data: { status: 'PENDING_APPROVAL', note: opts.holdForReview },
    });
    return false;
  }
  const credited = await prisma.$transaction(async (tx) => {
    const r = await tx.transaction.updateMany({
      where: { providerRef: d.providerRef, status: { in: ['PROCESSING', 'PENDING_APPROVAL'] } },
      data: { status: 'COMPLETED', txHash: d.txHash ?? undefined },
    });
    if (r.count !== 1) return false;
    await adjustBalance(tx, d.userId, d.asset, d.amount);
    return true;
  });
  if (credited) {
    notifyUser(d.userId);
    await notify(d.userId, { type: 'wallet', title: 'Deposit received', body: `${d.amount} ${d.asset} has been credited to your wallet.`, link: '/wallet' });
  }
  return credited;
}

export async function failDeposit(providerRef: string, reason: string) {
  await prisma.transaction.updateMany({ where: { providerRef, status: { in: ['PROCESSING', 'PENDING_APPROVAL'] } }, data: { status: 'FAILED', note: reason } });
}

/** Withdrawal confirmed by the custodian/bank: the locked funds leave the platform. */
export async function completeWithdrawal(w: Pick<Transaction, 'id' | 'userId' | 'asset' | 'amount' | 'fee' | 'address'>, txHash?: string | null) {
  const done = await prisma.$transaction(async (tx) => {
    const r = await tx.transaction.updateMany({ where: { id: w.id, status: 'PROCESSING' }, data: { status: 'COMPLETED', txHash: txHash ?? undefined } });
    if (r.count !== 1) return false;
    await adjustBalance(tx, w.userId, w.asset, new D(0), w.amount.neg());
    // amount - fee left the platform; the fee stays with the house
    if (w.fee.gt(0)) await adjustBalance(tx, getTreasuryId(), w.asset, w.fee);
    return true;
  });
  if (done) {
    notifyUser(w.userId);
    await notify(w.userId, { type: 'wallet', title: 'Withdrawal completed', body: `${w.amount} ${w.asset} sent${w.address ? ` to ${w.address}` : ''}.`, link: '/wallet' });
  }
  return done;
}

/** Withdrawal failed at the custodian/bank: unlock the funds back to the user. */
export async function failWithdrawal(w: Pick<Transaction, 'id' | 'userId' | 'asset' | 'amount'>, reason: string) {
  const done = await prisma.$transaction(async (tx) => {
    const r = await tx.transaction.updateMany({ where: { id: w.id, status: 'PROCESSING' }, data: { status: 'FAILED', note: reason } });
    if (r.count !== 1) return false;
    await adjustBalance(tx, w.userId, w.asset, w.amount, w.amount.neg());
    return true;
  });
  if (done) {
    notifyUser(w.userId);
    await notify(w.userId, { type: 'wallet', title: 'Withdrawal failed', body: `${w.amount} ${w.asset} has been returned to your wallet. Reason: ${reason}`, link: '/wallet' });
  }
  return done;
}
