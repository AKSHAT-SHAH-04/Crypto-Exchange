'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import type { Market } from '@/lib/types';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { floorStr, fmt, fmtQty } from '@/lib/format';

type OType = 'LIMIT' | 'MARKET' | 'STOP_LIMIT';
type Side = 'BUY' | 'SELL';

interface Props {
  market: Market;
  lastPrice?: number;
  pickedPrice: string | null;
  baseAvail: number;
  quoteAvail: number;
}

function NumInput({ label, unit, value, onChange, disabled, placeholder }: { label: string; unit: string; value: string; onChange?: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <label className={clsx('flex items-center rounded-md border border-line bg-panel2 px-3 focus-within:border-brand', disabled && 'opacity-70')}>
      <span className="w-14 shrink-0 text-xs text-muted">{label}</span>
      <input
        className="num min-w-0 flex-1 bg-transparent py-2 text-right text-sm outline-none"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value.replace(',', '.');
          if (/^\d*\.?\d*$/.test(v)) onChange?.(v);
        }}
      />
      <span className="ml-2 w-12 shrink-0 text-right text-xs text-muted">{unit}</span>
    </label>
  );
}

function SideForm({ side, type, market, lastPrice, pickedPrice, baseAvail, quoteAvail }: Props & { side: Side; type: OType }) {
  const { user } = useAuth();
  const toast = useToast();
  const [price, setPrice] = useState('');
  const [stop, setStop] = useState('');
  const [amount, setAmount] = useState('');
  const [total, setTotal] = useState('');
  const [busy, setBusy] = useState(false);
  const pp = market.pricePrecision;
  const qp = market.qtyPrecision;

  // initialise price with the last price once, and whenever the user clicks the book
  useEffect(() => {
    if (!price && lastPrice) setPrice(lastPrice.toFixed(pp));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPrice]);
  useEffect(() => {
    if (pickedPrice) {
      setPrice(pickedPrice);
      if (amount) setTotal(floorStr(+pickedPrice * +amount, 2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedPrice]);
  useEffect(() => {
    setPrice('');
    setAmount('');
    setTotal('');
    setStop('');
  }, [market.symbol]);

  const effPrice = type === 'MARKET' ? lastPrice ?? 0 : +price || 0;
  const onAmount = (v: string) => {
    setAmount(v);
    setTotal(v && effPrice ? floorStr(+v * effPrice, 2) : '');
  };
  const onTotal = (v: string) => {
    setTotal(v);
    setAmount(v && effPrice ? floorStr(+v / effPrice, qp) : '');
  };
  const onPrice = (v: string) => {
    setPrice(v);
    if (amount && +v) setTotal(floorStr(+amount * +v, 2));
  };
  const pct = (p: number) => {
    if (!effPrice) return;
    if (side === 'BUY') onTotal(floorStr(quoteAvail * p, 2));
    else onAmount(floorStr(baseAvail * p, qp));
  };

  const submit = async () => {
    setBusy(true);
    try {
      const o = await api('/api/orders', {
        method: 'POST',
        body: { symbol: market.symbol, side, type, quantity: amount, ...(type !== 'MARKET' && { price }), ...(type === 'STOP_LIMIT' && { stopPrice: stop }) },
      });
      const filled = +o.filledQty;
      toast(
        o.status === 'PENDING_TRIGGER'
          ? `Stop order placed — triggers at ${stop}`
          : filled > 0
            ? `${side === 'BUY' ? 'Bought' : 'Sold'} ${fmtQty(filled)} ${market.base} @ avg ${fmt(o.avgPrice, pp)}`
            : `${side === 'BUY' ? 'Buy' : 'Sell'} order placed`,
        'success',
      );
      setAmount('');
      setTotal('');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const isBuy = side === 'BUY';
  return (
    <div className="space-y-2.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted">Available</span>
        <span className="num">{user ? (isBuy ? `${fmt(quoteAvail, 2)} ${market.quote}` : `${fmtQty(baseAvail, qp)} ${market.base}`) : '—'}</span>
      </div>
      {type === 'STOP_LIMIT' && <NumInput label="Stop" unit={market.quote} value={stop} onChange={setStop} />}
      {type === 'MARKET' ? (
        <NumInput label="Price" unit={market.quote} value="" disabled placeholder="Market price" />
      ) : (
        <NumInput label={type === 'STOP_LIMIT' ? 'Limit' : 'Price'} unit={market.quote} value={price} onChange={onPrice} />
      )}
      <NumInput label="Amount" unit={market.base} value={amount} onChange={onAmount} />
      <div className="grid grid-cols-4 gap-1.5">
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <button key={p} type="button" onClick={() => pct(p)} disabled={!user} className="rounded border border-line py-1 text-xs text-muted hover:border-brand hover:text-fg disabled:opacity-40">
            {p * 100}%
          </button>
        ))}
      </div>
      <NumInput label={type === 'MARKET' ? '≈ Total' : 'Total'} unit={market.quote} value={total} onChange={onTotal} />
      <div className="flex justify-between text-[11px] text-muted">
        <span>Fee (taker)</span>
        <span>{(+market.takerFee * 100).toFixed(2)}%</span>
      </div>
      {user ? (
        <button onClick={submit} disabled={busy || !+amount || (type !== 'MARKET' && !+price) || (type === 'STOP_LIMIT' && !+stop)} className={clsx('w-full', isBuy ? 'btn-up' : 'btn-down')}>
          {busy ? 'Placing…' : `${isBuy ? 'Buy' : 'Sell'} ${market.base}`}
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Link href="/login" className="btn-ghost">Log in</Link>
          <Link href="/register" className="btn-brand">Sign up</Link>
        </div>
      )}
    </div>
  );
}

export function OrderForm(props: Props) {
  const [type, setType] = useState<OType>('LIMIT');
  const [mobileSide, setMobileSide] = useState<Side>('BUY');
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-1">
        {(['LIMIT', 'MARKET', 'STOP_LIMIT'] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} className={clsx('rounded px-3 py-1 text-sm font-medium', type === t ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg')}>
            {t === 'STOP_LIMIT' ? 'Stop-limit' : t[0] + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-md bg-panel2 p-1 md:hidden">
        <button onClick={() => setMobileSide('BUY')} className={clsx('rounded py-1.5 text-sm font-semibold', mobileSide === 'BUY' ? 'bg-up text-white' : 'text-muted')}>Buy</button>
        <button onClick={() => setMobileSide('SELL')} className={clsx('rounded py-1.5 text-sm font-semibold', mobileSide === 'SELL' ? 'bg-down text-white' : 'text-muted')}>Sell</button>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className={clsx(mobileSide !== 'BUY' && 'hidden md:block')}>
          <SideForm side="BUY" type={type} {...props} />
        </div>
        <div className={clsx(mobileSide !== 'SELL' && 'hidden md:block')}>
          <SideForm side="SELL" type={type} {...props} />
        </div>
      </div>
    </div>
  );
}
