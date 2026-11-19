export function fmt(n: number | string | null | undefined, dp = 2) {
  const v = typeof n === 'string' ? Number(n) : n;
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Sensible precision for a price of unknown magnitude. */
export function fmtPrice(n: number | string | null | undefined, dp?: number) {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  if (dp !== undefined) return fmt(v, dp);
  const a = Math.abs(v);
  return fmt(v, a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 8);
}

export function fmtCompact(n: number) {
  if (!isFinite(n)) return '—';
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
}

export function fmtQty(n: number | string, dp = 6) {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: dp });
}

export const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n, 2)}%`;
export const fmtTime = (d: string | number) => new Date(d).toLocaleTimeString('en-GB', { hour12: false });
export const fmtDateTime = (d: string | number) =>
  new Date(d).toLocaleString('en-GB', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Truncate (never round up) to dp decimals, returned as a plain string for inputs. */
export function floorStr(n: number, dp: number) {
  if (!isFinite(n) || n <= 0) return '';
  const f = Math.pow(10, dp);
  return (Math.floor(n * f + 1e-9) / f).toFixed(dp);
}

export const pairLabel = (base: string, quote: string) => `${base}/${quote}`;
export const brand = process.env.NEXT_PUBLIC_BRAND_NAME || 'Zentra';
