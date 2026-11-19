'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import type { Market } from '@/lib/types';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { floorStr, fmt, fmtQty } from '@/lib/format';
import { useT } from '@/lib/i18n';

type OType = 'LIMIT' | 'MARKET' | 'STOP_LIMIT' | 'OCO' | 'TRAILING_STOP';
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
  const { t } = useT();
  const toast = useToast();
  const [price, setPrice] = useState('');
  const [stop, setStop] = useState('');
  const [stopLimit, setStopLimit] = useState('');
  const [trail, setTrail] = useState('1');
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
    setStopLimit('');
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
      if (type === 'OCO') {
        await api('/api/orders/oco', { method: 'POST', body: { symbol: market.symbol, side, quantity: amount, price, stopPrice: stop, stopLimitPrice: stopLimit } });
        toast(`OCO placed: limit ${price} / stop ${stop}`, 'success');
        setAmount('');
        setTotal('');
        return;
      }
      const o = await api('/api/orders', {
        method: 'POST',
        body: {
          symbol: market.symbol, side, type, quantity: amount, ...(type !== 'MARKET' && { price }),
          ...(type === 'STOP_LIMIT' && { stopPrice: stop }),
          ...(type === 'TRAILING_STOP' && { trailingDelta: String(+trail / 100) }),
        },
      });
      const filled = +o.filledQty;
      toast(
        o.status === 'PENDING_TRIGGER'
          ? `${type === 'TRAILING_STOP' ? 'Trailing stop' : 'Stop order'} placed — triggers at ${o.stopPrice}`
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
        <span className="text-muted">{t('trade.available')}</span>
        <span className="num">{user ? (isBuy ? `${fmt(quoteAvail, 2)} ${market.quote}` : `${fmtQty(baseAvail, qp)} ${market.base}`) : '—'}</span>
      </div>
      {type === 'STOP_LIMIT' && <NumInput label={t('trade.stop')} unit={market.quote} value={stop} onChange={setStop} />}
      {type === 'TRAILING_STOP' && (
        <>
          <div className="grid grid-cols-5 gap-1">
            {['0.5', '1', '2', '5', '10'].map((v) => (
              <button key={v} type="button" onClick={() => setTrail(v)} className={clsx('rounded border py-1 text-xs', trail === v ? 'border-brand text-fg' : 'border-line text-muted hover:text-fg')}>{v}%</button>
            ))}
          </div>
          <NumInput label={t('trade.trailingDelta')} unit="%" value={trail} onChange={setTrail} />
        </>
      )}
      {type === 'MARKET' ? (
        <NumInput label={t('trade.price')} unit={market.quote} value="" disabled placeholder="Market price" />
      ) : (
        <NumInput label={type === 'STOP_LIMIT' || type === 'TRAILING_STOP' ? 'Limit' : type === 'OCO' ? 'Limit' : t('trade.price')} unit={market.quote} value={price} onChange={onPrice} />
      )}
      {type === 'OCO' && (
        <>
          <NumInput label={t('trade.stop')} unit={market.quote} value={stop} onChange={setStop} placeholder={isBuy ? 'Above last price' : 'Below last price'} />
          <NumInput label="S-Limit" unit={market.quote} value={stopLimit} onChange={setStopLimit} />
        </>
      )}
      <NumInput label={t('trade.amount')} unit={market.base} value={amount} onChange={onAmount} />
      <div className="grid grid-cols-4 gap-1.5">
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <button key={p} type="button" onClick={() => pct(p)} disabled={!user} className="rounded border border-line py-1 text-xs text-muted hover:border-brand hover:text-fg disabled:opacity-40">
            {p * 100}%
          </button>
        ))}
      </div>
      <NumInput label={type === 'MARKET' ? `≈ ${t('trade.total')}` : t('trade.total')} unit={market.quote} value={total} onChange={onTotal} />
      {type === 'OCO' && <p className="text-[11px] text-muted">{isBuy ? 'Buys at the limit price, or if price rises to the stop, places a stop-limit buy. One cancels the other.' : 'Sells at the limit price (take-profit), or if price falls to the stop, places a stop-limit sell (stop-loss). One cancels the other.'}</p>}
      {type === 'TRAILING_STOP' && lastPrice && +trail > 0 && (
        <p className="text-[11px] text-muted">
          Triggers when price {isBuy ? 'rises' : 'falls'} {trail}% from its {isBuy ? 'lowest' : 'highest'} point — now ≈ <span className="num text-fg">{fmt(lastPrice * (isBuy ? 1 + +trail / 100 : 1 - +trail / 100), pp)}</span>
        </p>
      )}
      <div className="flex justify-between text-[11px] text-muted">
        <span>{t('trade.fee')}</span>
        <span>{(+market.takerFee * 100).toFixed(2)}%</span>
      </div>
      {user ? (
        <button
          onClick={submit}
          disabled={busy || !+amount || (type !== 'MARKET' && !+price) || ((type === 'STOP_LIMIT' || type === 'OCO') && !+stop) || (type === 'OCO' && !+stopLimit) || (type === 'TRAILING_STOP' && !+trail)}
          className={clsx('w-full', isBuy ? 'btn-up' : 'btn-down')}
        >
          {busy ? '…' : `${isBuy ? t('trade.buy') : t('trade.sell')} ${market.base}`}
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Link href="/login" className="btn-ghost">{t('nav.login')}</Link>
          <Link href="/register" className="btn-brand">{t('nav.signup')}</Link>
        </div>
      )}
    </div>
  );
}

export function OrderForm(props: Props) {
  const { t } = useT();
  const [type, setType] = useState<OType>('LIMIT');
  const labels: Record<OType, string> = { LIMIT: t('trade.limit'), MARKET: t('trade.market'), STOP_LIMIT: t('trade.stopLimit'), OCO: t('trade.oco'), TRAILING_STOP: t('trade.trailing') };
  const [mobileSide, setMobileSide] = useState<Side>('BUY');
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-1 overflow-x-auto">
        {(['LIMIT', 'MARKET', 'STOP_LIMIT', 'OCO', 'TRAILING_STOP'] as const).map((ty) => (
          <button key={ty} onClick={() => setType(ty)} className={clsx('shrink-0 rounded px-3 py-1 text-sm font-medium', type === ty ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg')}>
            {labels[ty]}
          </button>
        ))}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-md bg-panel2 p-1 md:hidden">
        <button onClick={() => setMobileSide('BUY')} className={clsx('rounded py-1.5 text-sm font-semibold', mobileSide === 'BUY' ? 'bg-up text-white' : 'text-muted')}>{t('trade.buy')}</button>
        <button onClick={() => setMobileSide('SELL')} className={clsx('rounded py-1.5 text-sm font-semibold', mobileSide === 'SELL' ? 'bg-down text-white' : 'text-muted')}>{t('trade.sell')}</button>
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
