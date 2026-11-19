/** Fiat FX rates (units of currency per 1 USD), refreshed hourly with a static fallback. AED is pegged. */
import { config } from '../config.js';

const rates = new Map<string, number>(Object.entries(config.fxFallback));
let lastUpdate = 0;

async function refresh() {
  try {
    const res = await fetch(config.fxUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`FX ${res.status}`);
    const body = (await res.json()) as { rates?: Record<string, number> };
    for (const cur of config.fiatCurrencies) {
      const r = body.rates?.[cur];
      if (typeof r === 'number' && r > 0) rates.set(cur, r);
    }
    rates.set('USD', 1);
    lastUpdate = Date.now();
  } catch (e) {
    console.warn('[fx] refresh failed, using last known/fallback rates:', (e as Error).message);
  }
}

export function startFx() {
  refresh();
  setInterval(refresh, 60 * 60_000);
}

/** USD value of 1 unit of the currency (0 if unknown). */
export function usdPerUnit(currency: string) {
  const r = rates.get(currency);
  return r ? 1 / r : 0;
}

export const fxStatus = () => ({ rates: Object.fromEntries(rates), lastUpdate });
