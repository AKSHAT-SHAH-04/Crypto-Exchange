'use client';
import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import type { MyTrade, Order } from '@/lib/types';
import { api, errMsg } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { StatusBadge } from '@/components/Field';
import { fmtDateTime, fmtPrice, fmtQty } from '@/lib/format';

type Tab = 'open' | 'history' | 'trades';

export function UserOrders({ symbol, full }: { symbol?: string; full?: boolean }) {
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('open');
  const [onlyThis, setOnlyThis] = useState(!!symbol);
  const q = symbol && onlyThis ? `?symbol=${symbol}` : '';
  const open = useApi<Order[]>(user ? `/api/orders/open${q}` : null, { refreshOnUserEvent: true });
  const history = useApi<Order[]>(user && tab === 'history' ? `/api/orders/history${q}` : null, { refreshOnUserEvent: true });
  const trades = useApi<MyTrade[]>(user && tab === 'trades' ? `/api/trades/my${q}` : null, { refreshOnUserEvent: true });

  const cancel = async (id: string) => {
    try {
      await api(`/api/orders/${id}`, { method: 'DELETE' });
      toast('Order canceled', 'success');
      open.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const cancelAll = async () => {
    try {
      const r = await api<{ canceled: number }>(`/api/orders${q}`, { method: 'DELETE' });
      toast(`Canceled ${r.canceled} order(s)`, 'success');
      open.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'open', label: `Open orders (${open.data?.length ?? 0})` },
    { id: 'history', label: 'Order history' },
    { id: 'trades', label: 'Trade history' },
  ];

  const orderRows = (rows: Order[] | null, isOpen: boolean) => (
    <table className="w-full min-w-[760px] text-xs">
      <thead>
        <tr className="border-b border-line">
          {['Date', 'Pair', 'Type', 'Side', 'Price', isOpen ? 'Trigger' : 'Avg. price', 'Amount', 'Filled', 'Status', ''].map((h) => (
            <th key={h} className="table-head px-3 py-2 font-normal">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows?.map((o) => (
          <tr key={o.id} className="border-b border-line/50 last:border-0">
            <td className="num px-3 py-2 text-muted">{fmtDateTime(isOpen ? o.createdAt : o.updatedAt)}</td>
            <td className="px-3"><Link href={`/trade/${o.symbol}`} className="hover:text-brand">{o.symbol.replace('USDT', '/USDT')}</Link></td>
            <td className="px-3">{o.type.replace('_', '-').toLowerCase()}</td>
            <td className={clsx('px-3 font-medium', o.side === 'BUY' ? 'text-up' : 'text-down')}>{o.side.toLowerCase()}</td>
            <td className="num px-3">{o.price ? fmtPrice(o.price) : 'Market'}</td>
            <td className="num px-3">{isOpen ? (o.stopPrice ? `${o.side === 'BUY' ? '≥' : '≤'} ${fmtPrice(o.stopPrice)}` : '—') : o.avgPrice ? fmtPrice(o.avgPrice) : '—'}</td>
            <td className="num px-3">{fmtQty(o.quantity)}</td>
            <td className="num px-3">{((+o.filledQty / +o.quantity) * 100).toFixed(1)}%</td>
            <td className="px-3"><StatusBadge status={o.status} /></td>
            <td className="px-3 text-right">
              {isOpen && <button onClick={() => cancel(o.id)} className="text-brand hover:underline">Cancel</button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center border-b border-line">
        {tabs.map((t) => (
          <button key={t.id} className={clsx('tab', tab === t.id && 'tab-active')} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
        <div className="ml-auto flex items-center gap-4 px-3 py-2 text-xs">
          {symbol && (
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} /> Current pair only
            </label>
          )}
          {tab === 'open' && !!open.data?.length && <button onClick={cancelAll} className="text-brand hover:underline">Cancel all</button>}
        </div>
      </div>
      <div className={clsx('overflow-auto', full ? 'min-h-[300px]' : 'h-[260px]')}>
        {!user ? (
          <div className="p-10 text-center text-sm text-muted">
            <Link href="/login" className="text-brand">Log in</Link> to see your orders.
          </div>
        ) : tab === 'open' ? (
          open.data?.length ? orderRows(open.data, true) : <Empty text="No open orders" />
        ) : tab === 'history' ? (
          history.data?.length ? orderRows(history.data, false) : <Empty text={history.loading ? 'Loading…' : 'No order history'} />
        ) : trades.data?.length ? (
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-line">
                {['Date', 'Pair', 'Side', 'Role', 'Price', 'Amount', 'Total', 'Fee'].map((h) => <th key={h} className="table-head px-3 py-2 font-normal">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {trades.data.map((t) => (
                <tr key={t.id} className="border-b border-line/50 last:border-0">
                  <td className="num px-3 py-2 text-muted">{fmtDateTime(t.createdAt)}</td>
                  <td className="px-3">{t.symbol.replace('USDT', '/USDT')}</td>
                  <td className={clsx('px-3 font-medium', t.side === 'BUY' ? 'text-up' : 'text-down')}>{t.side.toLowerCase()}</td>
                  <td className="px-3 text-muted">{t.role.toLowerCase()}</td>
                  <td className="num px-3">{fmtPrice(t.price)}</td>
                  <td className="num px-3">{fmtQty(t.quantity)}</td>
                  <td className="num px-3">{fmtPrice(t.quote, 2)}</td>
                  <td className="num px-3 text-muted">{fmtQty(t.fee, 8)} {t.feeAsset === 'BASE' ? t.symbol.replace('USDT', '') : 'USDT'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty text={trades.loading ? 'Loading…' : 'No trades yet'} />
        )}
      </div>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <div className="p-10 text-center text-sm text-muted">{text}</div>;
