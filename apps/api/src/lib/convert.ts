/**
 * Convert pricing and settlement, shared by the Convert screen and Auto-Invest.
 * The house treasury is the counterparty: it receives `from` and pays `to` (from real inventory in live mode).
 */
import { prisma, D, type Dec } from '../db.js';
import { config } from '../config.js';
import { badRequest } from './errors.js';
import { getTreasuryId } from './treasury.js';
import { isPriceFresh } from '../market/feed.js';
import { adjustBalance, debitAvailable } from '../engine/engine.js';
import { usdPrice } from '../routes/wallet.js';

export const CONVERT_SPREAD = Number(process.env.CONVERT_SPREAD || '0.001'); // 0.1% — the only charge

export interface ConvertPrice {
  from: string;
  to: string;
  fromAmount: Dec;
  toAmount: Dec;
  rate: Dec;
}

export async function priceConvert(from: string, to: string, amount: string | Dec, limits = { minUsd: 1, maxUsd: 1_000_000 }): Promise<ConvertPrice> {
  if (from === to) throw badRequest('Choose two different assets');
  const [fa, ta] = await Promise.all([prisma.asset.findUnique({ where: { symbol: from } }), prisma.asset.findUnique({ where: { symbol: to } })]);
  if (!fa?.enabled || !ta?.enabled) throw badRequest('Asset not available for convert');
  const pf = usdPrice(fa.symbol);
  const pt = usdPrice(ta.symbol);
  if (!pf || !pt) throw badRequest('No price available for this pair right now');
  if (config.isLive) {
    for (const a of [fa, ta]) {
      if (!a.isFiat && a.symbol !== 'USDT' && !isPriceFresh(`${a.symbol}USDT`)) throw badRequest('Prices are temporarily unavailable — try again shortly');
    }
  }
  const fromAmount = new D(amount).toDecimalPlaces(fa.precision, D.ROUND_DOWN);
  const usd = fromAmount.toNumber() * pf;
  if (usd < limits.minUsd) throw badRequest(`Minimum value is $${limits.minUsd}`);
  if (usd > limits.maxUsd) throw badRequest(`Maximum value is $${limits.maxUsd.toLocaleString()}`);
  const rate = new D(pf).div(pt).mul(1 - CONVERT_SPREAD);
  const toAmount = fromAmount.mul(rate).toDecimalPlaces(ta.precision, D.ROUND_DOWN);
  if (toAmount.lte(0)) throw badRequest('Amount too small');
  return { from: fa.symbol, to: ta.symbol, fromAmount, toAmount, rate: rate.toSignificantDigits(10) };
}

/** Atomically swaps the user's balance against the treasury and records the conversion. */
export async function settleConvert(userId: string, c: ConvertPrice) {
  return prisma.$transaction(async (tx) => {
    await debitAvailable(tx, userId, c.from, c.fromAmount);
    await adjustBalance(tx, userId, c.to, c.toAmount);
    const house = getTreasuryId();
    await adjustBalance(tx, house, c.from, c.fromAmount);
    if (config.isLive) {
      const r = await tx.balance.updateMany({ where: { userId: house, asset: c.to, available: { gte: c.toAmount } }, data: { available: { decrement: c.toAmount } } });
      if (!r.count) throw badRequest(`Liquidity for ${c.to} is temporarily low — try a smaller amount`);
    } else {
      await adjustBalance(tx, house, c.to, c.toAmount.neg());
    }
    return tx.convertTrade.create({
      data: { userId, fromAsset: c.from, toAsset: c.to, fromAmount: c.fromAmount, toAmount: c.toAmount, price: c.rate },
    });
  });
}
