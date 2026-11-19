import type { Dec } from '../db.js';

export type Side = 'BUY' | 'SELL';

export interface BookOrder {
  id: string;
  userId: string | null; // null => market-maker bot
  side: Side;
  price: Dec;
  remaining: Dec;
  /** Quote reserved per unit for BUY orders (equals price for resting limit orders). */
  lockPrice: Dec | null;
  seq: number;
}

export interface Fill {
  maker: BookOrder;
  price: Dec;
  qty: Dec;
}

let seqCounter = 0;
export const nextSeq = () => ++seqCounter;

/** Price-time priority limit order book for one trading pair. */
export class OrderBook {
  readonly bids: BookOrder[] = []; // best (highest) first
  readonly asks: BookOrder[] = []; // best (lowest) first
  private byId = new Map<string, BookOrder>();

  constructor(readonly symbol: string) {}

  get(id: string) {
    return this.byId.get(id);
  }

  add(o: BookOrder) {
    const arr = o.side === 'BUY' ? this.bids : this.asks;
    // binary search for the first order with strictly worse price (keeps FIFO within a level)
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const better = o.side === 'BUY' ? arr[mid].price.gte(o.price) : arr[mid].price.lte(o.price);
      if (better) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, o);
    this.byId.set(o.id, o);
  }

  remove(id: string): BookOrder | undefined {
    const o = this.byId.get(id);
    if (!o) return;
    const arr = o.side === 'BUY' ? this.bids : this.asks;
    const idx = arr.indexOf(o);
    if (idx >= 0) arr.splice(idx, 1);
    this.byId.delete(id);
    return o;
  }

  /** Removes every order matching predicate. */
  removeWhere(pred: (o: BookOrder) => boolean) {
    for (const arr of [this.bids, this.asks]) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (pred(arr[i])) {
          this.byId.delete(arr[i].id);
          arr.splice(i, 1);
        }
      }
    }
  }

  /**
   * Dry-run matching: returns the fills an incoming order would produce without mutating the book.
   * limitPrice=null means a market order. Orders owned by the same user are skipped (self-trade prevention).
   */
  computeFills(side: Side, limitPrice: Dec | null, qty: Dec, takerUserId: string | null): Fill[] {
    const book = side === 'BUY' ? this.asks : this.bids;
    const fills: Fill[] = [];
    let left = qty;
    for (const maker of book) {
      if (left.lte(0)) break;
      if (limitPrice) {
        const crosses = side === 'BUY' ? maker.price.lte(limitPrice) : maker.price.gte(limitPrice);
        if (!crosses) break;
      }
      if (takerUserId !== null && maker.userId === takerUserId) continue;
      if (takerUserId === null && maker.userId === null) continue; // bot never trades with itself
      const q = maker.remaining.lt(left) ? maker.remaining : left;
      fills.push({ maker, price: maker.price, qty: q });
      left = left.minus(q);
    }
    return fills;
  }

  /** Applies fills computed by computeFills after they were persisted. */
  applyFills(fills: Fill[]) {
    for (const f of fills) {
      f.maker.remaining = f.maker.remaining.minus(f.qty);
      if (f.maker.remaining.lte(0)) this.remove(f.maker.id);
    }
  }

  depth(levels = 20) {
    const agg = (arr: BookOrder[]) => {
      const out: [string, string][] = [];
      for (const o of arr) {
        const p = o.price.toString();
        const last = out[out.length - 1];
        if (last && last[0] === p) last[1] = o.remaining.plus(last[1]).toString();
        else {
          if (out.length >= levels) break;
          out.push([p, o.remaining.toString()]);
        }
      }
      return out;
    };
    return { symbol: this.symbol, bids: agg(this.bids), asks: agg(this.asks), ts: Date.now() };
  }

  bestBid() {
    return this.bids[0]?.price;
  }
  bestAsk() {
    return this.asks[0]?.price;
  }
}
