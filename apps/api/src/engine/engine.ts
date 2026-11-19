/**
 * Matching engine.
 *
 * - One in-memory price-time-priority OrderBook per pair; Postgres is the source of truth for
 *   orders, balances and trades. Books are rebuilt from open orders on startup.
 * - Every mutation of a pair runs through a per-pair serial queue, so a dry-run match computed at
 *   the start of a job is still valid when its DB transaction commits.
 * - Flow per order: dry-run match -> one DB transaction (lock funds, create order, settle fills)
 *   -> apply fills to the in-memory book -> publish events.
 * - Market-maker bot orders (userId=null) live only in memory; the bot has no balances.
 *
 * Conditional orders (PENDING_TRIGGER) are kept in a per-pair `stops` list:
 * - STOP_LIMIT: becomes a limit order when the price crosses stopPrice.
 * - TRAILING_STOP: stopPrice follows the best price by `trailingDelta`, then becomes a limit order.
 * - OCO: a LIMIT leg + STOP_LIMIT leg sharing one fund lock (same ocoId). Any fill of the limit
 *   leg cancels the stop leg; triggering the stop leg cancels the (unfilled) limit leg.
 */
import { randomUUID } from 'node:crypto';
import { Prisma, type Order, type OrderType, type Pair } from '@prisma/client';
import { prisma, D, ZERO, type Dec } from '../db.js';
import { publish, redis } from '../redis.js';
import { badRequest, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { pushTrade, onPrice, getPrice } from '../market/feed.js';
import { OrderBook, nextSeq, type Fill, type Side } from './orderbook.js';
import { FEE_TOKEN, FEE_TOKEN_DISCOUNT, REFERRAL_RATE, getFeeProfile } from './fees.js';
import { getTreasuryId } from '../lib/treasury.js';
import { config } from '../config.js';
import { isPriceFresh } from '../market/feed.js';

type Tx = Prisma.TransactionClient;

const books = new Map<string, OrderBook>();
const pairs = new Map<string, Pair>();
const stops = new Map<string, Order[]>();
const chains = new Map<string, Promise<unknown>>();
const dirty = new Set<string>();
const lastPrices = new Map<string, number>();
const triggerScheduled = new Set<string>();
const trailPersist = new Map<string, NodeJS.Timeout>();

const OPEN_STATUSES = ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'] as const;

/** Runs fn after every previously queued job for this symbol. */
export function serial<T>(symbol: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(symbol) ?? Promise.resolve();
  const next = prev.then(fn);
  chains.set(symbol, next.catch(() => {}));
  return next;
}

export const getPair = (s: string) => pairs.get(s);
export const listPairs = () => [...pairs.values()].sort((a, b) => a.sortOrder - b.sortOrder);
export const getBook = (s: string) => books.get(s);
export const lastPrice = (s: string) => lastPrices.get(s) ?? getPrice(s);

export async function reloadPairs() {
  const rows = await prisma.pair.findMany();
  for (const p of rows) {
    pairs.set(p.symbol, p);
    if (!books.has(p.symbol)) books.set(p.symbol, new OrderBook(p.symbol));
    if (!stops.has(p.symbol)) stops.set(p.symbol, []);
  }
}

export async function initEngine() {
  await reloadPairs();
  const open = await prisma.order.findMany({
    where: { status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: 'asc' },
  });
  for (const o of open) {
    if (o.status === 'PENDING_TRIGGER') stops.get(o.symbol)?.push(o);
    else addToBook(books.get(o.symbol), o);
  }
  console.log(`[engine] loaded ${pairs.size} pairs, ${open.length} open orders`);

  onPrice((symbol, price) => maybeTriggerStops(symbol, price));

  setInterval(() => {
    for (const s of dirty) {
      const book = books.get(s);
      if (!book) continue;
      const depth = book.depth(50);
      publish({ ch: `depth:${s}`, data: depth });
      redis.set(`exchange:depth:${s}`, JSON.stringify(depth)).catch(() => {});
    }
    dirty.clear();
  }, 300);
}

function addToBook(book: OrderBook | undefined, o: Order) {
  book?.add({
    id: o.id, userId: o.userId, side: o.side, price: o.price!, remaining: o.quantity.minus(o.filledQty),
    lockPrice: o.lockPrice, seq: nextSeq(),
  });
}

// ---------------- balances ----------------

async function ensureBalance(tx: Tx, userId: string, asset: string) {
  await tx.balance.upsert({ where: { userId_asset: { userId, asset } }, create: { userId, asset }, update: {} });
}

export async function adjustBalance(tx: Tx, userId: string, asset: string, availDelta: Dec, lockedDelta: Dec = ZERO) {
  await tx.balance.upsert({
    where: { userId_asset: { userId, asset } },
    create: { userId, asset, available: availDelta, locked: lockedDelta },
    update: { available: { increment: availDelta }, locked: { increment: lockedDelta } },
  });
}

/** Moves amt from available to locked, failing atomically if the balance is insufficient. */
export async function lockFunds(tx: Tx, userId: string, asset: string, amt: Dec) {
  await ensureBalance(tx, userId, asset);
  const r = await tx.balance.updateMany({
    where: { userId, asset, available: { gte: amt } },
    data: { available: { decrement: amt }, locked: { increment: amt } },
  });
  if (r.count !== 1) throw badRequest(`Insufficient ${asset} balance`, 'INSUFFICIENT_BALANCE');
}

/** Removes amt from available (no lock), failing atomically if insufficient. */
export async function debitAvailable(tx: Tx, userId: string, asset: string, amt: Dec) {
  const r = await tx.balance.updateMany({
    where: { userId, asset, available: { gte: amt } },
    data: { available: { decrement: amt } },
  });
  if (r.count !== 1) throw badRequest(`Insufficient ${asset} balance`, 'INSUFFICIENT_BALANCE');
}

// ---------------- settlement ----------------

interface Taker {
  orderId: string | null;
  userId: string | null;
  side: Side;
  /** For BUY orders: quote reserved per unit (null => market order, reserved exactly at fill price). */
  lockPrice: Dec | null;
}

interface SettleResult {
  trades: { id: string; price: Dec; qty: Dec; createdAt: Date }[];
  filled: Dec;
  quote: Dec;
  touchedUsers: Set<string>;
  filledMakers: { userId: string; orderId: string; side: Side; price: Dec }[];
  /** OCO sibling orders canceled because their partner filled. */
  canceledSiblings: string[];
}

/**
 * Charges a trading fee. With the fee-token discount enabled it tries to pay in FEE_TOKEN first;
 * otherwise the fee is deducted from the received asset by the caller.
 */
async function chargeFee(tx: Tx, userId: string, rate: Dec, feeBase: Dec, feeUsd: number, payWithToken: boolean, defaultAsset: string) {
  const amount = feeBase.mul(rate);
  const usd = feeUsd * rate.toNumber();
  if (payWithToken && usd > 0) {
    const tokenPrice = FEE_TOKEN === 'USDT' ? 1 : getPrice(`${FEE_TOKEN}USDT`);
    if (tokenPrice) {
      const discounted = usd * (1 - FEE_TOKEN_DISCOUNT);
      const tokenAmt = new D(discounted / tokenPrice).toDecimalPlaces(8, D.ROUND_UP);
      const r = await tx.balance.updateMany({
        where: { userId, asset: FEE_TOKEN, available: { gte: tokenAmt } },
        data: { available: { decrement: tokenAmt } },
      });
      if (r.count === 1) return { asset: FEE_TOKEN, amount: tokenAmt, usd: discounted, inProceeds: ZERO };
    }
  }
  return { asset: defaultAsset, amount, usd, inProceeds: amount };
}

async function settle(tx: Tx, pair: Pair, taker: Taker, fills: Fill[]): Promise<SettleResult> {
  const res: SettleResult = { trades: [], filled: ZERO, quote: ZERO, touchedUsers: new Set(), filledMakers: [], canceledSiblings: [] };
  const profiles = new Map<string, Awaited<ReturnType<typeof getFeeProfile>>>();
  const profile = async (u: string) => {
    if (!profiles.has(u)) profiles.set(u, await getFeeProfile(u));
    return profiles.get(u)!;
  };
  const ocoChecked = new Set<string>();

  for (const f of fills) {
    const quote = f.price.mul(f.qty);
    const takerIsBuyer = taker.side === 'BUY';
    const buyer = takerIsBuyer
      ? { userId: taker.userId, orderId: taker.orderId, lockPrice: taker.lockPrice, isMaker: false }
      : { userId: f.maker.userId, orderId: f.maker.userId ? f.maker.id : null, lockPrice: f.maker.lockPrice, isMaker: true };
    const seller = takerIsBuyer
      ? { userId: f.maker.userId, orderId: f.maker.userId ? f.maker.id : null, isMaker: true }
      : { userId: taker.userId, orderId: taker.orderId, isMaker: false };

    let buyerFee = { asset: pair.base, amount: ZERO, usd: 0, inProceeds: ZERO };
    let sellerFee = { asset: pair.quote, amount: ZERO, usd: 0, inProceeds: ZERO };

    if (buyer.userId) {
      const p = await profile(buyer.userId);
      const rate = (buyer.isMaker ? pair.makerFee : pair.takerFee).mul(buyer.isMaker ? p.makerMult : p.takerMult);
      buyerFee = await chargeFee(tx, buyer.userId, rate, f.qty, quote.toNumber(), p.payWithToken, pair.base);
      const reserved = (buyer.lockPrice ?? f.price).mul(f.qty);
      // release reserved quote; refund price improvement; credit base minus fee
      await adjustBalance(tx, buyer.userId, pair.quote, reserved.minus(quote), reserved.neg());
      await adjustBalance(tx, buyer.userId, pair.base, f.qty.minus(buyerFee.inProceeds));
      res.touchedUsers.add(buyer.userId);
    }
    if (seller.userId) {
      const p = await profile(seller.userId);
      const rate = (seller.isMaker ? pair.makerFee : pair.takerFee).mul(seller.isMaker ? p.makerMult : p.takerMult);
      sellerFee = await chargeFee(tx, seller.userId, rate, quote, quote.toNumber(), p.payWithToken, pair.quote);
      await adjustBalance(tx, seller.userId, pair.base, ZERO, f.qty.neg());
      await adjustBalance(tx, seller.userId, pair.quote, quote.minus(sellerFee.inProceeds));
      res.touchedUsers.add(seller.userId);
    }

    if (f.maker.userId) {
      const left = f.maker.remaining.minus(f.qty);
      const updated = await tx.order.update({
        where: { id: f.maker.id },
        data: {
          filledQty: { increment: f.qty },
          quoteFilled: { increment: quote },
          status: left.lte(0) ? 'FILLED' : 'PARTIALLY_FILLED',
        },
      });
      if (left.lte(0)) res.filledMakers.push({ userId: f.maker.userId, orderId: f.maker.id, side: f.maker.side, price: f.price });
      if (updated.ocoId && !ocoChecked.has(updated.ocoId)) {
        ocoChecked.add(updated.ocoId);
        res.canceledSiblings.push(...(await cancelOcoSiblings(tx, updated.ocoId, updated.id)));
      }
    }

    const trade = await tx.trade.create({
      data: {
        symbol: pair.symbol, price: f.price, quantity: f.qty, takerSide: taker.side,
        buyOrderId: buyer.orderId, sellOrderId: seller.orderId, buyerId: buyer.userId, sellerId: seller.userId,
        buyerFee: buyerFee.amount, sellerFee: sellerFee.amount,
        buyerFeeAsset: buyer.userId ? buyerFee.asset : null, sellerFeeAsset: seller.userId ? sellerFee.asset : null,
        feeUsd: new D(buyerFee.usd + sellerFee.usd),
      },
    });
    // Fees are revenue: the payer's referrer (if any) gets REFERRAL_RATE of it, the house keeps the rest,
    // so the ledger stays balanced.
    for (const [payerId, fee] of [[buyer.userId, buyerFee], [seller.userId, sellerFee]] as const) {
      if (!payerId || fee.amount.lte(0)) continue;
      const p = await profile(payerId);
      let houseShare = fee.amount;
      if (p.referrerId && REFERRAL_RATE > 0) {
        const commission = fee.amount.mul(REFERRAL_RATE).toDecimalPlaces(18, D.ROUND_DOWN);
        if (commission.gt(0)) {
          houseShare = fee.amount.minus(commission);
          await adjustBalance(tx, p.referrerId, fee.asset, commission);
          await tx.referralReward.create({
            data: { referrerId: p.referrerId, refereeId: payerId, asset: fee.asset, amount: commission, usdValue: new D(fee.usd * REFERRAL_RATE), tradeId: trade.id },
          });
          res.touchedUsers.add(p.referrerId);
        }
      }
      if (houseShare.gt(0)) await adjustBalance(tx, getTreasuryId(), fee.asset, houseShare);
    }

    res.trades.push({ id: trade.id, price: f.price, qty: f.qty, createdAt: trade.createdAt });
    res.filled = res.filled.plus(f.qty);
    res.quote = res.quote.plus(quote);
  }
  return res;
}

/** Cancels the still-pending stop leg of an OCO whose limit leg traded. Funds stay with the limit leg. */
async function cancelOcoSiblings(tx: Tx, ocoId: string, keepId: string) {
  const sibs = await tx.order.findMany({ where: { ocoId, id: { not: keepId }, status: 'PENDING_TRIGGER' }, select: { id: true } });
  if (!sibs.length) return [];
  await tx.order.updateMany({ where: { id: { in: sibs.map((s) => s.id) }, status: 'PENDING_TRIGGER' }, data: { status: 'CANCELED' } });
  return sibs.map((s) => s.id);
}

function removeStops(symbol: string, ids: string[]) {
  const list = stops.get(symbol);
  if (!list) return;
  for (const id of ids) {
    const i = list.findIndex((o) => o.id === id);
    if (i >= 0) list.splice(i, 1);
  }
}

function afterSettle(pair: Pair, book: OrderBook, takerSide: Side, fills: Fill[], result: SettleResult) {
  book.applyFills(fills);
  removeStops(pair.symbol, result.canceledSiblings);
  for (const t of result.trades) {
    pushTrade(pair.symbol, { id: t.id, price: t.price.toNumber(), qty: t.qty.toNumber(), side: takerSide, time: t.createdAt.getTime() });
  }
  for (const f of fills) {
    if (f.maker.userId)
      publish({ ch: 'user', userId: f.maker.userId, data: { type: 'fill', symbol: pair.symbol, side: f.maker.side, price: f.price.toString(), qty: f.qty.toString() } });
  }
  for (const m of result.filledMakers) {
    notify(m.userId, {
      type: 'order',
      title: `${m.side === 'BUY' ? 'Buy' : 'Sell'} order filled`,
      body: `Your ${pair.base}/${pair.quote} ${m.side.toLowerCase()} order was fully filled at ${m.price}.`,
      link: `/trade/${pair.symbol}`,
    });
  }
  for (const u of result.touchedUsers) notifyUser(u);
  if (result.trades.length) {
    const last = result.trades[result.trades.length - 1].price.toNumber();
    lastPrices.set(pair.symbol, last);
    maybeTriggerStops(pair.symbol, last);
  }
  dirty.add(pair.symbol);
}

export function notifyUser(userId: string) {
  publish({ ch: 'user', userId, data: { type: 'refresh', scopes: ['orders', 'balances'] } });
}

// ---------------- placing orders ----------------

export interface PlaceOrderInput {
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: string;
  price?: string;
  stopPrice?: string;
  /** TRAILING_STOP callback rate as a fraction, e.g. "0.01" for 1% */
  trailingDelta?: string;
  /** LIMIT only: GTC (default) rests on the book, IOC cancels the unfilled rest, FOK fills fully or not at all */
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  /** LIMIT only: reject instead of trading immediately (guarantees maker fee) */
  postOnly?: boolean;
}

const dec = (v: string | undefined, name: string) => {
  try {
    const d = new D(v ?? '');
    if (!d.isFinite() || d.lte(0)) throw 0;
    return d;
  } catch {
    throw badRequest(`Invalid ${name}`);
  }
};

/** In live mode, orders that depend on the reference price are refused while market data is stale. */
function assertMarketLive(symbol: string, needsPrice: boolean) {
  if (config.isLive && needsPrice && !isPriceFresh(symbol)) throw badRequest('Market data is temporarily unavailable — try again shortly');
}

function pairOrThrow(symbol: string) {
  const pair = pairs.get(symbol);
  const book = books.get(symbol);
  if (!pair || !book || !pair.enabled) throw badRequest('Market is not available');
  return { pair, book };
}

function roundQty(pair: Pair, v: string | undefined) {
  const qty = dec(v, 'quantity').toDecimalPlaces(pair.qtyPrecision, D.ROUND_DOWN);
  if (qty.lte(0)) throw badRequest(`Quantity too small (step ${new D(10).pow(-pair.qtyPrecision)})`);
  return qty;
}
const roundPrice = (pair: Pair, v: string | undefined, name: string) => {
  const p = dec(v, name).toDecimalPlaces(pair.pricePrecision, D.ROUND_DOWN);
  if (p.lte(0)) throw badRequest(`${name} too small`);
  return p;
};

function initialTrailStop(side: Side, ref: number, delta: Dec, pp: number) {
  const r = new D(ref);
  return side === 'SELL'
    ? r.mul(new D(1).minus(delta)).toDecimalPlaces(pp, D.ROUND_DOWN)
    : r.mul(new D(1).plus(delta)).toDecimalPlaces(pp, D.ROUND_UP);
}

export function placeOrder(userId: string, input: PlaceOrderInput) {
  const symbol = input.symbol.toUpperCase();
  if (!pairs.has(symbol)) return Promise.reject(badRequest('Market is not available'));
  return serial(symbol, async () => {
    const { pair, book } = pairOrThrow(symbol);
    assertMarketLive(symbol, input.type !== 'LIMIT');
    const qty = roundQty(pair, input.quantity);
    const conditional = input.type === 'STOP_LIMIT' || input.type === 'TRAILING_STOP';

    let price: Dec | null = null;
    let stopPrice: Dec | null = null;
    let trailingDelta: Dec | null = null;
    if (input.type !== 'MARKET') price = roundPrice(pair, input.price, 'price');
    if (input.type === 'STOP_LIMIT') stopPrice = roundPrice(pair, input.stopPrice, 'stop price');
    if (input.type === 'TRAILING_STOP') {
      trailingDelta = dec(input.trailingDelta, 'trailing delta');
      if (trailingDelta.lt(0.001) || trailingDelta.gt(0.2)) throw badRequest('Trailing delta must be between 0.1% and 20%');
      const ref = lastPrice(symbol);
      if (!ref) throw badRequest('No market price available yet');
      stopPrice = initialTrailStop(input.side, ref, trailingDelta, pair.pricePrecision);
    }

    let fills: Fill[] = [];
    let notional: Dec;
    if (input.type === 'MARKET') {
      fills = book.computeFills(input.side, null, qty, userId);
      if (!fills.length) throw badRequest('No liquidity available right now');
      notional = fills.reduce((s, f) => s.plus(f.price.mul(f.qty)), ZERO);
    } else {
      notional = price!.mul(qty);
      if (input.type === 'LIMIT') fills = book.computeFills(input.side, price, qty, userId);
    }
    if (notional.lt(pair.minNotional)) throw badRequest(`Order value must be at least ${pair.minNotional} ${pair.quote}`);

    const tif = input.type === 'LIMIT' ? input.timeInForce ?? 'GTC' : 'GTC';
    const postOnly = input.type === 'LIMIT' && !!input.postOnly;
    if (input.type !== 'LIMIT' && (input.postOnly || (input.timeInForce && input.timeInForce !== 'GTC'))) {
      throw badRequest('Time-in-force and post-only apply to limit orders only');
    }
    if (postOnly && tif !== 'GTC') throw badRequest('Post-only orders must be good-till-canceled');
    if (postOnly && fills.length) throw badRequest('Post-only order would trade immediately — pick a price that rests on the book');
    if (tif === 'FOK' && fills.reduce((s, f) => s.plus(f.qty), ZERO).lt(qty)) {
      throw badRequest('Fill-or-kill order could not be filled completely at this price');
    }

    const lockAsset = input.side === 'BUY' ? pair.quote : pair.base;
    const lockAmt = input.side === 'BUY' ? notional : qty;
    const lockPrice = input.side === 'BUY' && price ? price : null;

    const { order, result } = await prisma.$transaction(
      async (tx) => {
        await lockFunds(tx, userId, lockAsset, lockAmt);
        let order = await tx.order.create({
          data: {
            userId, symbol, side: input.side, type: input.type,
            status: conditional ? 'PENDING_TRIGGER' : 'OPEN',
            price, stopPrice, trailingDelta, quantity: qty, lockPrice, timeInForce: tif, postOnly,
          },
        });
        if (conditional) return { order, result: null };
        const result = await settle(tx, pair, { orderId: order.id, userId, side: input.side, lockPrice }, fills);
        order = await finalizeTaker(tx, pair, order, result);
        return { order, result };
      },
      { timeout: 20_000 },
    );

    if (conditional) {
      stops.get(symbol)!.push(order);
      maybeTriggerStops(symbol, lastPrice(symbol));
    } else {
      afterSettle(pair, book, input.side, fills, result!);
      restIfOpen(book, order);
    }
    notifyUser(userId);
    return order;
  });
}

export interface PlaceOcoInput {
  symbol: string;
  side: Side;
  quantity: string;
  /** Limit leg price (take-profit side) */
  price: string;
  stopPrice: string;
  stopLimitPrice: string;
}

/** One-cancels-the-other: a limit order plus a stop-limit order sharing a single fund lock. */
export function placeOco(userId: string, input: PlaceOcoInput) {
  const symbol = input.symbol.toUpperCase();
  if (!pairs.has(symbol)) return Promise.reject(badRequest('Market is not available'));
  return serial(symbol, async () => {
    const { pair, book } = pairOrThrow(symbol);
    assertMarketLive(symbol, true);
    const qty = roundQty(pair, input.quantity);
    const price = roundPrice(pair, input.price, 'price');
    const stopPrice = roundPrice(pair, input.stopPrice, 'stop price');
    const stopLimit = roundPrice(pair, input.stopLimitPrice, 'stop-limit price');
    const ref = lastPrice(symbol);
    if (!ref) throw badRequest('No market price available yet');
    const last = new D(ref);
    if (input.side === 'SELL' && !(price.gt(last) && stopPrice.lt(last)))
      throw badRequest(`For a sell OCO the limit price must be above and the stop price below the last price (${ref})`);
    if (input.side === 'BUY' && !(price.lt(last) && stopPrice.gt(last)))
      throw badRequest(`For a buy OCO the limit price must be below and the stop price above the last price (${ref})`);
    for (const p of [price, stopLimit]) {
      if (p.mul(qty).lt(pair.minNotional)) throw badRequest(`Each leg must be worth at least ${pair.minNotional} ${pair.quote}`);
    }

    const lockPrice = input.side === 'BUY' ? D.max(price, stopLimit) : null;
    const lockAsset = input.side === 'BUY' ? pair.quote : pair.base;
    const lockAmt = input.side === 'BUY' ? lockPrice!.mul(qty) : qty;
    const fills = book.computeFills(input.side, price, qty, userId);
    const ocoId = randomUUID();

    const out = await prisma.$transaction(async (tx) => {
      await lockFunds(tx, userId, lockAsset, lockAmt);
      let limit = await tx.order.create({
        data: { userId, symbol, side: input.side, type: 'LIMIT', status: 'OPEN', price, quantity: qty, lockPrice, ocoId },
      });
      let stop = await tx.order.create({
        data: { userId, symbol, side: input.side, type: 'STOP_LIMIT', status: 'PENDING_TRIGGER', price: stopLimit, stopPrice, quantity: qty, lockPrice, ocoId },
      });
      const result = await settle(tx, pair, { orderId: limit.id, userId, side: input.side, lockPrice }, fills);
      limit = await finalizeTaker(tx, pair, limit, result);
      if (result.filled.gt(0)) {
        await tx.order.update({ where: { id: stop.id }, data: { status: 'CANCELED' } });
        stop = { ...stop, status: 'CANCELED' };
      }
      return { limit, stop, result };
    });

    afterSettle(pair, book, input.side, fills, out.result);
    restIfOpen(book, out.limit);
    if (out.stop.status === 'PENDING_TRIGGER') {
      stops.get(symbol)!.push(out.stop);
      maybeTriggerStops(symbol, lastPrice(symbol));
    }
    notifyUser(userId);
    return { ocoId, orders: [out.limit, out.stop] };
  });
}

/** Writes the taker's final fill state and, for market orders, unlocks anything unfilled. */
async function finalizeTaker(tx: Tx, pair: Pair, order: Order, r: SettleResult) {
  const filled = order.filledQty.plus(r.filled);
  const full = filled.gte(order.quantity);
  let status: Order['status'];
  // Market, IOC and FOK orders never rest: cancel and unlock whatever didn't fill.
  if (order.type === 'MARKET' || order.timeInForce !== 'GTC') {
    status = full ? 'FILLED' : 'CANCELED';
    if (!full) {
      const rest = order.quantity.minus(filled);
      if (order.side === 'SELL') await adjustBalance(tx, order.userId, pair.base, rest, rest.neg());
      else if (order.lockPrice) {
        const rel = rest.mul(order.lockPrice);
        await adjustBalance(tx, order.userId, pair.quote, rel, rel.neg());
      }
    }
  } else status = full ? 'FILLED' : filled.gt(0) ? 'PARTIALLY_FILLED' : 'OPEN';
  return tx.order.update({
    where: { id: order.id },
    data: { filledQty: filled, quoteFilled: { increment: r.quote }, status },
  });
}

function restIfOpen(book: OrderBook, o: Order) {
  if (o.status !== 'OPEN' && o.status !== 'PARTIALLY_FILLED') return;
  addToBook(book, o);
  dirty.add(o.symbol);
}

// ---------------- conditional order triggers ----------------

/** Updates trailing stops' reference price; returns true if the order should trigger now. */
function checkTrigger(o: Order, price: number) {
  if (o.type === 'TRAILING_STOP' && o.trailingDelta) {
    const pp = pairs.get(o.symbol)?.pricePrecision ?? 8;
    const candidate = initialTrailStop(o.side, price, o.trailingDelta, pp);
    const better = o.side === 'SELL' ? candidate.gt(o.stopPrice!) : candidate.lt(o.stopPrice!);
    if (better) {
      o.stopPrice = candidate;
      persistTrail(o);
    }
  }
  const sp = o.stopPrice!.toNumber();
  return o.side === 'BUY' ? price >= sp : price <= sp;
}

/** Writes the moving trailing stop price to the DB at most every 5s per order. */
function persistTrail(o: Order) {
  if (trailPersist.has(o.id)) return;
  trailPersist.set(
    o.id,
    setTimeout(() => {
      trailPersist.delete(o.id);
      prisma.order.updateMany({ where: { id: o.id, status: 'PENDING_TRIGGER' }, data: { stopPrice: o.stopPrice } }).catch(() => {});
      notifyUser(o.userId);
    }, 5000),
  );
}

function maybeTriggerStops(symbol: string, price: number | undefined) {
  if (price === undefined) return;
  lastPrices.set(symbol, price);
  const list = stops.get(symbol);
  if (!list?.length || triggerScheduled.has(symbol)) return;
  let any = false;
  for (const o of list) if (checkTrigger(o, price)) any = true;
  if (!any) return;
  triggerScheduled.add(symbol);
  serial(symbol, async () => {
    triggerScheduled.delete(symbol);
    const p = lastPrices.get(symbol)!;
    const due = list.filter((o) => checkTrigger(o, p));
    for (const o of due) {
      const i = list.indexOf(o);
      if (i >= 0) list.splice(i, 1);
      await activateStop(o).catch((e) => console.error('[engine] stop trigger failed', o.id, e));
    }
  }).catch(() => {});
}

async function activateStop(o: Order) {
  const pair = pairs.get(o.symbol)!;
  const book = books.get(o.symbol)!;
  const fills = book.computeFills(o.side, o.price, o.quantity, o.userId);
  const out = await prisma.$transaction(async (tx) => {
    const r = await tx.order.updateMany({
      where: { id: o.id, status: 'PENDING_TRIGGER' },
      data: { status: 'OPEN', ...(o.type === 'TRAILING_STOP' ? { stopPrice: o.stopPrice } : {}) },
    });
    if (r.count !== 1) return null; // canceled meanwhile
    let siblingId: string | null = null;
    if (o.ocoId) {
      // the limit leg must still be untouched; it hands its fund lock over to this leg
      const sib = await tx.order.findFirst({ where: { ocoId: o.ocoId, id: { not: o.id }, status: 'OPEN', filledQty: 0 } });
      if (sib) {
        await tx.order.update({ where: { id: sib.id }, data: { status: 'CANCELED' } });
        siblingId = sib.id;
      }
    }
    const result = await settle(tx, pair, { orderId: o.id, userId: o.userId, side: o.side, lockPrice: o.lockPrice }, fills);
    const order = await finalizeTaker(tx, pair, { ...o, status: 'OPEN' }, result);
    return { order, result, siblingId };
  });
  if (!out) return;
  if (out.siblingId) book.remove(out.siblingId);
  afterSettle(pair, book, o.side, fills, out.result);
  restIfOpen(book, out.order);
  const label = o.type === 'TRAILING_STOP' ? 'Trailing stop' : o.ocoId ? 'OCO stop' : 'Stop-limit';
  publish({ ch: 'user', userId: o.userId, data: { type: 'stop_triggered', orderId: o.id, symbol: o.symbol } });
  notify(o.userId, {
    type: 'order',
    title: `${label} triggered`,
    body: `Your ${pair.base}/${pair.quote} ${o.side.toLowerCase()} order triggered at ${o.stopPrice} and was placed at ${o.price}.`,
    link: `/trade/${o.symbol}`,
  });
  notifyUser(o.userId);
}

// ---------------- cancel ----------------

/** Cancels an order (and its OCO partner). Pass userId=null for admin/system cancels. */
export async function cancelOrder(userId: string | null, orderId: string) {
  const existing = await prisma.order.findUnique({ where: { id: orderId } });
  if (!existing || (userId && existing.userId !== userId)) throw notFound('Order not found');
  return serial(existing.symbol, async () => {
    const pair = pairs.get(existing.symbol)!;
    const { order, ids } = await prisma.$transaction(async (tx) => {
      const o = await tx.order.findUnique({ where: { id: orderId } });
      if (!o || !(OPEN_STATUSES as readonly string[]).includes(o.status)) throw badRequest('Order is no longer open');
      const legs = o.ocoId
        ? await tx.order.findMany({ where: { ocoId: o.ocoId, status: { in: [...OPEN_STATUSES] } } })
        : [o];
      for (const leg of legs) {
        const r = await tx.order.updateMany({ where: { id: leg.id, status: leg.status }, data: { status: 'CANCELED' } });
        if (r.count !== 1) throw badRequest('Order is no longer open');
      }
      // OCO legs share one lock: release it once, based on the most-filled open leg
      const maxFilled = legs.reduce((m, l) => (l.filledQty.gt(m) ? l.filledQty : m), ZERO);
      const rem = o.quantity.minus(maxFilled);
      if (o.side === 'BUY') {
        const rel = rem.mul(o.lockPrice!);
        await adjustBalance(tx, o.userId, pair.quote, rel, rel.neg());
      } else {
        await adjustBalance(tx, o.userId, pair.base, rem, rem.neg());
      }
      return { order: { ...o, status: 'CANCELED' as const }, ids: legs.map((l) => l.id) };
    });
    for (const id of ids) books.get(order.symbol)?.remove(id);
    removeStops(order.symbol, ids);
    dirty.add(order.symbol);
    notifyUser(order.userId);
    return order;
  });
}

export async function cancelAllForUser(userId: string) {
  const open = await prisma.order.findMany({ where: { userId, status: { in: [...OPEN_STATUSES] } }, select: { id: true } });
  for (const o of open) await cancelOrder(null, o.id).catch(() => {});
  return open.length;
}

// ---------------- market maker hook ----------------

export interface BotQuote {
  side: Side;
  price: Dec;
  qty: Dec;
}

/** Replaces all bot liquidity for a pair. Bot quotes that cross resting user orders trade against them. */
export function refreshBotQuotes(symbol: string, quotes: BotQuote[]) {
  return serial(symbol, async () => {
    const pair = pairs.get(symbol);
    const book = books.get(symbol);
    if (!pair || !book) return;
    book.removeWhere((o) => o.userId === null);
    if (!pair.enabled) {
      dirty.add(symbol);
      return;
    }
    for (const q of quotes) {
      const fills = book.computeFills(q.side, q.price, q.qty, null);
      let filled = ZERO;
      if (fills.length) {
        const result = await prisma.$transaction((tx) =>
          settle(tx, pair, { orderId: null, userId: null, side: q.side, lockPrice: null }, fills),
        );
        afterSettle(pair, book, q.side, fills, result);
        filled = result.filled;
      }
      const rem = q.qty.minus(filled);
      if (rem.gt(0)) book.add({ id: `mm-${nextSeq()}`, userId: null, side: q.side, price: q.price, remaining: rem, lockPrice: q.price, seq: nextSeq() });
    }
    dirty.add(symbol);
  });
}
