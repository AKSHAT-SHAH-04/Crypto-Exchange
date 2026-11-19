'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { api, errMsg } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { fmtPrice } from '@/lib/format';
import type { Market } from '@/lib/types';

interface Alert { id: string; symbol: string; direction: 'ABOVE' | 'BELOW'; price: string; active: boolean; note: string | null }

export function AlertButton({ market, price }: { market: Market; price?: number }) {
  const { user } = useAuth();
  const { t } = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const alerts = useApi<Alert[]>(user && open ? '/api/alerts' : null);
  const mine = (alerts.data ?? []).filter((a) => a.symbol === market.symbol && a.active);

  const create = async () => {
    try {
      const a = await api<Alert>('/api/alerts', { method: 'POST', body: { symbol: market.symbol, price: target, note: note || undefined } });
      toast(`Alert set: ${market.base} ${a.direction === 'ABOVE' ? '≥' : '≤'} ${a.price}`, 'success');
      setTarget('');
      setNote('');
      alerts.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const quick = (pct: number) => price && setTarget((price * (1 + pct / 100)).toFixed(market.pricePrecision));

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost shrink-0 px-3 py-1 text-xs" title="Price alert">🔔 {t('trade.alert')}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Price alert · ${market.base}/${market.quote}`}>
        {!user ? (
          <p className="text-sm"><Link href="/login" className="text-brand">Log in</Link> to create price alerts.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">Current price <span className="num text-fg">{fmtPrice(price, market.pricePrecision)}</span>. We'll notify you when the price crosses your target.</p>
            <input className="input num" inputMode="decimal" placeholder="Target price" value={target} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setTarget(e.target.value)} />
            <div className="grid grid-cols-6 gap-1">
              {[-10, -5, -1, 1, 5, 10].map((p) => (
                <button key={p} onClick={() => quick(p)} className={`rounded border border-line py-1 text-xs ${p < 0 ? 'text-down' : 'text-up'}`}>{p > 0 ? '+' : ''}{p}%</button>
              ))}
            </div>
            <input className="input" placeholder="Note (optional)" maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn-brand w-full" onClick={create} disabled={!+target}>Create alert</button>
            {mine.length > 0 && (
              <div className="border-t border-line pt-3">
                <div className="mb-2 text-xs font-semibold text-muted">Active alerts</div>
                {mine.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-1 text-sm">
                    <span className={a.direction === 'ABOVE' ? 'text-up' : 'text-down'}>{a.direction === 'ABOVE' ? '≥' : '≤'} <span className="num">{fmtPrice(a.price, market.pricePrecision)}</span></span>
                    <span className="truncate px-2 text-xs text-muted">{a.note}</span>
                    <button className="text-xs text-down" onClick={() => api(`/api/alerts/${a.id}`, { method: 'DELETE' }).then(alerts.reload)}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
