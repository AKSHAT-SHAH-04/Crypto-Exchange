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
 */
import { Prisma, type Order, type OrderType, type Pair } from '@prisma/client';
import { prisma, D, ZERO, type Dec } from '../db.js';
import { publish, redis } from '../redis.js';
import { badRequest, notFound } from '../lib/errors.js';
import { pushTrade, onPrice } from '../market/feed.js';
import { OrderBook, nextSeq, type Fill, type Side } from './orderbook.js';

type Tx = Prisma.TransactionClient;

const books = new Map<string, OrderBook>();
const pairs = new Map<string, Pair>();
const stops = new Map<string, Order[]>();
const chains = new Map<string, Promise<unknown>>();
const dirty = new Set<string>();
const lastPrices = new Map<string, number>();
const triggerScheduled = new Set<string>();

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
    else
      books.get(o.symbol)?.add({
        id: o.id, userId: o.userId, side: o.side, price: o.price!, remaining: o.quantity.minus(o.filledQty),
        lockPrice: o.lockPrice, seq: nextSeq(),
      });
  }
  console.log(`[engine] loaded ${pairs.size} pairs, ${open.length} open orders`);

  onPrice((symbol, price) => maybeTriggerStops(symbol, price));

  setInterval(() => {
    for (const s of dirty) {
      const book = books.get(s);
      if (!book) continue;
      const depth = book.depth(20);
      publish({ ch: `depth:${s}`, data: depth });
      redis.set(`exchange:depth:${s}`, JSON.stringify(depth)).catch(() => {});
    }
    dirty.clear();
  }, 300);
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
}

async function settle(tx: Tx, pair: Pair, taker: Taker, fills: Fill[]): Promise<SettleResult> {
  const res: SettleResult = { trades: [], filled: ZERO, quote: ZERO, touchedUsers: new Set() };
  for (const f of fills) {
    const quote = f.price.mul(f.qty);
    const takerIsBuyer = taker.side === 'BUY';
    const buyer = takerIsBuyer
      ? { userId: taker.userId, orderId: taker.orderId, lockPrice: taker.lockPrice, rate: pair.takerFee }
      : { userId: f.maker.userId, orderId: f.maker.userId ? f.maker.id : null, lockPrice: f.maker.lockPrice, rate: pair.makerFee };
    const seller = takerIsBuyer
      ? { userId: f.maker.userId, orderId: f.maker.userId ? f.maker.id : null, rate: pair.makerFee }
      : { userId: taker.userId, orderId: taker.orderId, rate: pair.takerFee };

    const buyerFee = buyer.userId ? f.qty.mul(buyer.rate) : ZERO; // charged in base
    const sellerFee = seller.userId ? quote.mul(seller.rate) : ZERO; // charged in quote

    if (buyer.userId) {
      const reserved = (buyer.lockPrice ?? f.price).mul(f.qty);
      // release reserved quote; refund price improvement; credit base minus fee
      await adjustBalance(tx, buyer.userId, pair.quote, reserved.minus(quote), reserved.neg());
      await adjustBalance(tx, buyer.userId, pair.base, f.qty.minus(buyerFee));
      res.touchedUsers.add(buyer.userId);
    }
    if (seller.userId) {
      await adjustBalance(tx, seller.userId, pair.base, ZERO, f.qty.neg());
      await adjustBalance(tx, seller.userId, pair.quote, quote.minus(sellerFee));
      res.touchedUsers.add(seller.userId);
    }

    if (f.maker.userId) {
      const left = f.maker.remaining.minus(f.qty);
      await tx.order.update({
        where: { id: f.maker.id },
        data: {
          filledQty: { increment: f.qty },
          quoteFilled: { increment: quote },
          status: left.lte(0) ? 'FILLED' : 'PARTIALLY_FILLED',
        },
      });
    }

    const trade = await tx.trade.create({
      data: {
        symbol: pair.symbol, price: f.price, quantity: f.qty, takerSide: taker.side,
        buyOrderId: buyer.orderId, sellOrderId: seller.orderId, buyerId: buyer.userId, sellerId: seller.userId,
        buyerFee, sellerFee,
      },
    });
    res.trades.push({ id: trade.id, price: f.price, qty: f.qty, createdAt: trade.createdAt });
    res.filled = res.filled.plus(f.qty);
    res.quote = res.quote.plus(quote);
  }
  return res;
}

function afterSettle(pair: Pair, book: OrderBook, takerSide: Side, fills: Fill[], result: SettleResult) {
  book.applyFills(fills);
  for (const t of result.trades) {
    pushTrade(pair.symbol, { id: t.id, price: t.price.toNumber(), qty: t.qty.toNumber(), side: takerSide, time: t.createdAt.getTime() });
  }
  for (const f of fills) {
    if (f.maker.userId)
      publish({ ch: 'user', userId: f.maker.userId, data: { type: 'fill', symbol: pair.symbol, side: f.maker.side, price: f.price.toString(), qty: f.qty.toString() } });
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

export function placeOrder(userId: string, input: PlaceOrderInput) {
  const symbol = input.symbol.toUpperCase();
  return serial(symbol, async () => {
    const pair = pairs.get(symbol);
    const book = books.get(symbol);
    if (!pair || !book || !pair.enabled) throw badRequest('Market is not available');

    const qty = dec(input.quantity, 'quantity').toDecimalPlaces(pair.qtyPrecision, D.ROUND_DOWN);
    if (qty.lte(0)) throw badRequest(`Quantity too small (step ${new D(10).pow(-pair.qtyPrecision)})`);

    let price: Dec | null = null;
    let stopPrice: Dec | null = null;
    if (input.type !== 'MARKET') price = dec(input.price, 'price').toDecimalPlaces(pair.pricePrecision, D.ROUND_DOWN);
    if (input.type === 'STOP_LIMIT') stopPrice = dec(input.stopPrice, 'stop price').toDecimalPlaces(pair.pricePrecision, D.ROUND_DOWN);
    if (price && price.lte(0)) throw badRequest('Price too small');

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

    const lockAsset = input.side === 'BUY' ? pair.quote : pair.base;
    const lockAmt = input.side === 'BUY' ? notional : qty;
    const lockPrice = input.side === 'BUY' && price ? price : null;

    const { order, result } = await prisma.$transaction(
      async (tx) => {
        await lockFunds(tx, userId, lockAsset, lockAmt);
        let order = await tx.order.create({
          data: {
            userId, symbol, side: input.side, type: input.type,
            status: input.type === 'STOP_LIMIT' ? 'PENDING_TRIGGER' : 'OPEN',
            price, stopPrice, quantity: qty, lockPrice,
          },
        });
        if (input.type === 'STOP_LIMIT') return { order, result: null };
        const result = await settle(tx, pair, { orderId: order.id, userId, side: input.side, lockPrice }, fills);
        order = await finalizeTaker(tx, pair, order, result);
        return { order, result };
      },
      { timeout: 20_000 },
    );

    if (order.type === 'STOP_LIMIT') {
      stops.get(symbol)!.push(order);
      maybeTriggerStops(symbol, lastPrices.get(symbol));
    } else {
      afterSettle(pair, book, input.side, fills, result!);
      restIfOpen(book, order);
    }
    notifyUser(userId);
    return order;
  });
}

/** Writes the taker's final fill state and, for market orders, unlocks anything unfilled. */
async function finalizeTaker(tx: Tx, pair: Pair, order: Order, r: SettleResult) {
  const filled = order.filledQty.plus(r.filled);
  const full = filled.gte(order.quantity);
  let status: Order['status'];
  if (order.type === 'MARKET') {
    status = full ? 'FILLED' : 'CANCELED';
    if (!full && order.side === 'SELL') {
      const rest = order.quantity.minus(filled);
      await adjustBalance(tx, order.userId, pair.base, rest, rest.neg());
    }
  } else status = full ? 'FILLED' : filled.gt(0) ? 'PARTIALLY_FILLED' : 'OPEN';
  return tx.order.update({
    where: { id: order.id },
    data: { filledQty: filled, quoteFilled: { increment: r.quote }, status },
  });
}

function restIfOpen(book: OrderBook, o: Order) {
  if (o.status !== 'OPEN' && o.status !== 'PARTIALLY_FILLED') return;
  book.add({
    id: o.id, userId: o.userId, side: o.side, price: o.price!, remaining: o.quantity.minus(o.filledQty),
    lockPrice: o.lockPrice, seq: nextSeq(),
  });
  dirty.add(o.symbol);
}

// ---------------- stop-limit triggers ----------------

function shouldTrigger(o: Order, price: number) {
  const sp = o.stopPrice!.toNumber();
  return o.side === 'BUY' ? price >= sp : price <= sp;
}

function maybeTriggerStops(symbol: string, price: number | undefined) {
  if (price === undefined) return;
  lastPrices.set(symbol, price);
  const list = stops.get(symbol);
  if (!list?.length || triggerScheduled.has(symbol)) return;
  if (!list.some((o) => shouldTrigger(o, price))) return;
  triggerScheduled.add(symbol);
  serial(symbol, async () => {
    triggerScheduled.delete(symbol);
    const p = lastPrices.get(symbol)!;
    const due = list.filter((o) => shouldTrigger(o, p));
    for (const o of due) {
      list.splice(list.indexOf(o), 1);
      await activateStop(o).catch((e) => console.error('[engine] stop trigger failed', o.id, e));
    }
  }).catch(() => {});
}

async function activateStop(o: Order) {
  const pair = pairs.get(o.symbol)!;
  const book = books.get(o.symbol)!;
  const fills = book.computeFills(o.side, o.price, o.quantity, o.userId);
  const out = await prisma.$transaction(async (tx) => {
    const r = await tx.order.updateMany({ where: { id: o.id, status: 'PENDING_TRIGGER' }, data: { status: 'OPEN' } });
    if (r.count !== 1) return null; // canceled meanwhile
    const result = await settle(tx, pair, { orderId: o.id, userId: o.userId, side: o.side, lockPrice: o.lockPrice }, fills);
    const order = await finalizeTaker(tx, pair, { ...o, status: 'OPEN' }, result);
    return { order, result };
  });
  if (!out) return;
  afterSettle(pair, book, o.side, fills, out.result);
  restIfOpen(book, out.order);
  publish({ ch: 'user', userId: o.userId, data: { type: 'stop_triggered', orderId: o.id, symbol: o.symbol } });
  notifyUser(o.userId);
}

// ---------------- cancel ----------------

/** Cancels an order. Pass userId=null for admin/system cancels. */
export async function cancelOrder(userId: string | null, orderId: string) {
  const existing = await prisma.order.findUnique({ where: { id: orderId } });
  if (!existing || (userId && existing.userId !== userId)) throw notFound('Order not found');
  return serial(existing.symbol, async () => {
    const pair = pairs.get(existing.symbol)!;
    const order = await prisma.$transaction(async (tx) => {
      const o = await tx.order.findUnique({ where: { id: orderId } });
      if (!o || !(OPEN_STATUSES as readonly string[]).includes(o.status)) throw badRequest('Order is no longer open');
      const r = await tx.order.updateMany({ where: { id: o.id, status: o.status }, data: { status: 'CANCELED' } });
      if (r.count !== 1) throw badRequest('Order is no longer open');
      const rem = o.quantity.minus(o.filledQty);
      if (o.side === 'BUY') {
        const rel = rem.mul(o.lockPrice!);
        await adjustBalance(tx, o.userId, pair.quote, rel, rel.neg());
      } else {
        await adjustBalance(tx, o.userId, pair.base, rem, rem.neg());
      }
      return { ...o, status: 'CANCELED' as const };
    });
    books.get(order.symbol)?.remove(order.id);
    const list = stops.get(order.symbol);
    const idx = list?.findIndex((s) => s.id === order.id) ?? -1;
    if (idx >= 0) list!.splice(idx, 1);
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
