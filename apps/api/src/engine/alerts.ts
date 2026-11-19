/** Price alerts: kept in memory per symbol and checked on every price update. */
import type { PriceAlert } from '@prisma/client';
import { prisma } from '../db.js';
import { onPrice } from '../market/feed.js';
import { notify } from '../lib/notify.js';

const bySymbol = new Map<string, PriceAlert[]>();

export function trackAlert(a: PriceAlert) {
  const list = bySymbol.get(a.symbol) ?? [];
  list.push(a);
  bySymbol.set(a.symbol, list);
}

export function untrackAlert(id: string) {
  for (const list of bySymbol.values()) {
    const i = list.findIndex((a) => a.id === id);
    if (i >= 0) list.splice(i, 1);
  }
}

async function fire(a: PriceAlert, price: number) {
  const r = await prisma.priceAlert.updateMany({ where: { id: a.id, active: true }, data: { active: false, triggeredAt: new Date() } });
  if (!r.count) return;
  const pair = a.symbol.replace(/USDT$/, '/USDT');
  await notify(a.userId, {
    type: 'alert',
    title: `${pair} ${a.direction === 'ABOVE' ? 'rose above' : 'fell below'} ${a.price}`,
    body: `Current price ${price}.${a.note ? ` Note: ${a.note}` : ''}`,
    link: `/trade/${a.symbol}`,
  });
}

export async function initAlerts() {
  const active = await prisma.priceAlert.findMany({ where: { active: true } });
  active.forEach(trackAlert);
  onPrice((symbol, price) => {
    const list = bySymbol.get(symbol);
    if (!list?.length) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      const target = a.price.toNumber();
      if ((a.direction === 'ABOVE' && price >= target) || (a.direction === 'BELOW' && price <= target)) {
        list.splice(i, 1);
        fire(a, price).catch((e) => console.error('[alerts] fire failed', e));
      }
    }
  });
  console.log(`[alerts] tracking ${active.length} alerts`);
}
