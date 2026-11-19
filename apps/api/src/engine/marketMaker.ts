/**
 * Market-maker bot: keeps a ladder of bids/asks around the external reference price for every
 * enabled pair, so users always have liquidity and resting orders fill when the market moves through them.
 */
import { D, type Dec } from '../db.js';
import { getPrice } from '../market/feed.js';
import { listPairs, refreshBotQuotes, type BotQuote } from './engine.js';

const LEVELS = 12;
const STEP_BPS = 1.5; // distance between levels, in basis points of price
const REFRESH_MS = 2000;

/** quoteUsd: USD value of 1 unit of the quote asset (1 for USDT, BTC price for BTC-quoted pairs). */
export function buildQuotes(mid: number, pricePrecision: number, qtyPrecision: number, quoteUsd = 1): BotQuote[] {
  const tick = new D(10).pow(-pricePrecision);
  const m = new D(mid);
  let step = m.mul(STEP_BPS / 10_000);
  if (step.lt(tick)) step = tick;
  const asks: BotQuote[] = [];
  const bids: BotQuote[] = [];
  for (let i = 1; i <= LEVELS; i++) {
    const notional = (300 + Math.random() * 2500 * Math.pow(i, 0.8)) / quoteUsd; // ~$300–$15k per level, in quote units
    const mk = (price: Dec): Dec => new D(notional).div(price).toDecimalPlaces(qtyPrecision, D.ROUND_DOWN);
    const ask = m.plus(step.mul(i)).toDecimalPlaces(pricePrecision, D.ROUND_UP);
    const bid = m.minus(step.mul(i)).toDecimalPlaces(pricePrecision, D.ROUND_DOWN);
    const aq = mk(ask);
    if (aq.gt(0)) asks.push({ side: 'SELL', price: ask, qty: aq });
    if (bid.gt(0)) {
      const bq = mk(bid);
      if (bq.gt(0)) bids.push({ side: 'BUY', price: bid, qty: bq });
    }
  }
  return [...asks, ...bids];
}

export function startMarketMaker() {
  const tick = async () => {
    for (const p of listPairs()) {
      const price = getPrice(p.symbol);
      if (!price) continue;
      const quoteUsd = p.quote === 'USDT' ? 1 : getPrice(`${p.quote}USDT`);
      if (!quoteUsd) continue;
      refreshBotQuotes(p.symbol, buildQuotes(price, p.pricePrecision, p.qtyPrecision, quoteUsd)).catch((e) =>
        console.error('[mm] refresh failed', p.symbol, e.message),
      );
    }
  };
  tick();
  setInterval(tick, REFRESH_MS);
  console.log('[mm] market maker running');
}
